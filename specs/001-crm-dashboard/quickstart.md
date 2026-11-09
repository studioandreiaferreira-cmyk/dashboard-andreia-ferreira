# Quickstart & Validation: Dashboard de CRM

## Prerequisites

- Node 20+ and `npm`.
- `wrangler` (installed as a project dev dependency). A Cloudflare login is **not** needed for local runs; it is needed only to publish (`npx wrangler login` on the client's account).
- To publish only (not needed for local runs): the client account on **Workers Paid** (see plan.md risks).
- The Clint API token of the Andreia Ferreira account. Locally it is in the `env.` file as `CLINT_API_TOKEN_ANDREIA`; rename that file to `.env` / `.dev.vars` and keep it out of git.

## Local setup

```bash
npm install
cp .dev.vars.example .dev.vars          # set CLINT_API_TOKEN; leave DASH_PASSWORD empty for local use (no login)
npx wrangler d1 migrations apply crm-andreia --local
npm run dev                             # Worker + SPA on http://localhost:8787
curl -X POST "http://localhost:8787/__scheduled?cron=*/10+*+*+*+*"   # trigger a sync run (repeat until backfill completes)
npm test                                # unit + integration (vitest, workers pool)
```

## Deploy (later — after local validation)

The `predeploy` script refuses to deploy until `DASH_PASSWORD` is set as a secret (research R13).

```bash
npx wrangler login                      # client's Cloudflare account
npx wrangler d1 create crm-andreia      # put the returned id in wrangler.toml
npx wrangler d1 migrations apply crm-andreia --remote
npx wrangler secret put CLINT_API_TOKEN
npx wrangler secret put DASH_PASSWORD
npx wrangler deploy
```

The backfill runs through the cron schedule. The first full pass (deals plus 90 days of chats and messages) should finish within about 1 hour; progress is shown by `last_sync_at` in the dash header.

## Validation scenarios (map to spec success criteria)

| # | Scenario | How | Expected |
|---|---|---|---|
| V0 | Local without password | Run with `DASH_PASSWORD` empty | No login screen; red "Dash sem senha" banner; all views work |
| V1 | Login gate (FR-027, before deploy) | Open the dash without the cookie, then with a wrong password 11×, then with the right one | Without the cookie no data is shown; after the 11th wrong try you get 429; the right password opens the dash |
| V2 | No reply (US1, SC-001) | Pick a lead with an open deal whose last message is from the lead and is older than 1 business hour | The lead is on the "Sem resposta" list with the right seller and wait time; clicking the lead opens the conversation in the in-dash viewer; after a seller replies and the next sync runs, the lead leaves the list |
| V3 | No reply excludes closed deals | Pick a contact whose deals are all WON/LOST and who messaged last | Not listed |
| V4 | Business hours (FR-030) | Unit test: message at Fri 17:30 → still not "no reply" at Mon 09:29, becomes "no reply" at Mon 09:31 | Pass |
| V5 | Seller activity (US2) | For 1 seller × 3 days, count messages sent in Clint | Matches `messages_per_day`; days without activity show 0 |
| V6 | Intake (SC-002) | 10 days × 3 origins, compare with the Clint list filtered by origin and created date | 100% match |
| V7 | New campaign appears (SC-004) | A deal from "Lead Form São Paulo" (Aréola Flowers origin) | Appears in Entrada and Campanhas without any configuration |
| V8 | Campaign counts (SC-003) | 5 campaigns, compare the number of deals with `campaign_name` in Clint | 100% match; deals without a campaign show under "Sem campanha / Orgânico" |
| V9 | Stalled deals (SC-005) | 20 open deals: compare `days_in_stage` with the stage-change date and `days_inactive` with the last message | Within ±1 day |
| V10 | Profile (US6) | Pick a campaign, compare the `faturamento_mensal` answers with Clint | Distributions match; PT and ES forms appear separately; missing answers show as "Não informado" |
| V11 | Window warning (FR-001a) | Select a period longer than 90 days | Deal views cover the whole period; message views show the "90 dias" warning |
| V12 | Performance (SC-006) | Change filters on the deployed dash | Each view updates in ≤ 3 s |
| V13 | Stale data | Set an invalid token and run a sync | The dash keeps the last data, shows the last-update time and a warning |
| V14 | Chat viewer (FR-031..035) | From "Sem resposta" and "Parados", open a lead with audio and image messages; scroll up | WhatsApp-style bubbles (lead left, seller right with name), day separators, audio plays, image opens, reactions shown on the target message, older messages load past 90 days, no send box |
