# Data Model: Dashboard de CRM (Clint)

**Feature**: `001-crm-dashboard` | **Storage**: Cloudflare D1 (SQLite)

This is a local, read-only mirror of Clint data plus derived columns. The Clint ids (UUID strings) are the primary keys. All timestamps are stored as UTC ISO-8601 text. Day bucketing uses America/Sao_Paulo (see `day_sp` columns).

## Reference tables (full refresh each sync)

### `groups`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | Clint group id |
| name | TEXT | e.g. "Comercial Brasil", "STUDIO AF" |

### `origins`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | |
| group_id | TEXT FK → groups.id | nullable |
| archived_at | TEXT | null = active; archived origins remain filterable (spec edge case) |

### `stages`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| origin_id | TEXT FK → origins.id | |
| label | TEXT | |
| order | INTEGER | |
| type | TEXT | BASE / CUSTOM / CLOSING |

### `users`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | first + last name |
| email | TEXT | |
| active | INTEGER | 0 when no longer returned by Clint; history kept |

### `channel_accounts`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | |
| type | TEXT | WHATSAPP_OFFICIAL / WHATSAPP / INSTAGRAM |
| status | TEXT | CONNECTED / DISCONNECTED / CANCELLED (all are synced; cancelled ones still have history) |

## CRM tables (incremental)

### `contacts`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | |
| phone | TEXT | `ddi` + `phone` |
| email | TEXT | |
| fields_json | TEXT | raw custom fields (e.g. `role`) |
| updated_at | TEXT | |

### `deals`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| origin_id | TEXT FK → origins.id | |
| stage_id | TEXT FK → stages.id | |
| user_id | TEXT FK → users.id | nullable → "Sem responsável" |
| contact_id | TEXT FK → contacts.id | |
| status | TEXT | OPEN / WON / LOST |
| value | REAL | |
| created_at | TEXT | |
| created_day_sp | TEXT | `YYYY-MM-DD` in America/Sao_Paulo (FR-011) |
| updated_at | TEXT | sync cursor |
| updated_stage_at | TEXT | basis of "dias sem mudar de etapa" (FR-013) |
| won_at / lost_at | TEXT | |
| campaign_name | TEXT | from `fields.campaign_name`; null → "Sem campanha / Orgânico" (FR-018) |
| campaign_id | TEXT | |
| ad_name / ad_id | TEXT | |
| form_name / form_id | TEXT | |
| utm_source, utm_medium, utm_campaign, utm_content, utm_term | TEXT | filled if present in `fields` |
| fields_json | TEXT | raw deal fields (profile answers, e.g. `faturamento_mensal`) |
| deleted | INTEGER | 1 when missing from the nightly full pass |

Indexes: `(origin_id, created_day_sp)`, `(status, origin_id)`, `(campaign_name)`, `(contact_id, status)`, `(user_id)`.

### `chats`
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| contact_id | TEXT FK → contacts.id | |
| channel_account_id | TEXT FK | |
| user_id | TEXT FK → users.id | assigned attendant, nullable |
| status | TEXT | OPEN / CLOSED |
| last_message_at | TEXT | basis of "dias sem atividade" (FR-013) |
| last_response_at | TEXT | fallback for no-reply beyond the 90-day window |
| messages_synced_until | TEXT | `created_at` of the newest stored message (sync cursor) |

### `messages` (rolling 90-day window, FR-026)
| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| chat_id | TEXT FK → chats.id | |
| type | TEXT | USER (seller) / CUSTOMER (lead) / EVENT (ignored in metrics) |
| content_type | TEXT | TEXT / IMAGE / AUDIO / VIDEO / DOCUMENT / REACTION / … — REACTION is ignored in metrics (spec edge case) |
| sender_user_id | TEXT | Clint `user_id`, may be null |
| attributed_user_id | TEXT | after the fallback chain (FR-029); null = "Sem responsável" |
| attribution | TEXT | `direct` / `chat` / `deal` / `none` |
| created_at | TEXT | |
| created_day_sp | TEXT | day in America/Sao_Paulo (FR-005) |

Indexes: `(attributed_user_id, created_day_sp)`, `(chat_id, created_at)`.

Rows with `created_at < now - 90 days` are deleted nightly. Message **content is not stored**: the chat viewer (FR-031..035) reads it live from Clint through the Worker.

## Derived / operational tables

### `chat_reply_state` (recomputed for chats touched by each sync)
| Column | Type | Notes |
|---|---|---|
| chat_id | TEXT PK | |
| awaiting_since | TEXT | first CUSTOMER message after the last USER message; null = not waiting |
| has_open_deal | INTEGER | contact has ≥ 1 OPEN deal (clarified scope of the no-reply list) |
| responsible_user_id | TEXT | chat.user_id → open-deal owner → null |

The business-minutes elapsed value is computed at query time (it depends on "now" and the configured business hours).

### `sync_state`
| Column | Type | Notes |
|---|---|---|
| key | TEXT PK | e.g. `deals_cursor`, `chats_cursor:<channel_account_id>`, `last_success_at`, `last_error` |
| value | TEXT | |

The pending message-fetch queue is represented as the chats whose `last_message_at > messages_synced_until`.

### `login_attempts`
| Column | Type | Notes |
|---|---|---|
| ip | TEXT | |
| attempted_at | TEXT | rows older than 15 min are pruned |

## Configuration (not stored in D1)

| Name | Kind | Default |
|---|---|---|
| `CLINT_API_TOKEN` | secret | — |
| `DASH_PASSWORD` | secret | empty/unset = no login (local only, shows the "sem senha" banner); required before publishing (FR-027) |
| `BUSINESS_HOURS` | var (JSON) | `{"days":[1,2,3,4,5],"start":"09:00","end":"18:00","tz":"America/Sao_Paulo"}` (FR-030) |
| `NO_REPLY_MINUTES` | var | `60` (FR-008) |
| `MESSAGE_WINDOW_DAYS` | var | `90` (FR-026) |
| `PROFILE_FIELDS` | var (JSON) | `[{"key":"faturamento_mensal","label":"Faturamento mensal","entity":"deal"},{"key":"role","label":"Profissão","entity":"contact"}]` (FR-023) |
| `CLINT_DEAL_URL_TEMPLATE` | var | optional; empty = no "Abrir na Clint" button (FR-035) |

## Key derived rules

- **Metric messages** = `type IN ('USER','CUSTOMER') AND content_type <> 'REACTION'`. EVENT and REACTION are ignored by FR-005/006/008.
- **Deals worked** (FR-006): the distinct deals of a seller in the period where (a) a message attributed to that seller was sent in a chat of the deal's contact, or (b) the deal's `updated_stage_at` falls in the period and the deal's owner is that seller.
- **Dias sem mudar de etapa** = today_sp − `updated_stage_at`, in days.
- **Dias sem atividade** = today_sp − max(`updated_stage_at`, max `last_message_at` of the contact's chats). With no chats it equals the previous value.
- **Stalled-deal buckets** (FR-015): 0–3, 4–7, 8–15, 16–30, 30+ days.
- **Profile distribution** (FR-020/022): grouped by (`form_name`, answer); a missing answer counts as "Não informado".

## State transitions (from Clint, mirrored)

Deal: `OPEN → WON | LOST`, and `WON/LOST → OPEN` on reopen. A reopened deal re-enters "Parados" and makes its contact eligible for "Sem resposta" again (spec edge case).
