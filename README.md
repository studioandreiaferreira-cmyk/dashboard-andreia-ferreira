# Dashboard de CRM — Studio Andreia Ferreira

Dash do comercial alimentado pela Clint e pelo Meta Ads, no modelo dos dashes Social Nudge: **página estática + arquivo de dados regerado a cada 30 minutos**. Tudo roda nas contas da cliente, nos planos gratuitos:

- **Supabase** (projeto `itikdlckqicoobxnkldq`): Postgres com a cópia da Clint/Meta; `pg_cron` chama a Edge Function `sync` a cada 30 min, que sincroniza e publica o arquivo `dash/<SNAPSHOT_KEY>.json` no Storage; a função `chat` lê as conversas ao vivo na Clint.
- **Cloudflare** (Worker `af-crm-dashboard`, só arquivos): a página, em `https://af-crm-dashboard.studioandreiaferreira.workers.dev/<DASH_SLUG>/`.
- No navegador, o arquivo é carregado num SQLite em memória e as métricas de `src/metrics` rodam ali.
- Acesso por **link secreto** (sem senha): quem tem o link vê o dash. A raiz do domínio dá 404.

Detalhes e decisões: `specs/002-static-supabase/plan.md`.

## O que o dash mostra

| Aba | O que responde |
|---|---|
| **Sem resposta** | Quem está esperando resposta de um vendedor há mais de 1h útil. Só conta lead com pelo menos um negócio em aberto. Clicando no lead, a conversa abre dentro do dash. |
| **Vendedore## Configuração (`.env`, fora do git)

`SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (Session pooler), `SUPABASE_ACCESS_TOKEN`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DASH_SLUG` (caminho secreto da página), `SNAPSHOT_KEY` (nome secreto do arquivo de dados e chave do leitor de conversas), `CRON_KEY` (chave que o pg_cron manda para a função `sync`; também no Vault como `dash_cron_key`).
Tokens da Clint e do Meta ficam em `.dev.vars` e nos secrets das Edge Functions.

## Comandos

```bash
npm install
npm test                                  # testes (métricas e sync rodam contra um D1 local)
node scripts/build-functions.mjs          # empacota as Edge Functions (functions-src/ → supabase/functions/)
npx supabase functions deploy sync --project-ref itikdlckqicoobxnkldq --use-api --no-verify-jwt   # idem para chat
node scripts/deploy-page.mjs              # gera a página com as URLs do .env e publica no Cloudflare
node scripts/build-functions.mjs --local && node .build/sync-local.mjs [incremental|nightly] [--upload]   # rodar a sync daqui
```

Esquema do banco: `supabase/migrations/` (aplicadas com `psql "$SUPABASE_DB_URL" -f ...`). O esquema do SQLite do navegador e dos testes é `migrations/`; os dois precisam continuar iguais.

**Trocar o link**: gere outro `DASH_SLUG` (e/ou `SNAPSHOT_KEY`, atualizando o secret da função) e rode `node scripts/deploy-page.mjs`. O link antigo para de funcionar.

## Dados do Meta Ads

Com `META_API_TOKEN` configurado, o dash lê do Meta Ads, a cada hora, gasto, impressões, cliques e leads do formulário por anúncio e por dia (90 dias na primeira vez). A aba **UTM** cruza isso com a Clint pelo ID da campanha e do anúncio: investimento, leads no Meta × leads que chegaram na Clint, custo por lead e custo por venda.

- O token vem do usuário do sistema **"dash crm leitura"** da BM da cliente (app *andreia-flowers*), com permissão **só `ads_read`**.
- Sem o token, o dash funciona normalmente, só sem as colunas de investimento.
- Para trocar o token: gere outro no usuário do sistema e atualize o secret `META_API_TOKEN` das Edge Functions (`npx supabase secrets set`).

## Ajustes do dia a dia

Os ajustes abaixo são secrets das Edge Functions (`npx supabase secrets set NOME=valor --project-ref itikdlckqicoobxnkldq`); valem a partir da próxima rodada.

- **Horário comercial / tempo de "sem resposta"**: `BUSINESS_HOURS` e `NO_REPLY_MINUTES`. Dias da semana vão de 1 (segunda) a 7 (domingo).
- **Nova pergunta do formulário no Perfil**: acrescente `{"key":"nome_do_campo","label":"Nome na tela","entity":"deal"}` em `PROFILE_FIELDS` (`"entity":"contact"` se o campo fica no contato).
- **Botão "Abrir na Clint"** (opcional): `CLINT_DEAL_URL_TEMPLATE` com a URL de um negócio, trocando o id por `{deal_id}`.

## Como ler o "Atualizado às"

O topo mostra a última sincronização bem-sucedida. Se ela tiver mais de 30 minutos ou se a última tentativa deu erro, aparece uma faixa amarela. Os números continuam sendo os últimos dados válidos, nunca zerados.

## Limites conhecidos

- O histórico de **mensagens** cobre só os **últimos 90 dias**. Negócios têm o histórico completo. Ao escolher um período maior, as abas baseadas em mensagens avisam.
- Parte das mensagens dos vendedores chega da Clint **sem autor** (enviadas direto pelo celular). Elas são atribuídas ao responsável pela conversa ou pelo negócio, e a aba Vendedores mostra quantas foram atribuídas assim.
- **"Ganho"** é o status "ganho" da Clint. Se a venda for considerada em outra etapa (reserva ou contrato), isso precisa ser alinhado.
- Reações (ex.: 🙏) não contam como mensagem.

## Estrutura

- `src/`: sincronização (Clint, Meta), métricas, `snapshot.ts` (arquivo de dados), `routes.ts` (a "API" respondida no navegador), `db/` (Postgres e interface comum).
- `functions-src/`: Edge Functions `sync` e `chat` (empacotadas em `supabase/functions/`).
- `web/`: página (Preact + Chart.js + sql.js), visual Social Nudge.
- `migrations/`: esquema SQLite (navegador e testes); `supabase/migrations/`: Postgres, Storage e cron.
- `tests/`: testes (Vitest com D1 local).
- `specs/001-crm-dashboard/`: especificação, plano e tarefas.
