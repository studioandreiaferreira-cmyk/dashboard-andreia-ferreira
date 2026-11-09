# Research: Dashboard de CRM (Clint)

**Feature**: `001-crm-dashboard` | **Date**: 2026-10-11

All findings below were checked against the live Clint account of Studio Andreia Ferreira with read-only calls on 2026-10-11, unless marked otherwise.

## R1. Clint API: what exists and how to read it

**Decision**: Use the Clint REST API (`https://api.clint.digital`, header `api-token`) as the only data source, combining v1 (CRM) and v2 (chats/messages) endpoints:

| Need | Endpoint | Incremental filter |
|---|---|---|
| Deals (status, stage, owner, origin, created/updated/stage dates, campaign + form fields) | `GET /v1/deals` (limit ≤ 1000) | `updated_at_start` |
| Origins + stages + group, archived flag | `GET /v1/origins` | full refresh (43 rows) |
| Groups | `GET /v1/groups` | full refresh |
| Users (sellers) | `GET /v1/users` | full refresh (4 rows) |
| Contacts (profession `role`, tags) | `GET /v1/contacts` (limit ≤ 1000) | full or by id |
| Channel accounts (WhatsApp/Instagram numbers) | `GET /v2/channel-accounts` | full refresh (7 rows) |
| Chats with recent activity | `GET /v2/chats/channel-account/{id}` sorted by `last_message_at` desc | `last_message_at_start` |
| Chats of one contact | `GET /v2/chats/contact/{contactId}` | — |
| Messages of a chat | `GET /v2/messages/chat/{chatId}` sorted by `created_at` desc | stop paging at the last stored message |
| Account custom fields | `GET /v1/account/fields` | full refresh |

**Rationale**: The public docs page linked first (`/v1/contacts`) only showed contacts, but the full index (`https://clint-api.readme.io/llms.txt`) lists v2 chat/message endpoints. Live tests confirmed:
- 23,556 deals in total, 18,496 OPEN, ~20 updated per day. Fields seen on deals: `app`, `campaign_id/name`, `ad_id/name`, `form_id/name`, `faturamento_mensal`, `lead_id`.
- 7 channel accounts. The ones with chats in the last 90 days: "Andreia Ferreira" (official WhatsApp, 568 chats), "ACADEMY" (WhatsApp, now CANCELLED, 501), "Carina Pimentel" (WhatsApp, 392), "Disparo" (8). About 1,470 chats in 90 days.
- Chat object: `contact_id`, `user_id` (assigned attendant), `status` OPEN/CLOSED, `replied`, `last_message_at`, `last_response_at`, `first_response_at`, `first_customer_message_at`, `channel_account_id`.
- Message object: `type` USER (seller) / CUSTOMER (lead) / EVENT (system), `user_id` (sender, sometimes null), `created_at`, `source` CHAT/DEVICE, `content_type`.
- Rate limit headers: `x-ratelimit-limit: 500`, window 60 s.
- Cloudflare in front of the API returns 403 for default library user agents; requests must send an explicit `User-Agent`.

**Alternatives considered**:
- *Webhooks (`PUT /v2/webhooks/whatsapp`, HMAC-SHA256 signed)*: real time, but no backfill, one URL per account (it would compete with other integrations), and lost events need reconciliation anyway. Kept as a possible later optimization; polling covers the 15-minute freshness target (FR-025).
- *`GET /v2/deals/{id}/history`*: gives stage changes per deal, but costs one call per deal. Not needed because `updated_stage_at` is on the deal, and "deals worked" (FR-006) can use messages plus `updated_stage_at` changes seen by the sync.
- *Clint native dashboards (`/v2/dashboards`)*: they can't produce no-reply lists, UTM × profile cross analysis or business-hours logic.

## R2. Hosting and runtime

