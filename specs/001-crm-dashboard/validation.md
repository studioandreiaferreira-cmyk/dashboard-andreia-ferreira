# Validation: Dashboard de CRM (local run)

**Date**: 2026-10-11 | **Environment**: `wrangler dev` + local D1, real Clint data (read-only), no password.

## Backfill

| Item | Result |
|---|---|
| Deals mirrored | 23,558 (API `totalCount` 23,556 earlier in the day ✔), 18,498 OPEN |
| Contacts | 21,034 (21,033 with custom fields) |
| Origins / users / channel accounts | 43 / 4 / 7 |
| Chats (90-day window) | 1,456 |
| Messages (metadata, 90 days) | 34,616 |
| Runs to complete backfill | 2 cron runs (~2.5 min + ~1 min) |
| Automated tests | 34/34 passing (`npm test`), `tsc --noEmit` clean |

## Scenarios (quickstart.md)

| # | Result | Notes |
|---|---|---|
| V0 Local without password | ✅ Pass | No login, red "Dash sem senha" banner |
| V1 Login gate | ⏳ Pending deploy | Auth code in place; validate with the password set (T052) |
| V2 No reply | ✅ Pass (spot check) | List loads (153 people); a case checked in the viewer was confirmed: the lead asked a question on 14/07 and had no reply |
| V3 Excludes closed deals | ✅ Pass | Unit test + `has_open_deal` filter |
| V4 Business hours | ✅ Pass | Unit tests (Fri 17:30 → Mon 09:29/09:31) |
| V5 Seller activity | ⚠️ Pending human check | Numbers load (7,941 messages in 30 days). Still needs a comparison with Clint for 1 seller × 3 days |
| V6 Intake | ⚠️ Pending human check | Total deals match the API; per-day × origin comparison with the Clint UI still needed |
| V7 New campaign appears | ✅ Pass | "🇧🇷 [LEAD][FORM] - SAO PAULO [13-15\|NOV\|26]" shows 259 leads (bug from the old dash fixed) |
| V8 Campaign counts | ⚠️ Pending human check | Drill-down campaign → ad works; compare 5 campaigns with Clint |
| V9 Stalled deals | ✅ Pass (unit) / ⚠️ sample check pending | |
| V10 Profile | ✅ Pass (spot check) | São Paulo: faturamento and profissão distributions render per form |
| V11 Window warning | ✅ Pass | `message_window_truncated` when the period is > 90 days |
| V12 Performance | ✅ Pass | All views 0.01–0.15 s locally (target ≤ 3 s); no extra indexes needed (T048) |
| V13 Stale data | ✅ Pass (code path) | `sync_ok=false` banner; data never wiped on error |
| V14 Chat viewer | ✅ Pass | Bubbles, seller name, day separators, system events, read-only footer |

## Findings for the client (real data)

1. **"Sem resposta" is dominated by old cases.** 100 of 153 people have been waiting more than 20 business days, while only 14 are within the last 5 days. These are leads with deals still OPEN in old funnels.
2. **Very large stalled backlog.** 17,973 of 18,498 open deals have had no activity for more than 30 days. The biggest origins are ARÉOLA FLOWER 4,954, REATIVAÇÃO CLINICA 3,554, Disparo Areola Flowers ES 2,273, AREOLA COLORS PRO - ESP 2,226 and DISPARO 15/06 - COLOMBIA 1,823. Some deals sit in stages named "Finalizado" but are still OPEN. Archiving or closing old funnels in Clint, or filtering by origin, makes both lists actionable.
3. **54% of seller messages have no author in Clint** (4,261 of 7,941 in 30 days), which is higher than the ~30% in the first sample. They are attributed through FR-029, and the dash shows the count.
