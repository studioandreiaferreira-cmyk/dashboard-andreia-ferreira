# HTTP API Contract: Dashboard de CRM

This is the internal JSON API served by the Worker and consumed by the dashboard SPA. It isn't a public API.

- **Base path**: `/api`
- **Auth**: every route except `POST /api/login` and `GET /api/auth-status` requires the `af_session` cookie (research R7). A missing or invalid cookie returns `401 {"error":"unauthorized"}`.
  - **Exception**: when `DASH_PASSWORD` is empty or unset (local use, research R13), no route requires the cookie.
- **Dates**: `YYYY-MM-DD`, in America/Sao_Paulo.

## Common query parameters (all `GET /api/metrics/*` routes)

| Param | Type | Default | Notes |
|---|---|---|---|
| `from` | date | today − 29 days | inclusive (FR-001) |
| `to` | date | today | inclusive |
| `origin_ids` | csv of ids | all | FR-002 |
| `group_ids` | csv of ids | all | selects every origin in the group (FR-002) |
| `user_ids` | csv of ids, `none` = Sem responsável | all | FR-003 |
| `campaign` | string | — | cross-filter (FR-021) |
| `ad` | string | — | |
| `form` | string | — | |

Every metrics response includes a `meta` object:

```json
{
  "meta": {
    "last_sync_at": "2026-10-11T14:10:02Z",
    "sync_ok": true,
    "message_window_start": "2026-07-13",
    "message_window_truncated": false
  }
}
```

- `message_window_truncated` is `true` when `from` is earlier than the message window, so the UI shows the warning required by FR-001a.
- `sync_ok=false` means the UI shows the stale-data warning (spec edge case) and still returns the last stored data.

## Routes

### `POST /api/login`
- **Request**: `{"password": "..."}`
- **200**: sets the cookie. Body `{"ok": true}`.
- **401**: `{"error":"invalid_password"}`.
- **429**: `{"error":"too_many_attempts","retry_after_s":900}`.

### `GET /api/auth-status`
```json
{"password_required": false, "authenticated": true}
```
When `password_required` is false, the SPA skips the login screen and shows the "Dash sem senha" banner.

### `POST /api/logout`
- **204**: clears the cookie.

### `GET /api/filters`
Options for the filter bar (FR-004).
```json
{
  "groups": [{"id":"…","name":"Comercial Brasil"}],
  "origins": [{"id":"…","name":"Aréola Flowers","group_id":"…","archived":false}],
  "users": [{"id":"…","name":"Carina Pimentel","active":true}],
  "meta": {…}
}
```

### `GET /api/metrics/sellers`
Seller activity (FR-005, FR-006, FR-007, FR-029).
```json
{
  "days": ["2026-10-01", "…"],
  "series": [
    {"user_id":"…","name":"Carina Pimentel","messages_per_day":[12,0,30,…],"messages_total":420,"deals_worked":57}
  ],
  "unattributed": {"messages_per_day":[…],"deals_worked":3},
  "inferred_attribution_count": 133,
  "meta": {…}
}
```
- `messages_per_day` has one entry per day in `days`, with zeros for days without activity.
- `unattributed` holds the messages that ended up with "Sem responsável".

### `GET /api/metrics/no-reply`
No-reply list (FR-008, FR-009, FR-010, FR-030). It ignores `from`/`to`: it is always "now".
```json
{
  "total": 14,
  "threshold_minutes": 60,
  "business_hours": {"days":[1,2,3,4,5],"start":"09:00","end":"18:00"},
  "items": [
    {
      "contact_id":"…","contact_name":"Maria Teste","phone":"5511999990001",
      "origin":"Aréola Flowers","responsible":"Carina Pimentel",
      "awaiting_since":"2026-10-09T20:31:00Z","business_minutes_waiting":540,
      "deal_id":"…","chat_id":"…","clint_url":null
    }
  ],
  "meta": {…}
}
```
- Items are sorted by `business_minutes_waiting` desc.
- Only contacts with ≥ 1 OPEN deal are included.
- Each contact appears once per chat.