**Decision**: A single Cloudflare Worker on the client's Cloudflare account (spec assumption), in TypeScript:
- **HTTP**: [Hono](https://hono.dev) router serving the JSON API and the static frontend (Workers Static Assets).
- **Storage**: Cloudflare D1 (SQLite) as a local copy of the CRM data plus computed fields.
- **Sync**: Cron Trigger every 10 minutes for incremental sync, and a nightly full reconcile.
- **Secrets**: `CLINT_API_TOKEN` and `DASH_PASSWORD` set with `wrangler secret`.

**Rationale**:
- Spec SC-006 asks for filters to respond in ≤ 3 s over ~23.5k deals, which rules out calling the Clint API live per request: listing all deals alone is 24+ calls.
- A local SQL copy makes every view a simple aggregate query.
- D1 is native to Workers and needs no extra vendor.

**Plan requirement: Workers Paid ($5/month)**:
- Free plan limits are 50 subrequests per invocation, 100k D1 rows written per day and a 10 ms CPU limit.
- The first message backfill writes on the order of 50–150k rows, and each sync run needs hundreds of API calls.
- Paid allows 1,000 subrequests per invocation by default (higher is configurable), 30 s+ CPU per cron run and 50M D1 writes per month.
- If the client account is on Free, the backfill must be spread across many cron runs and some days may hit the write cap. See the risk in plan.md.

**Alternatives considered**: Pages + Functions (same runtime, less control over cron); an external database such as Supabase (extra vendor and credentials, unnecessary at this volume); KV only (no ad-hoc aggregation).

## R3. Sync strategy

**Decision**:
1. **Reference data** (origins, groups, users, channel accounts, fields): full refresh on every run. These are fewer than 100 rows.
2. **Deals**: incremental with `updated_at_start = last_cursor - 5 min overlap`, upsert by id. The first run pages through all ~23.5k deals at limit 1000, about 24 calls. A nightly full pass catches deletions: deals missing from it are marked `deleted`.
3. **Contacts**: upsert contacts referenced by new or changed deals (by id); a nightly full pass.
4. **Chats**: for each channel account, page `chats/channel-account/{id}?last_message_at_start=cursor-5min` and upsert. The first run uses `now - 90 days`.
5. **Messages**: for each chat whose `last_message_at` changed, page `messages/chat/{chatId}` (newest first) until reaching a message already stored or older than 90 days. Messages older than 90 days are deleted nightly.
6. **Budget**:
   - Each run processes work from a queue table (`sync_state`) and stops at about 800 subrequests, staying below 500 calls/min with pacing.
   - Leftover work resumes on the next run, so the initial backfill (about 1,470 chats × 1–3 pages) completes within the first hour.

**Rationale**: The `updated_at` and `last_message_at` filters make incremental sync cheap. Steady state is about 20 deal changes plus tens of chats per 10 minutes, so a few dozen calls per run.

**Alternatives considered**: Durable Objects or Queues for sync orchestration. Not needed at this volume; can be added if the run budget becomes tight.

## R4. "No reply" computation (FR-008, FR-009, FR-030)

**Decision**: Computed locally from stored messages, not from the chat `replied` flag:
- **Awaiting since**: the `created_at` of the first CUSTOMER message after the last USER message, ignoring EVENT messages.
- **Business time elapsed**: the minutes between "awaiting since" and now that fall inside configured business hours (default Mon–Fri 09:00–18:00 America/Sao_Paulo).
- **No reply** = business time elapsed > 60 min, and the contact has ≥ 1 deal with status OPEN.
- **Fallback** for chats older than the 90-day message window: use the chat's `last_message_at` vs `last_response_at`.

**Rationale**:
- The sample showed `replied=true` on chats whose most recent messages were from the customer: `replied` seems to mean "was ever answered" or "first response sent".
- Local computation follows the spec's definition exactly and is unit-testable.
- Brazil has had no daylight saving since 2019, but timezone math still goes through `Intl`/Temporal-style helpers to avoid hard-coding UTC-3.

## R5. Seller attribution (FR-005, FR-006, FR-029)

**Decision**: The message seller is `message.user_id`. If it's null, fall back to `chat.user_id`, then to the owner of the contact's most recently updated open deal, then to "Sem responsável". Store `attribution` = `direct | chat | deal | none` per message so the dash can show the count of inferred attributions.

**Evidence**: In a sample of 12 recently updated deals, 33 of 107 USER messages (~30%) had a null `user_id`. 18 of the sampled messages had `source=DEVICE` (sent from the phone).

## R6. Campaign ("UTM") and profile fields

**Decision**:
- **Campaign dimensions**: `fields.campaign_name`, `fields.ad_name`, `fields.form_name` from the deal (Meta Lead Ads, `app=FACEBOOK_LEAD_ADS`). The IDs are kept for joining with Meta data in the future marketing phase.
- **Missing campaign data**: "Sem campanha / Orgânico".
- **`utm_*` fields**: picked up automatically if they ever appear on deals (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`).
- **Profile questions**: a config list `PROFILE_FIELDS` of `{key, label, entity: deal|contact}`, initially:
  - `faturamento_mensal` (deal), "Faturamento mensal";
  - `role` (contact), "Profissão".
  Adding a question = editing that list (FR-023).
- **Answer display**: answers are shown raw, grouped by `form_name`, so currencies and languages are never summed together (FR-022). Example values: `menos_de_$500`, `entre_$500_y_$1,000`, `até_3.000__`.

**Rationale**: Normalizing answers across languages and currencies would invent equivalences that the client hasn't defined.

## R7. Authentication (FR-027, clarified: shared password)

**Decision**:
- **Login**: `POST /api/login` with the password, compared in constant time against the `DASH_PASSWORD` secret.
- **Session**: on success, an `HttpOnly; Secure; SameSite=Strict` cookie holding `exp` + HMAC-SHA256 signature, valid for 30 days. The signing key is derived from `DASH_PASSWORD`, so changing the secret invalidates every session.
- **Brute force protection**: after 10 failures per IP in 15 minutes, `429` for 15 minutes, tracked in a D1 table.
- **Protected routes**: every `/api/*` route except `/api/login` requires the cookie.
- **Static shell**: has no data, so it can be public.

## R8. Clint deep link (optional, FR-035)

**Decision**: Superseded as the primary way to open a conversation by the in-dash chat viewer (R12). An optional "Abrir na Clint" button uses `CLINT_DEAL_URL_TEMPLATE` if it is set later. Empty means the button is hidden.

## R9. Frontend

**Decision**:
- **Structure**: a single-page app built with Vite + Preact + TypeScript, charts with Chart.js. It's served as Worker static assets in pt-BR.
- **Filters**: in the URL query string, so a view can be shared by link.
- **Tabs**: "Vendedores", "Sem resposta", "Entrada", "Parados", "Campanhas", "Perfil".

**Rationale**: Small bundle, no server rendering needed, and familiar tooling. Chart.js covers bar, stacked bar and line charts.

## R10. Testing

**Decision**:
- **Tests**: Vitest with `@cloudflare/vitest-pool-workers`, which runs tests inside workerd with a real local D1.
- **Unit tests**: business-hours math, attribution, no-reply rules, stalled-days, sync cursors.
- **Integration tests**: API routes against a seeded D1.
- **Fake Clint API**: recorded fixtures (anonymized samples of the real payloads above).
- **Manual check**: an accuracy pass against Clint, using the counting samples in spec SC-002, SC-003 and SC-005 (quickstart.md).

## R12. In-dash chat viewer (FR-031..035, clarified 2026-10-11)

**Decision**:
- **Data path**: read-only, WhatsApp-style viewer in the SPA. It reads messages **live** through the Worker:
  - `GET /api/contacts/:id/chats` → `GET /v2/chats/contact/{id}`;
  - `GET /api/chats/:id/messages?page=N` → `GET /v2/messages/chat/{id}?page=N&limit=50`, newest first, with "load older" paging and no 90-day limit.
- **What the Worker returns**: it maps each message to `{id, created_at, side: lead|seller|system, seller_name, content_type, text, media{url,name,seconds}, reactions[]}`.
  - REACTION messages are folded into `reactions` of the message they point to (`content_action.reaction.message_id`).
  - EVENT messages become `side=system`.
- **Media**: rendered straight from `content_url` (`https://file.clint.digital/...`, public URLs checked live): `<audio>` with `content_object.seconds`, `<img>`/`<video>` thumbnails with a lightbox, and a document link showing `content_object.name`.

**Evidence (15 recent chats, 566 messages)**: TEXT 478, IMAGE 45, AUDIO 12, REACTION 11, DOCUMENT 10, VIDEO 10.

**Rationale**:
- Live reads keep message content (personal data) out of D1.
- The Clint token stays on the server (FR-028).
- Older history is available on demand.
- It costs about 2 API calls per opened conversation, far below the rate limit.

**Alternatives considered**: storing content in D1 (more storage and more personal data at rest, gains nothing); linking out to Clint (the user preferred reading inside the dash).

## R13. Local-first, no password for now (FR-027, clarified 2026-10-11)

**Decision**:
- **Local**: the dash runs with `wrangler dev` and a local D1. When `DASH_PASSWORD` is empty or unset, `requireSession` lets every request through, and the SPA shows a red banner "Dash sem senha — uso local, não publicar".
- **Deploy guard**: a `predeploy` npm script fails if `wrangler secret list` doesn't include `DASH_PASSWORD`. That way a password is set before anything goes to the client's Cloudflare account.

**Rationale**: The dash exposes lead names, phones and now conversation content, so it must never be public without a login.

## R11. Constitution

`.specify/memory/constitution.md` is still the unfilled template, so there are no project principles to gate on. This plan follows general defaults instead:
- secrets never in code or the browser;
- the simplest architecture that meets the targets;
- tests for every computed metric.
