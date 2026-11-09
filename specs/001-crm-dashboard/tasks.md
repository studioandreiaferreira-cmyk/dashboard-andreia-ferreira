---

description: "Task list for the CRM dashboard (Clint) — Studio Andreia Ferreira"
---

# Tasks: Dashboard de CRM (Clint) — Studio Andreia Ferreira

**Input**: Design documents from `specs/001-crm-dashboard/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md, quickstart.md

**Tests**: The spec doesn't ask for TDD. The plan's guardrail ("every computed metric covered by tests") does require unit tests for the rule-heavy logic: time math, attribution, no-reply, stalled days, filters. Tests are included only for those, plus one sync integration test. UI and other routes are validated manually with quickstart.md (V1–V13).

**Organization**: Tasks are grouped by user story (spec.md US1–US6) so each story can be implemented and validated on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: US1–US6 from spec.md
- Paths are relative to the repository root (`/home/fillipi/Projects/Andreia Ferreira`)

## Shared conventions (apply to every task)

- **Clint API calls** go through `src/clint/client.ts` only. Base `https://api.clint.digital`, header `api-token: <CLINT_API_TOKEN>`, and an explicit `User-Agent: af-crm-dashboard/1.0`: without it Cloudflare returns 403 (research R1).
- **Dates**: stored in UTC ISO-8601 text. Every "day" is computed in `America/Sao_Paulo` through `src/lib/time.ts`.
- **API routes** follow `contracts/http-api.md` exactly: field names, defaults and the `meta` object.
- **UI text** is in pt-BR.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and tooling

- [X] T001 Rename the local secrets file `env.` to `.dev.vars` and rename the key `CLINT_API_TOKEN_ANDREIA` to `CLINT_API_TOKEN`. Add `DASH_PASSWORD=` **empty** (local phase runs without login, research R13). Create `.gitignore` with `.dev.vars`, `.env`, `env.`, `node_modules/`, `web/dist/`, `.wrangler/`. Create `.dev.vars.example` with empty `CLINT_API_TOKEN=` and `DASH_PASSWORD=`.
- [X] T002 Create `package.json` (type module):
  - dependencies `hono`, `preact`, `chart.js`;
  - devDependencies `wrangler`, `typescript`, `vite`, `@preact/preset-vite`, `vitest`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`;
  - scripts `dev` (`vite build --watch` for web + `wrangler dev`), `build` (`vite build`), `deploy` (`npm run build && wrangler deploy`), `predeploy` (a node script `scripts/check-secrets.mjs` that runs `wrangler secret list` and exits 1 with "Defina DASH_PASSWORD antes de publicar" if `DASH_PASSWORD` is missing), `test` (`vitest run`). Run `npm install`.
- [X] T003 [P] Create `tsconfig.json` (strict, `moduleResolution: bundler`, `jsx: react-jsx`, `jsxImportSource: preact`, types `@cloudflare/workers-types`) covering `src/`, `web/src/`, `tests/`.
- [X] T004 [P] Create `wrangler.toml`:
  - name `af-crm-dashboard`, a new Worker so it doesn't clash with the old dashboard (plan risks); `main = "src/index.ts"`; `compatibility_date = "2026-09-01"`; `compatibility_flags = ["nodejs_compat"]`;
  - `[assets] directory = "web/dist"`, `not_found_handling = "single-page-application"`, `run_worker_first = ["/api/*"]`;
  - `[[d1_databases]] binding = "DB"`, `database_name = "crm-andreia"`, with a placeholder id;
  - `[triggers] crons = ["*/10 * * * *", "0 6 * * *"]`;
  - `[vars]` `BUSINESS_HOURS`, `NO_REPLY_MINUTES`, `MESSAGE_WINDOW_DAYS`, `PROFILE_FIELDS`, `CLINT_DEAL_URL_TEMPLATE`, `CLINT_CHAT_URL_TEMPLATE`, with the defaults from data-model.md "Configuration". The URL templates are empty strings.
- [X] T005 [P] Create `vite.config.ts` (root `web/`, outDir `web/dist`, preact preset, dev proxy `/api` → `http://localhost:8787`) and `vitest.config.ts` using `defineWorkersConfig` from `@cloudflare/vitest-pool-workers`, pointing at `wrangler.toml` with D1 migrations applied (`migrations/`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, Clint client, full sync, auth, shared filters and SPA shell. Every story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Schema & config

