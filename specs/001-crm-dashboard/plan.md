# Implementation Plan: Dashboard de CRM (Clint) — Studio Andreia Ferreira

**Branch**: `001-crm-dashboard` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-crm-dashboard/spec.md`

## Summary

A password-protected CRM dashboard for Studio Andreia Ferreira. It shows:
- seller activity: messages per day and deals worked;
- the list of leads awaiting a reply, with a link into Clint;
- deal intake per day and origin;
- stalled open deals: days inactive and days in stage;
- campaign (Meta Lead Ads "UTM") performance;
- lead-profile answers crossed with campaign;
- a read-only, WhatsApp-style conversation viewer inside the dash.

**Approach**:
- A single Cloudflare Worker on the client's account.
- Every 10 minutes it mirrors Clint data into D1: deals, origins, users and contacts via v1; chats and messages (90-day window) via v2.
- It serves a small Preact SPA plus a JSON API that answers every view with SQL aggregates over the mirror.
- The conversation viewer reads message content live from Clint through the Worker; content is never stored.
- **Delivery order**: run and validate locally first (no password), then publish to the client's Cloudflare with a password.

## Technical Context

**Language/Version**: TypeScript 5.x on the Cloudflare Workers runtime (workerd); Node 20+ for tooling.

**Primary Dependencies**:
- **Worker**: Hono (routing), Wrangler (build/deploy).
- **Frontend**: Vite + Preact + Chart.js.
- **Tests**: Vitest + `@cloudflare/vitest-pool-workers`.

**Storage**: Cloudflare D1 (SQLite) as a local mirror of Clint, see [data-model.md](./data-model.md). Secrets live in Worker secrets.

**Testing**:
- Vitest in the workers pool, with unit tests for the metric rules and integration tests for the API routes against seeded D1 and fixture-based Clint responses.
- The manual accuracy pass is in [quickstart.md](./quickstart.md).

**Target Platform**: Cloudflare Workers, with Cron Triggers and Static Assets, on the client's Cloudflare account. Phase one runs locally with `wrangler dev` + local D1 only.

**Project Type**: Web application (one Worker serving the API and the SPA).

**Performance Goals**:
- ≤ 3 s per view update for any filter combination (SC-006);
- data ≤ 15 min behind Clint (FR-025);
- initial backfill completed within about 1 h.

**Constraints**:
- Clint API limit of 500 requests/min; explicit `User-Agent` required (research R1).
- Worker subrequest limit per invocation: at most 800 per sync run.
- Client token never sent to the browser (FR-028).
- pt-BR UI; days bucketed in America/Sao_Paulo.

**Scale/Scope**:
- about 23.5k deals (18.5k open), 43 origins, 4 users, 7 channel accounts;
- about 1.5k chats and roughly 50–150k messages in the 90-day window;
- a handful of concurrent viewers;
- 6 dashboard tabs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template, so there are no ratified principles and no gates to evaluate. **Status: PASS (vacuous).**

General guardrails applied in place of a constitution:

| Guardrail | Status |
|---|---|
| Secrets out of code and the browser | ✅ Worker secrets; API proxied server-side |
| Simplest architecture meeting targets | ✅ 1 Worker + 1 D1; no queues, Durable Objects or external DB |
| Every computed metric covered by tests | ✅ planned unit tests per rule (research R4, R5, data-model "Key derived rules") |

**Post-design re-check**: PASS. Phase 1 added no new components.

> Recommendation: run `/speckit-constitution` before future features so later plans have real gates.

## Project Structure

### Documentation (this feature)

```text
specs/001-crm-dashboard/
├── plan.md              # This file
├── research.md          # Phase 0: Clint API findings, stack, sync, metric rules
├── data-model.md        # Phase 1: D1 schema + derived rules
├── quickstart.md        # Phase 1: setup + validation scenarios
├── contracts/
│   └── http-api.md      # Phase 1: dashboard JSON API + cron contract
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
wrangler.toml                 # Worker, D1 binding, cron triggers, static assets, vars
package.json
.dev.vars.example             # CLINT_API_TOKEN=, DASH_PASSWORD=
migrations/
└── 0001_init.sql             # D1 schema (data-model.md)

src/
├── index.ts                  # Hono app: /api routes + scheduled() handler
├── config.ts                 # parse vars: business hours, profile fields, URL templates
├── auth/
│   └── session.ts            # login, HMAC cookie, rate limit (R7)
├── clint/
│   ├── client.ts             # fetch wrapper: api-token, User-Agent, pagination, 429 backoff
│   └── types.ts              # Deal, Origin, User, Chat, Message, ChannelAccount
├── sync/
│   ├── run.ts                # orchestrates one run within the subrequest budget
│   ├── reference.ts          # origins, groups, stages, users, channel accounts
│   ├── deals.ts              # incremental + nightly reconcile
│   ├── contacts.ts
│   ├── chats.ts              # per channel account, last_message_at cursor
│   └── messages.ts           # per chat, attribution + reply state
├── metrics/
│   ├── filters.ts            # common WHERE builder (origin/group/user/campaign)
│   ├── sellers.ts            # FR-005..007, FR-029
│   ├── noReply.ts            # FR-008..010
│   ├── intake.ts             # FR-011..012
│   ├── stalled.ts            # FR-013..015
│   ├── campaigns.ts          # FR-016..019
│   └── profile.ts            # FR-020..023
├── chat/
│   └── viewer.ts             # live chat + messages proxy and mapping (R12, FR-031..035)
└── lib/
    ├── time.ts               # São Paulo day bucketing, business-minutes math
    └── attribution.ts        # message → seller fallback chain

web/                          # SPA (built by Vite into web/dist, served as static assets)
├── index.html
└── src/
    ├── main.tsx
    ├── api.ts
    ├── components/           # FilterBar, StaleBanner, DataTable, charts
    ├── pages/                # Login, Vendedores, SemResposta, Entrada, Parados, Campanhas, Perfil
    └── chat/                 # ChatViewer drawer: bubbles, day separators, media, reactions

tests/
├── fixtures/clint/           # anonymized real payload samples
├── unit/                     # time, attribution, noReply rules, stalled, filters
└── integration/              # sync against fixtures → D1; API routes
```

**Structure Decision**: a single repository holding one Worker (`src/`) and its SPA (`web/`), deployed together. Backend and frontend are split by folder, not by project, because they ship as one Worker.

## Risks & Open Items

| Item | Impact | Mitigation |
|---|---|---|
| Dash running without a password (local phase) | Lead names, phones and conversations exposed if published | No login only when `DASH_PASSWORD` is unset, with a red banner; `predeploy` blocks deploys without the secret (R13) |
| Client Cloudflare account on the Free plan | Backfill throttled by 50 subrequests/run and the D1 write cap | Confirm the plan before deploy; recommend Workers Paid ($5/month). The code still works on Free, but the backfill takes days |
| Exact Clint web URL unknown (R8) | Only the optional "Abrir na Clint" button | Conversations open in the in-dash viewer (R12); the button stays hidden until a template is set |
| `replied` flag semantics unclear (R4) | Wrong no-reply list if relied on | Compute from messages; use the flag only beyond the 90-day window |
| ~30% of seller messages without `user_id` (R5) | Per-seller counts | Fallback chain + "inferred" counter shown in the UI |
| Old dashboard ("worker CRM Andrea Ferreira") already on the client account | Name or route clash | Deploy under a new Worker name; switch the route only after validation (quickstart V1–V13) |
| Which stage means "venda" (reserve vs contract) | Only affects "won" in Campanhas | Use the Clint WON status for now; confirm with Pat |

## Complexity Tracking

No constitution violations to justify.