### `GET /api/metrics/intake`
Deals created (FR-011, FR-012, FR-019).
```json
{
  "days": ["…"],
  "by_origin": [{"origin_id":"…","name":"Aréola Flowers","per_day":[3,5,…],"total":81}],
  "total": 230,
  "meta": {…}
}
```

### `GET /api/metrics/stalled`
Stalled open deals (FR-013, FR-014, FR-015). `from`/`to` are ignored because it considers all OPEN deals now; the other filters apply.

Extra params: `sort=inactive|stage` (default `inactive`), `page`, `page_size` (default 50, max 200).
```json
{
  "buckets": [{"label":"0–3","count":120},{"label":"4–7","count":80},{"label":"8–15","count":60},{"label":"16–30","count":40},{"label":"30+","count":900}],
  "total": 1200,
  "items": [
    {"deal_id":"…","contact_name":"…","origin":"…","stage":"AGENDAMENTO","responsible":"…",
     "days_inactive":2,"days_in_stage":10,"contact_id":"…","clint_url":null}
  ],
  "meta": {…}
}
```

### `GET /api/metrics/campaigns`
Campaign / ad / form breakdown (FR-016, FR-017, FR-018). Extra param: `level=campaign|ad|form` (default `campaign`).
```json
{
  "level": "campaign",
  "rows": [
    {"key":"🇨🇴 [LEAD][FORM] - COLOMBIA-MEDELLIN E BOGOTA [JUL|26] — SAUDE","leads":15,"open":12,"won":1,"lost":2}
  ],
  "meta": {…}
}
```
- Rows without campaign data appear under the key `"Sem campanha / Orgânico"`.

### `GET /api/metrics/profile`
Form-answer distributions (FR-020 to FR-023).
```json
{
  "questions": [
    {
      "key":"faturamento_mensal","label":"Faturamento mensal",
      "by_form":[
        {"form":"AREOLA FLOWER | PT","answers":[{"value":"até_3.000__","count":2},{"value":"Não informado","count":40}]}
      ]
    }
  ],
  "meta": {…}
}
```

### `GET /api/contacts/:contactId/chats`
Chat viewer header and the list of conversations (FR-032). This is a live call to Clint.
```json
{
  "contact": {"id":"…","name":"Maria Teste","phone":"5511999990001"},
  "deals": [{"id":"…","origin":"Aréola Flowers","stage":"AGENDAMENTO","status":"OPEN","responsible":"Carina Pimentel"}],
  "chats": [{"id":"…","channel":"Andreia Ferreira (WhatsApp)","last_message_at":"…","status":"OPEN"}]
}
```
`chats` are sorted by `last_message_at` desc, and the viewer opens the first one.

### `GET /api/chats/:chatId/messages?page=1`
Live messages, 50 per page, newest first (FR-031, FR-033, FR-034).
```json
{
  "page": 1, "has_more": true,
  "messages": [
    {"id":"…","created_at":"2026-10-09T20:31:00Z","side":"lead","seller_name":null,
     "content_type":"TEXT","text":"Obg","media":null,"reactions":[]},
    {"id":"…","created_at":"…","side":"seller","seller_name":"Carina Pimentel",
     "content_type":"AUDIO","text":null,"media":{"url":"https://file.clint.digital/….mp3","name":null,"seconds":20.1},"reactions":["🙏"]},
    {"id":"…","created_at":"…","side":"system","seller_name":null,"content_type":"TEXT","text":"Conversa atribuída a …","media":null,"reactions":[]}
  ]
}
```
- `side`: CUSTOMER → `lead`, USER → `seller`, EVENT → `system`.
- `seller_name` is resolved from `user_id`, then the chat's `user_id`; if neither exists, it is "Vendedor".
- REACTION messages are never returned as items; they are folded into the target message's `reactions`.

## Scheduled handler (not HTTP)

- **Every 10 minutes**: incremental sync (research R3). It updates `sync_state.last_success_at`, or `last_error` on failure.
- **Daily at 03:00 America/Sao_Paulo (06:00 UTC)**: full reconcile of deals and contacts, purge of messages older than 90 days and of old login attempts.