- [X] T006 Create `migrations/0001_init.sql` with every table and index in `data-model.md`: `groups`, `origins`, `stages`, `users`, `channel_accounts`, `contacts`, `deals`, `chats`, `messages`, `chat_reply_state`, `sync_state`, `login_attempts`. Requirements:
  - **`deals`**:
    - columns `campaign_name`, `campaign_id`, `ad_name`, `ad_id`, `form_name`, `form_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `fields_json`, `created_day_sp`, `deleted INTEGER DEFAULT 0`;
    - indexes `(origin_id, created_day_sp)`, `(status, origin_id)`, `(campaign_name)`, `(contact_id, status)`, `(user_id)`.
  - **`messages`**:
    - `type` is "USER (seller) / CUSTOMER (lead) / EVENT (ignored in metrics)";
    - `attribution` is one of `direct` / `chat` / `deal` / `none`;
    - columns `content_type`, `attributed_user_id`, `created_day_sp`. No message content columns: content is never stored (research R12);
    - indexes `(attributed_user_id, created_day_sp)` and `(chat_id, created_at)`.
  - **`chats`**: include `messages_synced_until`.
- [X] T007 [P] Create `src/config.ts`. It defines the `Env` type (`DB: D1Database`, `ASSETS: Fetcher`, `CLINT_API_TOKEN`, `DASH_PASSWORD`, plus the vars from T004) and `getConfig(env)`, which parses:
  - `BUSINESS_HOURS` JSON `{"days":[1..7],"start":"HH:MM","end":"HH:MM","tz"}`;
  - `NO_REPLY_MINUTES` (number, default 60);
  - `MESSAGE_WINDOW_DAYS` (default 90);
  - `PROFILE_FIELDS` JSON `[{key,label,entity:"deal"|"contact"}]`;
  - the URL templates, where `{deal_id}`, `{contact_id}` and `{chat_id}` are placeholders.
  Invalid JSON throws an error naming the variable.
- [X] T008 [P] Create `src/lib/time.ts`:
  - `toDaySP(iso): string` (`YYYY-MM-DD` in America/Sao_Paulo via `Intl.DateTimeFormat`);
  - `todaySP(now)`;
  - `daysBetweenSP(fromIso, now): number` (whole calendar days in SP);
  - `dayRange(from, to): string[]` (inclusive);
  - `businessMinutesBetween(startIso, endIso, businessHours): number`, which counts only minutes inside the configured weekdays and the start–end window in the configured timezone, and returns 0 if `end <= start`.
- [X] T009 [P] Create `tests/unit/time.test.ts`, covering:
  - `toDaySP("2026-10-11T02:30:00Z") === "2026-10-10"`;
  - `businessMinutesBetween` from Fri 17:30 SP to Mon 09:29 SP = 59;
  - Fri 17:30 → Mon 09:31 = 61;
  - a message on Sat 10:00 → Mon 10:00 = 60;
  - same-day 10:00 → 10:45 = 45;
  - `dayRange("2026-10-01","2026-10-03")` has length 3.

### Clint client

- [X] T010 Create `src/clint/types.ts` with types matching the live payloads (research R1):
  - `ClintDeal` (`id`, `origin_id`, `user{id,email,full_name}|null`, `contact{id,name,email,phone,ddi,instagram}`, `created_at`, `updated_at`, `updated_stage_at`, `status:"OPEN"|"WON"|"LOST"`, `won_at`, `lost_at`, `stage`, `stage_id`, `value`, `fields: Record<string,unknown>`);
  - `ClintOrigin` (`id`, `name`, `group{id,name}`, `stages[{id,label,order,type}]`, `archived_at`);
  - `ClintUser` (`id`, `email`, `first_name`, `last_name`);
  - `ClintContact` (`id`, `name`, `email`, `ddi`, `phone`, `fields`, `updated_at`);
  - `ClintChannelAccount` (`id`, `name`, `type`, `status`);
  - `ClintChat` (`id`, `contact_id`, `user_id`, `status`, `replied`, `last_message_at`, `last_response_at`, `channel_account_id`);
  - `ClintMessage` (`id`, `chat_id`, `user_id`, `type:"USER"|"CUSTOMER"|"EVENT"`, `created_at`, `source`, `content: string|null`, `content_type: "TEXT"|"IMAGE"|"AUDIO"|"VIDEO"|"DOCUMENT"|"REACTION"|string`, `content_url: string|null`, `content_object: {name?, type?, seconds?}`, `content_action: {reaction?: {value, from_me, message_id}}`);
  - the v1 page envelope (`data`, `totalCount`, `page`, `totalPages`, `hasNext`) and the v2 envelope (`data`, `total_count`, `page`, `total_pages`, `has_next`).
- [X] T011 Create `src/clint/client.ts`. `class ClintClient` takes `(token, budget)`, where `budget` counts subrequests and throws `BudgetExhausted` when it reaches 800. It provides:
  - `get<T>(path, query)`: sends `api-token` and `User-Agent`;
  - on 429, reads `x-ratelimit-reset` and waits (max 60 s), then retries ×3; on 5xx, exponential backoff ×3;
  - async generators `pagesV1(path, query)` (limit 1000, follows `hasNext`) and `pagesV2(path, query)` (limit 200, follows `has_next`).
  Endpoint helpers: `listDeals`, `listOrigins`, `listGroups`, `listUsers`, `listContacts`, `getContact`, `listChannelAccounts`, `listChatsByChannel(id, lastMessageAtStart)`, `listChatsByContact(contactId)`, `listMessagesByChat(chatId)`.
- [X] T012 [P] Create anonymized fixtures in `tests/fixtures/clint/`: `deals.json`, `origins.json`, `users.json`, `channel-accounts.json`, `chats.json`, `messages.json`, `contacts.json`.
  - **Values**: real field shapes from research R1, with fake names and phones.
  - **Coverage**: one deal with Meta fields (`campaign_name`, `ad_name`, `form_name`, `faturamento_mensal`), one deal without fields, one WON and one LOST deal, one chat whose last messages are CUSTOMER after a USER, USER messages with and without `user_id`, one EVENT message, and one message each of IMAGE, AUDIO (with `content_object.seconds`), DOCUMENT and REACTION (`content_action.reaction.message_id` pointing to another fixture message).

### Sync (shared by all stories)

- [X] T013 Create `src/sync/reference.ts` `syncReference(client, db)`. It does a full upsert of `groups`, `origins` (with `archived_at`), `stages` (from `origin.stages`), `users` (`name = first_name + " " + last_name`, `active=1`; users missing from the response get `active=0`) and `channel_accounts` (all statuses, including CANCELLED).
- [X] T014 Create `src/sync/deals.ts`:
  - **`syncDealsIncremental(client, db)`**: reads `sync_state['deals_cursor']` (default: none, which means a full pull) and calls `listDeals({updated_at_start: cursor - 5 min})`. It upserts each deal, mapping:
    - `user.id` → `user_id`, `contact.id` → `contact_id`;
    - `created_day_sp = toDaySP(created_at)`;
    - `campaign_name/id`, `ad_name/id`, `form_name/id` and the `utm_*` columns copied from `fields` when present;
    - `fields_json = JSON.stringify(fields)`.
    It also upserts a minimal `contacts` row from `deal.contact` (`name`, `phone = ddi+phone`, `email`) and saves the max `updated_at` as the new cursor.
  - **`reconcileDealsFull(client, db)`**: pages all deals and sets `deleted=1` for ids not returned.
- [X] T015 [P] Create `src/sync/contacts.ts` `syncContacts(client, db, {full})`. Full mode pages `/v1/contacts` (limit 1000) and upserts `fields_json`, `name`, `phone`, `email`, `updated_at`. Incremental mode fetches `getContact(id)` for contacts touched by T014 whose `fields_json` is null.
- [X] T016 Create `src/lib/attribution.ts` `attributeMessage(msg, chat, openDealOwnerId)`, which returns `{attributed_user_id, attribution}` following the FR-029 order: `msg.user_id` → `"direct"`; else `chat.user_id` → `"chat"`; else `openDealOwnerId` → `"deal"`; else `null` with `"none"`. Only USER messages are attributed; CUSTOMER and EVENT messages return `{null,"none"}`.
- [X] T017 [P] Create `tests/unit/attribution.test.ts`. It covers all four fallback branches and that CUSTOMER and EVENT messages are never attributed.
- [X] T018 Create `src/sync/chats.ts` `syncChats(client, db)`. For each channel account, it reads `sync_state['chats_cursor:<id>']` (default `now - MESSAGE_WINDOW_DAYS`) and pages `listChatsByChannel(id, cursor - 5 min)`. It upserts `chats`, keeping the existing `messages_synced_until`, and saves the max `last_message_at` as the cursor.
- [X] T019 Create `src/sync/messages.ts` `syncMessages(client, db, cfg)`:
  - **Which chats**: those where `messages_synced_until IS NULL OR last_message_at > messages_synced_until`, oldest first.
  - **Paging**: `listMessagesByChat` (newest first) until it reaches a message id already stored or `created_at < now - MESSAGE_WINDOW_DAYS`.
  - **Writes**: upsert `messages` with `content_type`, `created_day_sp` and the T016 attribution, without any message content. The owner of the contact's most recently updated OPEN deal is looked up from `deals`.
  - **Cursor**: set `chats.messages_synced_until` to the newest `created_at`.
  - Stop cleanly on `BudgetExhausted` so the next run continues.
- [X] T020 Create `src/sync/run.ts`:
  - **`runIncremental(env)`**: creates a `ClintClient` with an 800-subrequest budget and runs `syncReference` → `syncDealsIncremental` → `syncContacts({full:false})` → `syncChats` → `syncMessages`, then calls the `afterSync` hooks array (initially empty; US1 registers its reply-state recompute there).
    - On success it sets `sync_state['last_success_at']` and clears `last_error`.
    - On any other error it stores `last_error` (message + time) without wiping data.
  - **`runNightly(env)`**: `reconcileDealsFull`, `syncContacts({full:true})`, `DELETE FROM messages WHERE created_at < now - MESSAGE_WINDOW_DAYS`, and pruning `login_attempts` older than 15 min.
- [X] T021 Create `tests/integration/sync.test.ts`. It stubs `fetch` with the T012 fixtures, runs `runIncremental` on the vitest D1 and asserts:
  - the deal with Meta fields has `campaign_name` set and `created_day_sp` in SP time;
  - messages have the correct `attribution` values;
  - a second run with the same fixtures creates no duplicates;
  - a 429 response is retried.

### HTTP shell, auth and shared filters

- [X] T022 Create `src/auth/session.ts`. **When `DASH_PASSWORD` is empty or unset, auth is disabled** (research R13): `requireSession` passes every request, and `GET /api/auth-status` returns `{"password_required":false,"authenticated":true}`. Otherwise it returns `password_required:true` and whether the cookie is valid.
  - **`login(c)`**: reads `{password}`; rejects with 429 `{"error":"too_many_attempts","retry_after_s":900}` if `login_attempts` has ≥ 10 rows for the IP (`CF-Connecting-IP`) in the last 15 min; compares with `DASH_PASSWORD` in constant time.
    - On failure: inserts an attempt and returns 401 `{"error":"invalid_password"}`.
    - On success: sets the cookie `af_session=<exp>.<hmac>` (`HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`). The HMAC-SHA256 key is derived from `DASH_PASSWORD` via WebCrypto, so changing the secret invalidates every session.
  - **`logout`**: clears the cookie and returns 204.
  - **`requireSession`**: Hono middleware returning 401 `{"error":"unauthorized"}`.
- [X] T023 Create `src/metrics/filters.ts`:
  - `parseFilters(query, cfg)` returns `{from, to, originIds, groupIds, userIds (with "none"), campaign, ad, form}` with defaults `from = today−29`, `to = today` (SP).
  - `dealWhere(f, alias="d")` returns `{sql, params}`: `groupIds` expand to every origin of those groups; `user_ids=none` maps to `d.user_id IS NULL`; `deleted = 0` is always applied.
  - `buildMeta(db, cfg, f)` returns `meta` exactly as in contracts/http-api.md (`last_sync_at`, `sync_ok`, `message_window_start`, `message_window_truncated`). `sync_ok` is false when `last_error` is newer than `last_success_at` or the last success is older than 30 min.
- [X] T024 [P] Create `tests/unit/filters.test.ts`. It checks the group expansion, `user_ids=none`, the default period, and `message_window_truncated=true` when `from` < today−90.
- [X] T025 Create `src/index.ts`, a Hono app with:
  - `GET /api/auth-status`, `POST /api/login` and `POST /api/logout`;
  - `requireSession` on `/api/*`;
  - `GET /api/filters`, returning `groups`, `origins` (with `archived` boolean) and `users` (with `active`), ordered by name, plus `meta`;
  - a fallback that serves `env.ASSETS`.
  Export `default { fetch: app.fetch, scheduled(event, env, ctx) }`: cron `*/10 * * * *` → `ctx.waitUntil(runIncremental(env))`, `0 6 * * *` → `runNightly(env)`.
- [X] T026 Create the SPA shell:
  - **`web/index.html`** and **`web/src/main.tsx`**: hash-free router with the tabs Vendedores, Sem resposta, Entrada, Parados, Campanhas, Perfil.
  - **`web/src/api.ts`**: a `fetch` wrapper that sends the cookie, redirects to Login on 401 and serializes filters into the query string.
  - **`web/src/pages/Login.tsx`**: password form showing the error and 429 messages in pt-BR. On load the app calls `/api/auth-status`: with `password_required:false` it skips Login and shows a fixed red banner "Dash sem senha — uso local, não publicar".
- [X] T027 [P] Create `web/src/components/FilterBar.tsx`:
  - controls: period (date inputs + presets "7 dias", "30 dias", "90 dias", "Este mês"), multi-select origins grouped by group with a "select whole group" option and archived origins marked "(arquivada)", and multi-select sellers including "Sem responsável";
  - state is synced to the URL query string (`from`, `to`, `origin_ids`, `group_ids`, `user_ids`) so views are shareable.
- [X] T028 [P] Create `web/src/components/StaleBanner.tsx`, which shows "Atualizado às HH:MM" from `meta.last_sync_at`, a yellow warning when `meta.sync_ok === false`, and the warning "O histórico de mensagens cobre apenas os últimos 90 dias" when `meta.message_window_truncated`. Also create `web/src/components/DataTable.tsx`, a sortable table with an optional link column that opens in a new tab.

**Checkpoint**: `npm run dev`, then trigger a cron run until the backfill finishes. Login works (quickstart V1), `GET /api/filters` lists all 43 origins and 4 users, and D1 holds about 23.5k deals and the 90-day chats/messages.

---

## Phase 3: User Story 1 - Resgatar leads sem resposta (Priority: P1) 🎯 MVP

**Goal**: Count and list the people awaiting a seller reply for more than 1 business hour (only contacts with ≥ 1 open deal), each with a link that opens the conversation in Clint.

**Independent Test**: quickstart V0, V2, V3, V4, V14. A lead with an open deal whose last message is theirs and older than 1 business hour appears with seller, wait time and a working link, and disappears after a reply plus the next sync. Leads whose deals are all WON/LOST never appear.

- [X] T029 [US1] Create `src/metrics/noReply.ts` `recomputeReplyState(db, chatIds)`, which upserts `chat_reply_state` for the given chats:
  - **`awaiting_since`**: the `created_at` of the first CUSTOMER message after the last USER message (EVENT and `content_type='REACTION'` ignored); null if the last non-EVENT message is USER.
  - **Fallback when the chat has no stored messages** (older than the window): `awaiting_since = last_message_at` if `last_response_at IS NULL OR last_message_at > last_response_at`.
  - **`has_open_deal`**: `EXISTS deal with contact_id = chat.contact_id AND status='OPEN' AND deleted=0`.
  - **`responsible_user_id`**: `chat.user_id`, else the owner of the most recently updated open deal.
  Register it in the T020 `afterSync` hooks with the chats touched in that run plus all chats of contacts whose deals changed status.
- [X] T030 [US1] In `src/metrics/noReply.ts`, add `getNoReply(db, cfg, f, now)`:
  - **Selection**: rows with `awaiting_since IS NOT NULL AND has_open_deal = 1` that match the origin/group/user filters through the contact's open deals. `from`/`to` are ignored.
  - **Wait time**: `business_minutes_waiting = businessMinutesBetween(awaiting_since, now, cfg.businessHours)`, keeping rows where it is `> cfg.noReplyMinutes`.
  - **Response**: the contract shape `{total, threshold_minutes, business_hours, items[{contact_id, contact_name, phone, origin, responsible, awaiting_since, business_minutes_waiting, deal_id, chat_id, clint_url}]}`, sorted by `business_minutes_waiting` desc, one item per chat.
  - **`clint_url`**: `CLINT_CHAT_URL_TEMPLATE` if set, else `CLINT_DEAL_URL_TEMPLATE` filled with the ids, else `null`.
  Add the route `GET /api/metrics/no-reply` in `src/index.ts`.
- [X] T031 [P] [US1] Create `tests/unit/noReply.test.ts`. On seeded D1, it checks:
  - USER → CUSTOMER → CUSTOMER sets `awaiting_since` to the first CUSTOMER;
  - CUSTOMER → USER is not waiting;
  - EVENT after CUSTOMER is still waiting;
  - a CUSTOMER REACTION after a USER message is not waiting;
  - a contact with only WON/LOST deals is excluded;
  - a reopened deal is included;
  - Fri 17:30 → Mon 09:29 is not listed, while → Mon 09:31 is listed;
  - items are sorted by wait time desc.
- [X] T032 [US1] Create `src/chat/viewer.ts` (research R12, contract `GET /api/contacts/:contactId/chats` and `GET /api/chats/:chatId/messages`):
  - **`getContactChats(client, db, contactId)`**: contact and deals from D1 (origin, stage label, status, responsible), and chats live from `listChatsByContact`, with `channel` = channel account name + type. Chats are sorted by `last_message_at` desc.
  - **`getChatMessages(client, db, chatId, page)`**: live `GET /v2/messages/chat/{chatId}?page&limit=50`, mapped by `mapMessages(raw, usersById, chatUserId)`:
    - `side`: CUSTOMER→`lead`, USER→`seller`, EVENT→`system`;
    - `seller_name`: from `user_id`, then `chatUserId`, else "Vendedor";
    - `text = content`;
    - `media` = `{url: content_url, name: content_object.name, seconds: content_object.seconds}` for IMAGE/AUDIO/VIDEO/DOCUMENT;
    - REACTION items are removed and their `content_action.reaction.value` is pushed into `reactions` of the message with id `content_action.reaction.message_id`, when that message is on the same page.
    - Returns `{page, has_more, messages}`.
  - **Routes**: add `GET /api/contacts/:contactId/chats` and `GET /api/chats/:chatId/messages` in `src/index.ts`, behind `requireSession`. The Clint token never reaches the browser (FR-028).
- [X] T033 [P] [US1] Create `tests/unit/chatViewer.test.ts`. Using the T012 fixtures, `mapMessages` must:
  - map the sides correctly;
  - fall back to the chat's user and then "Vendedor" for the seller name;
  - read `media.seconds` from the audio;
  - remove the reaction from the list and attach it to its target message;
  - give EVENT messages `side=system`.
- [X] T034 [US1] Create `web/src/chat/ChatViewer.tsx`, a right-side drawer (full screen on phones) opened with `contactId`:
  - **Header**: name, phone, origin, stage, responsible (from `/api/contacts/:id/chats`); a conversation switcher if there are more than one chat; an optional "Abrir na Clint" button when `clint_url` is set.
  - **Message list**: WhatsApp-style bubbles, lead on the left (light), seller on the right (green) with the seller name above, time `HH:mm` in each bubble, day separators ("Hoje", "Ontem", `dd/MM/yyyy`), system messages centered in grey.
  - **Media**: `<audio controls>` with the duration, image and video thumbnails opening a lightbox, documents as a 📄 name link; when the URL is missing, the type label ("🎤 Áudio", "🖼️ Imagem").
  - **Reactions**: emoji badges on the bubble.
  - **Loading**: opens scrolled to the bottom (most recent); scrolling to the top loads `page+1`, keeping the scroll position.
  - **Empty state**: "Nenhuma mensagem encontrada".
  - **No reply box** (FR-035).
  Styles go in `web/src/chat/chat.css`.
- [X] T035 [US1] Create `web/src/pages/SemResposta.tsx`:
  - **Header**: a big counter, "N pessoas sem resposta há mais de 1h útil" (the threshold and business hours come from the response).
  - **Table**: Nome, Telefone, Origem, Responsável, Última mensagem (dd/MM HH:mm SP), Aguardando ("3h 20min úteis"), and a "Ver conversa" button that opens `ChatViewer` for the row's contact (FR-031/032), with clicking the row doing the same. Default sort is the longest wait.
  - **Behavior**: respects the FilterBar origin and seller filters, hides the period control (not applicable) and auto-refreshes every 5 minutes.

**Checkpoint**: US1 is fully usable on its own (MVP).

---

## Phase 4: User Story 2 - Acompanhar produtividade por vendedor (Priority: P1)

**Goal**: Messages sent per seller per day and distinct deals worked per seller in the period.

**Independent Test**: quickstart V5. For 1 seller × 3 days, counts match Clint, days without activity show 0, and the inferred-attribution counter is visible.

- [X] T036 [US2] Create `src/metrics/sellers.ts` `getSellers(db, cfg, f)`:
  - **`days`**: `dayRange(from,to)` clipped to the message window start.
  - **`messages_per_day`** per seller: `COUNT(*)` of `messages` with `type='USER' AND content_type <> 'REACTION'` grouped by `attributed_user_id, created_day_sp`, zero-filled for every day. Messages are restricted by the origin and group filters through the chat's contact having a deal in those origins.
  - **`deals_worked`** per seller: the distinct deal ids where (a) an attributed USER message in the period was in a chat of the deal's contact, or (b) the deal's `updated_stage_at` is in the period and `deal.user_id` = that seller (data-model "Deals worked").
  - **Other fields**: `unattributed` for null sellers; `inferred_attribution_count` = messages in the period with `attribution IN ('chat','deal','none')`; the `user_ids` filter applies to the series.
  Add the route `GET /api/metrics/sellers` in `src/index.ts`.
- [X] T037 [US2] Create `web/src/pages/Vendedores.tsx`:
  - a line/bar chart (Chart.js) of messages per day with one series per seller plus "Sem responsável";
  - a summary table: Vendedor, Mensagens no período, Média/dia, Negócios trabalhados;
  - the footnote "X mensagens sem autor identificado foram atribuídas ao responsável pela conversa/negócio" from `inferred_attribution_count`.

**Checkpoint**: US1 and US2 work independently.

---

## Phase 5: User Story 3 - Volume de negócios criados por dia e por origem (Priority: P2)

**Goal**: Deals created per day split by origin, with totals per origin. New origins and campaigns show up automatically.

**Independent Test**: quickstart V6 and V7. For 10 days × 3 origins the counts match Clint 100%, and the "Lead Form São Paulo" deals appear under Aréola Flowers without configuration.

- [X] T038 [US3] Create `src/metrics/intake.ts` `getIntake(db, f)`: `SELECT origin_id, created_day_sp, COUNT(*) FROM deals d WHERE <dealWhere> AND created_day_sp BETWEEN from AND to GROUP BY 1,2`. It returns `{days, by_origin[{origin_id,name,per_day (zero-filled),total}], total}` sorted by total desc, with `meta`. Add the route `GET /api/metrics/intake` in `src/index.ts`.
- [X] T039 [US3] Create `web/src/pages/Entrada.tsx`: a stacked bar chart of deals per day by origin (top 8 origins plus "Outras"), and a table of Origem, Grupo, Total no período, % do total.

**Checkpoint**: US3 works on its own.

---

## Phase 6: User Story 4 - Negócios parados em aberto (Priority: P2)

**Goal**: Every open deal with "dias sem atividade" and "dias sem mudar de etapa", bucket distribution, sortable, with a Clint link.

**Independent Test**: quickstart V9. For 20 open deals both values match Clint within ±1 day. A deal 10 days in stage with a message 2 days ago shows 2 / 10.

- [X] T040 [US4] Create `src/metrics/stalled.ts` `getStalled(db, f, now, {sort, page, pageSize})`:
  - **Selection**: deals with `status='OPEN'` and `<dealWhere>`, ignoring `from`/`to`.
  - **`days_in_stage`** = `daysBetweenSP(updated_stage_at, now)`.
  - **`last_activity`** = max(`updated_stage_at`, max `chats.last_message_at` for the deal's contact); **`days_inactive`** = `daysBetweenSP(last_activity, now)`. With no chats, `days_inactive = days_in_stage`.
  - **`buckets`** on `days_inactive`: labels `0–3`, `4–7`, `8–15`, `16–30`, `30+`.
  - **Sort**: `sort=inactive` (default) or `stage`, desc.
  - **Paging**: `page_size` default 50, max 200.
  - **Item fields**: `deal_id`, `contact_id`, `contact_name`, `origin`, `stage` (label), `responsible`, `days_inactive`, `days_in_stage`, `clint_url` (null unless a template is set).
  Add the route `GET /api/metrics/stalled` in `src/index.ts`.
- [X] T041 [P] [US4] Create `tests/unit/stalled.test.ts`. It checks the 10-days-in-stage and message-2-days-ago example (2 / 10), a deal with no chats (equal values), bucket boundaries (3→"0–3", 4→"4–7", 30→"16–30", 31→"30+"), and that WON/LOST deals are excluded.
- [X] T042 [US4] Create `web/src/pages/Parados.tsx`: a bucket bar chart and a paged DataTable with Lead, Origem, Etapa, Responsável, Dias sem atividade, Dias sem mudar de etapa and a "Ver conversa" button opening `ChatViewer` (FR-032). A sort toggle switches between "sem atividade" and "sem mudar de etapa". The period control is hidden.

**Checkpoint**: US4 works on its own.

---

## Phase 7: User Story 5 - Análise de campanhas (UTMs) (Priority: P2)

**Goal**: Leads per campaign, ad and form, with open/won/lost counts. Deals without campaign data appear as "Sem campanha / Orgânico".

**Independent Test**: quickstart V8. For 5 campaigns the lead counts match Clint 100%, and deals without a campaign appear under "Sem campanha / Orgânico".

- [X] T043 [US5] Create `src/metrics/campaigns.ts` `getCampaigns(db, f, level)`:
  - **Grouping**: `level` ∈ `campaign|ad|form` maps to the column `campaign_name|ad_name|form_name`, with `COALESCE(col, 'Sem campanha / Orgânico')` as `key`.
  - **Counts**: `COUNT(*) leads`, `SUM(status='OPEN') open`, `SUM(status='WON') won`, `SUM(status='LOST') lost`, filtered by `<dealWhere>` and `created_day_sp` in the period. The optional `campaign`/`ad` params narrow the rows for drill-down.
  - **Order**: leads desc.
  Add the route `GET /api/metrics/campaigns` in `src/index.ts`.
- [X] T044 [US5] Create `web/src/pages/Campanhas.tsx`:
  - a horizontal bar ranking of the top 15 campaigns by leads;
  - a table with Campanha, Leads, Abertos, Ganhos, Perdidos, % ganho;
  - clicking a campaign drills into its ads (`level=ad&campaign=…`), and clicking an ad drills into forms, with a breadcrumb back;
  - a "Ver perfil desta campanha" link to Perfil with `campaign` pre-filled.

**Checkpoint**: US5 works on its own.

---

## Phase 8: User Story 6 - Perfil dos leads cruzado com campanha (Priority: P3)

**Goal**: Distribution of form answers (faturamento mensal, profissão), split by form/language, cross-filterable by campaign, ad and form.

**Independent Test**: quickstart V10. For one campaign the `faturamento_mensal` distribution matches Clint, PT and ES forms appear separately, and missing answers show as "Não informado".

- [X] T045 [US6] Create `src/metrics/profile.ts` `getProfile(db, cfg, f)`. For each `cfg.profileFields` entry `{key,label,entity}`:
  - **Answer source**: `json_extract(d.fields_json, '$.'||key)` for `entity="deal"`, or `json_extract(c.fields_json, ...)` joined through `deals.contact_id` for `entity="contact"`.
  - **Grouping**: by `COALESCE(d.form_name,'Sem formulário')` and answer (null/empty → "Não informado"), without summing across forms (FR-022).
  - **Filters**: `<dealWhere>` + period, with the `campaign`/`ad`/`form` cross-filters applied.
  - **Response**: `{questions[{key,label,by_form[{form,answers[{value,count}] sorted by count desc}]}]}`.
  Add the route `GET /api/metrics/profile` in `src/index.ts`.
- [X] T046 [US6] Create `web/src/pages/Perfil.tsx`:
  - campaign, ad and form selects (options from `/api/metrics/campaigns` for the current period) that write to the URL;
  - per question, one horizontal bar chart per form showing the answers, with "Não informado" in grey.
  Adding a question only requires editing `PROFILE_FIELDS` in `wrangler.toml` (FR-023).

**Checkpoint**: All six stories work independently.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T047 [P] Add loading, empty ("Nenhum dado para os filtros selecionados") and error states to every page in `web/src/pages/*.tsx`, and a responsive layout for phone width (tables scroll horizontally inside their card, filters collapse) in `web/src/styles.css`.
- [X] T048 [P] Check performance against SC-006 on the full backfilled data: run each `/api/metrics/*` route with no filters over a 90-day period via `wrangler dev --remote`. Any route slower than 1 s gets the missing index in `migrations/0002_indexes.sql`.
- [X] T049 [P] Write `README.md` in pt-BR:
  - what the dash shows;
  - how to change the password (`wrangler secret put DASH_PASSWORD`, which logs everyone out);
  - how to change business hours, the no-reply threshold and profile questions (`wrangler.toml` `[vars]` + deploy);
  - how to read the "atualizado às" banner;
  - known limits: messages only from the last 90 days, ~30% of messages with inferred seller, "won" = Clint WON status.
- [X] T050 Run the local validation: `npm run dev`, trigger the cron until the backfill finishes, then run quickstart V0, V2–V14 against the real data (no password). Record the results (pass/fail + notes) in `specs/001-crm-dashboard/validation.md`.
- [ ] T051 **(Later, after T050 and with the user logged in)** Deploy to the client's Cloudflare account. **A password is required**: `predeploy` blocks the deploy without the `DASH_PASSWORD` secret.
  - confirm the Workers plan (Paid recommended, plan risks);
  - `wrangler d1 create crm-andreia` and put its id in `wrangler.toml`;
  - `wrangler d1 migrations apply crm-andreia --remote`;
  - `wrangler secret put CLINT_API_TOKEN` and `wrangler secret put DASH_PASSWORD`;
  - `npm run deploy`, without touching the old "worker CRM Andrea Ferreira" Worker;
  - wait for the backfill (`last_sync_at` in the banner).
- [ ] T052 **(Later)** On the deployed dash, run quickstart V1 (login gate) and V12 (performance), plus a sample of V2/V14, and append the results to `specs/001-crm-dashboard/validation.md`. Optional: if the user wants an "Abrir na Clint" button, copy a deal URL from Clint and set `CLINT_DEAL_URL_TEMPLATE` (research R8).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup and blocks every story. Internal order: T006 → (T007, T008, T010) → T011 → (T013, T014, T015, T016, T018) → T019 → T020 → T021. T022, T023, T025 → T026 → (T027, T028).
- **US1–US6 (Phases 3–8)**: each depends only on Phase 2. They can be done in any order or in parallel. Recommended order is by priority: US1 → US2 → US3 → US4 → US5 → US6.
- **Polish (Phase 9)**: after the desired stories. T050 (local validation) comes first. T051 (deploy) waits for T050 and for the user to log into the client's Cloudflare. T052 needs T051.

### User Story Dependencies

- **US1**: Phase 2 only. It adds its recompute hook to `afterSync` in `src/sync/run.ts` and builds `ChatViewer`.
- **US4**: also reuses `ChatViewer` from US1 for its "Ver conversa" button. Without US1, the button is hidden.
- **US2**: Phase 2 only (attribution is already computed during the message sync).
- **US3**: Phase 2 only.
- **US4** (data): Phase 2 only (uses `chats.last_message_at`).
- **US5**: Phase 2 only.
- **US6**: Phase 2 only. The campaign select in T046 calls the US5 route; if US5 isn't done yet, the select stays empty and the profile still works unfiltered.

### Shared-file note

Every story adds one route line to `src/index.ts`, so those edits are sequential but trivial. Everything else in a story lives in its own `src/metrics/*.ts` and `web/src/pages/*.tsx` files.

---

## Parallel Examples

```bash
# Phase 2, after T006:
T007 src/config.ts  |  T008 src/lib/time.ts  |  T010 src/clint/types.ts  |  T012 tests/fixtures/clint/*

# Phase 2, after T011:
T013 src/sync/reference.ts  |  T015 src/sync/contacts.ts  |  T016 src/lib/attribution.ts  |  T018 src/sync/chats.ts

# After Phase 2, stories in parallel (different files):
US1 T029–T034, T035  |  US3 T038–T039  |  US4 T040–T042  |  US5 T043–T044

# Inside US1:
T031 tests/unit/noReply.test.ts | T033 tests/unit/chatViewer.test.ts | T034 web/src/chat/ChatViewer.tsx (after T032)
```

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 + Phase 2. The sync running and login working are already a milestone.
2. Phase 3 (US1, Sem resposta): the highest-value view.
3. **Stop and validate locally** with quickstart V0, V2–V4 and V14 against real data, then show it to Duda and the team.

### Incremental delivery

1. MVP (US1), then US2 (Vendedores): this completes P1.
2. US3 (Entrada), US4 (Parados) and US5 (Campanhas): the P2 views.
3. US6 (Perfil): P3.
4. Polish and local validation (T050). Deploy with a password (T051–T052) later.

### Out of scope (future spec)

Meta Ads data (investment, CPL, gender/age, per adset/ad sales) and the "fechamento de turma" view. They wait for Meta access (spec Assumptions).

---

## Follow-up (2026-10-11): visual redesign + "CRM" overview tab

- [X] T053 Restyle the SPA after the TRĒ Clinic reference dashboard (dark green tokens, serif titles, mono labels, pill tabs, period pill, KPI tones, bar lists, "De onde vem este número" cards) in `web/src/styles.css`, `web/src/components/*`, `web/src/pages/*`
- [X] T054 Add `GET /api/metrics/conversations` (distinct chats per day with seller / lead messages, reactions ignored, origin filter through the contact's deals) in `src/metrics/conversations.ts` + `tests/unit/conversations.test.ts`
- [X] T055 Add `histogram` (open deals per exact days without activity) to `GET /api/metrics/stalled` in `src/metrics/stalled.ts`
- [X] T056 New first tab "CRM" in `web/src/pages/Crm.tsx`: deals created by origin (click toggles the origin filter), deals created per day, conversations per day, stalled deals (day by day up to 30 + ranges above 30)
- [X] T057 Sync Clint loss reasons (`/v1/lost-status` → `lost_statuses`) and `deals.lost_status_id` (`migrations/0002_lost_status.sql`, `src/sync/reference.ts`, `src/sync/deals.ts`)
- [X] T058 Global status filter (`status=OPEN,WON,LOST`, checkboxes "Aberto / Ganho / Perdido" in the filter row) applied to deal-based views; open-deal views (Sem resposta, Parados) ignore it (`src/metrics/filters.ts`, `web/src/components/FilterBar.tsx`)
- [X] T059 `GET /api/metrics/status` (deals created in the period by status + loss reasons) and the "Perdidos" big number on the CRM tab with the reasons on hover (`src/metrics/status.ts`, `web/src/pages/Crm.tsx`, `tests/unit/status.test.ts`)
- [X] T060 Filter options show deals per origin/group in the period and open deals today; `/api/filters` accepts `from`/`to` (`src/index.ts`, `web/src/components/FilterBar.tsx`)
- [X] T061 Global campaign filter (`campaigns`, newline-separated, "Sem campanha / Orgânico" = no campaign) applied to every deal-based view (`src/metrics/filters.ts`, `web/src/components/FilterBar.tsx`)
- [X] T062 New "UTM" tab replacing "Campanhas": group by campaign / ad / form / utm_*; leads, % contacted, % replied, median time to first seller message, open, stalled +7d, won, lost, % won, top loss reason; leads per day for the top 5; lead→sale funnel chart; click a campaign to filter the dashboard (`src/metrics/utm.ts`, `web/src/pages/Utm.tsx`, `tests/unit/utm.test.ts`)
- [X] T063 Status filter becomes single-choice (Aberto / Ganho / Perdido), "Aberto" selected by default; the SPA always sends `status` (default `OPEN`) (`web/src/components/FilterBar.tsx`, `web/src/hooks.ts`)
- [X] T064 UTM tab: click the "Parados +7d" number to open the list of those leads (name, phone → WhatsApp, e-mail, days stalled, stage, responsible, deal link, conversation) with CSV download (`src/metrics/utm.ts` `getUtmStalledLeads`, `GET /api/metrics/utm-stalled`, `web/src/components/StalledLeadsModal.tsx`)
- [ ] T065 Set `CLINT_DEAL_URL_TEMPLATE` from a real Clint deal URL so "Abrir negócio" links work (needs the user)
- [X] T066 Meta Ads integration (read-only `META_API_TOKEN`, ads_read): hourly sync of daily ad-level insights (spend, impressions, clicks, leads = "lead" action only) into `meta_insights` (90-day backfill, last 3 days refreshed) (`migrations/0003_meta_insights.sql`, `src/meta/client.ts`, `src/sync/meta.ts`, `tests/unit/meta.test.ts`)
- [X] T067 UTM tab joins Meta spend by campaign/ad id: Investimento, Leads Meta (% that reached Clint), custo/lead and custo/venda (all statuses), plus KPIs (`src/metrics/utm.ts`, `web/src/pages/Utm.tsx`)
- [X] T068 UTM KPIs "Leads", "Atendidos", "Responderam" open the leads list; the list (`GET /api/metrics/utm-leads?kind=…`) switches between Todos / Atendidos / Não atendidos / Responderam / Não responderam / Parados +7d with counts, CSV download, WhatsApp/e-mail links and conversation (`src/metrics/utm.ts` `getUtmLeads`, `web/src/components/LeadsModal.tsx`)
