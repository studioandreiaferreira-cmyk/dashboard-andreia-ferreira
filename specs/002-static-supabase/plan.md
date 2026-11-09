# 002 — Dash estático + sincronização no Supabase

Decisões (Fillipi, 2026-10-21):
- Motivo: a conta Cloudflare da cliente está no Workers Free (50 subrequests/execução, cotas do D1); a sincronização não cabe.
- Modelo igual ao dash de referência https://dash.socialnudge.com.br/EAAblack1026: **página estática + arquivo de dados regerado periodicamente**.
- Hospedagem nas **contas da cliente**: página no Cloudflare dela (Worker só com assets, sem script → grátis/ilimitado);
  sincronização + banco no **Supabase dela** (projeto `itikdlckqicoobxnkldq`, us-west-2).
- Acesso por **link secreto** (sem senha), como a referência.
- **Visual copiado da referência** (Social Nudge: hero preto, acento lima, rótulos mono, cards, barras horizontais),
  mantendo o conteúdo já aprovado (abas CRM, UTM, Sem resposta, Vendedores, Entrada, Parados, Perfil).

## Arquitetura

```
pg_cron (*/10) ──► Edge Function `sync` ──► Clint API / Meta API
                         │  upsert (mesmo código de src/sync, adaptador Postgres)
                         ▼
                   Postgres (Supabase) ──► snapshot JSON (tabelas compactas)
                         │
                         ▼ upload
                   Storage público `dash/<chave-secreta>.json`
                         ▲ fetch
Navegador: página estática (Cloudflare) ── carrega o JSON num SQLite em memória (sql.js)
           e roda as MESMAS funções de src/metrics (as que rodavam no Worker).
Leitor de conversas: Edge Function `chat` (busca ao vivo na Clint, protegida pela chave do link).
```

- `src/db/types.ts`: interface `Db` (subconjunto da API do D1). Implementações: D1 (testes), Postgres (`src/db/postgres.ts`), sql.js (navegador).
- SQL do servidor (sync, recomputeReplyState, snapshot) precisa ser portável SQLite/Postgres.
- Edge functions empacotadas com esbuild (`scripts/build-functions.mjs`) → `supabase/functions/*/index.ts`.
- Reconciliação noturna em fatias com prazo (limite de 150 s por execução no plano free).

## Passos
1. Interface Db + adaptadores; portar sync para Db. Testes continuam no D1.
2. Schema Postgres (`supabase/migrations`), bucket `dash`, cron.
3. Snapshot builder (`src/snapshot.ts`).
4. Edge functions `sync` e `chat`; secrets; deploy.
5. Copiar dados do D1 local para o Postgres (carga inicial) e deixar o incremental alcançar.
6. Front: carregar snapshot no sql.js; `api()` vira roteador local; novo visual.
7. Cloudflare: Worker só com assets em `/<slug>/`; remover cron/D1 do Worker antigo.

## 2026-10-22 — painéis da referência
- Nome no topo: "Andreia Ferreira".
- Nova aba **Lançamento** (primeira): KPIs investido/leads/tráfego/orgânico/CPL, faixa CTR·CPC·CPM, leads por dia (tráfego×orgânico + investido),
  origem dos leads, todas as UTMs, funil comercial por origem (com evolução reconstruída pelas datas), fases por nome de campanha,
  criativos/públicos ranqueados por CPL (miniatura, CTR, hook 3s, preview), dia a dia, resumo para WhatsApp. `src/metrics/launch.ts`.
- Nova aba **Vendas**: negócios ganhos (dia do ganho, valor da Clint), ROAS/CPA com o Meta, por origem, criativo e campanha. `src/metrics/sales.ts`.
- Meta: novas colunas (link_clicks, landing_page_views, video_3s, purchases, purchase_value) e tabela `meta_ads` (miniatura/preview).
- Pendente: aba **Instagram** — o token atual só tem ads_read; precisa de instagram_basic, instagram_manage_insights, pages_show_list,
  pages_read_engagement e a conta do Instagram/página atribuídas ao usuário do sistema.
- Cache do Storage: a página busca o JSON com `?t=<minuto>` (o CDN do Supabase segura o arquivo sobrescrito).
