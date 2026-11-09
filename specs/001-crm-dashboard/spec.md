# Feature Specification: Dashboard de CRM (Clint) — Studio Andreia Ferreira

**Feature Branch**: `001-crm-dashboard`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "essa é a documentacao da Clint da cliente Andreia ferreira https://clint-api.readme.io/reference/get_v1-contacts , eu coloquei no .env a variavel da clint da Andreia da Clint, [...] essa é a transcricao da nossa call, ela fez varios pedidos, a parte de marketing eu vou preicsar liberar permissao mais tarde, mas vamos montar o dash do CRM, ali no dash eu quero que tenha, mensagens enviadas por dia do vendedor, negocios trabalhados por vendedor, quantas pessoas ficaram sem respostas e quais pessoas com o link para poder abrir a conversa e ja resolver, quantidade de negocios criados por dia e por origem, quantos dias cada negocio esta parado em aberto, quero filtros de origem, quero uma visao para poder analisar as utms dos negocios apra saber qual campanha esta trazendo mais leads, poder analisar as UTMS + o perfil dos negocios ou seja, o que os leads estao respondendo no formulario e caindo na clint"

**Contexto adicional**: Transcrição da call "Fillipi + Duda – alinhamento do dash" (2026-09-30). Pontos relevantes da call para este escopo: (a) campanhas novas que entram em uma origem já existente (ex.: "Lead Form São Paulo" dentro de Comercial Brasil → Aréola Flowers) não estavam aparecendo no dash anterior; (b) o perfil dos leads deve refletir as respostas do formulário (ex.: faturamento mensal, profissão) independentemente de qual formulário foi usado; (c) a análise de tráfego cruzada com Meta (investimento, custo por lead, vendas por conjunto/anúncio) fica para uma fase posterior, após liberação de acesso.

## Clarifications

### Session 2026-10-11

- Q: Como as pessoas vão entrar no dash? → A: Senha única compartilhada (mesma senha para todos os usuários autorizados).
- Q: De quanto tempo pra trás o dash precisa mostrar dados de mensagens e conversas? → A: Últimos 90 dias (negócios mantêm histórico completo).
- Q: Quais conversas devem entrar na lista de "sem resposta"? → A: Só conversas de leads com pelo menos um negócio em aberto.
- Q: O que conta como "negócio parado"? → A: Duas medidas lado a lado — "dias sem mudar de etapa" e "dias sem atividade" (etapa ou mensagem, o mais recente); lista ordenada por dias sem atividade.
- Q: Como abrir a conversa do lead? → A: Leitor de conversa dentro do próprio dash, no estilo WhatsApp (balões, lead de um lado e vendedor do outro), somente leitura; o link para a Clint vira opcional.
- Q: Senha agora? → A: Por enquanto sem senha, só rodando localmente; a senha passa a ser obrigatória antes de publicar na Cloudflare.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resgatar leads sem resposta (Priority: P1)

A gestora comercial abre o dash e vê quantas pessoas estão aguardando resposta de um vendedor e a lista nominal dessas pessoas, cada uma com um botão que abre a conversa dentro do próprio dash (estilo WhatsApp), para que o atendimento seja retomado na hora.

**Why this priority**: É a métrica que gera ação imediata e evita perda de venda; lead que fica sem resposta esfria. Foi citada explicitamente na call como pergunta que o time quer responder ("teve alguma conversa que ficou sem resposta?").

**Independent Test**: Com pelo menos um lead cuja última mensagem foi enviada por ele e não respondida, abrir o dash, conferir que ele aparece na lista com o vendedor responsável e o tempo de espera, clicar no lead e confirmar que a conversa correta abre no leitor do dash.

**Acceptance Scenarios**:

1. **Given** um negócio aberto cuja última mensagem foi do lead há mais tempo que o limite de espera, **When** a gestora abre o dash, **Then** o negócio aparece na lista "Sem resposta" com nome do lead, origem, vendedor responsável, horário da última mensagem e tempo aguardando.
2. **Given** a lista "Sem resposta", **When** a gestora clica em um lead, **Then** a conversa daquele lead abre no leitor de conversa do dash, com as mensagens em ordem cronológica, lead de um lado e vendedor do outro, com nome do vendedor e horário de cada mensagem.
3. **Given** o leitor aberto, **When** a gestora rola para cima, **Then** mensagens mais antigas são carregadas (inclusive anteriores à janela de 90 dias).
4. **Given** uma mensagem de áudio, imagem ou documento, **When** aparece no leitor, **Then** é exibida (player/miniatura/link do arquivo) ou, se o arquivo não estiver disponível, identificada pelo tipo (ex.: "🎤 Áudio").
5. **Given** que o vendedor respondeu o lead, **When** o dash é atualizado, **Then** o lead sai da lista e o contador diminui.
6. **Given** o filtro de origem aplicado, **When** a gestora vê a lista, **Then** só aparecem leads das origens selecionadas.

---

### User Story 2 - Acompanhar produtividade por vendedor (Priority: P1)

A gestora vê, por vendedor e por dia, quantas mensagens foram enviadas e quantos negócios distintos cada vendedor trabalhou no período.

**Why this priority**: Pedido direto do cliente; dá visibilidade de esforço comercial e permite comparar vendedores.

**Independent Test**: Escolher um período e um vendedor, conferir o total de mensagens enviadas por dia e o total de negócios trabalhados contra o que se vê na Clint para uma amostra de dias.

**Acceptance Scenarios**:

1. **Given** um período selecionado, **When** a gestora abre a visão de vendedores, **Then** vê um gráfico/tabela de mensagens enviadas por dia, separado por vendedor.
2. **Given** um período selecionado, **When** a gestora vê "Negócios trabalhados", **Then** cada vendedor mostra a quantidade de negócios distintos em que atuou (enviou mensagem ou movimentou etapa) no período.
3. **Given** um dia sem atividade de um vendedor, **When** o gráfico é exibido, **Then** o dia aparece com zero, sem lacuna.

---

### User Story 3 - Volume de negócios criados por dia e por origem (Priority: P2)

A gestora vê quantos negócios foram criados por dia, quebrados por origem, e pode filtrar por uma ou mais origens.

**Why this priority**: Mostra o fluxo de entrada de leads e confirma rapidamente se uma campanha nova está realmente caindo no CRM (problema identificado na call com a campanha de São Paulo).

**Independent Test**: Criar (ou identificar) negócios em uma origem em um dia específico e verificar que o total daquele dia/origem no dash bate com a Clint.

**Acceptance Scenarios**:

1. **Given** um período, **When** a gestora abre a visão de entrada, **Then** vê negócios criados por dia, empilhados/segmentados por origem, e o total do período por origem.
2. **Given** uma origem nova ou uma campanha nova dentro de uma origem existente, **When** negócios entram por ela, **Then** eles aparecem no dash sem necessidade de configuração manual.
3. **Given** o filtro de origem, **When** a gestora seleciona uma ou mais origens (ou um grupo de origens, ex.: "Comercial Brasil"), **Then** todas as visões do dash passam a considerar apenas essas origens.

---

### User Story 4 - Negócios parados em aberto (Priority: P2)

A gestora vê, para cada negócio em aberto, há quantos dias ele está sem atividade (sem mudar de etapa e sem mensagens) e há quantos dias está sem mudar de etapa, podendo ordenar por qualquer das duas medidas e abrir o negócio na Clint.

**Why this priority**: Ajuda a limpar o funil e priorizar follow-up; complementa a lista de sem resposta.

**Independent Test**: Escolher um negócio aberto com data conhecida da última mudança de etapa e conferir que o número de dias exibido está correto.

**Acceptance Scenarios**:

1. **Given** negócios com status aberto, **When** a gestora abre a visão "Parados", **Then** vê cada negócio com lead, origem, etapa atual, vendedor, dias sem atividade, dias sem mudar de etapa e botão para abrir a conversa no leitor do dash, ordenado por dias sem atividade (maior primeiro).
2. **Given** um negócio que está há 10 dias na mesma etapa mas teve mensagem trocada há 2 dias, **When** a visão é exibida, **Then** ele mostra 2 dias sem atividade e 10 dias sem mudar de etapa.
3. **Given** a visão "Parados", **When** a gestora ordena por dias sem mudar de etapa, **Then** a lista é reordenada por essa medida.
4. **Given** a visão "Parados", **When** a gestora olha o resumo, **Then** vê a distribuição (por dias sem atividade) em faixas (ex.: 0–3, 4–7, 8–15, 16–30, 30+ dias).
3. **Given** negócios ganhos ou perdidos, **When** a visão é exibida, **Then** eles não aparecem.

---

### User Story 5 - Análise de campanhas (UTMs) (Priority: P2)

A gestora/time de marketing vê quantos leads (negócios) cada campanha, anúncio e formulário trouxe, para saber qual campanha está trazendo mais leads, e quantos desses avançaram ou foram ganhos.

**Why this priority**: Pedido direto ("saber qual campanha está trazendo mais leads"); é a ponte para a futura análise de tráfego com dados da Meta.

**Independent Test**: Para uma campanha conhecida, conferir que o número de negócios atribuídos a ela no período bate com a contagem feita na Clint.

**Acceptance Scenarios**:

1. **Given** um período e filtros, **When** a gestora abre a visão de campanhas, **Then** vê o ranking de campanhas por quantidade de leads, com possibilidade de detalhar por anúncio e por formulário.
2. **Given** uma campanha, **When** a gestora a detalha, **Then** vê também quantos desses negócios estão abertos, ganhos e perdidos.
3. **Given** negócios sem informação de campanha (ex.: indicação, entrada manual), **When** a visão é exibida, **Then** eles aparecem agrupados como "Sem campanha / Orgânico", e não somem.

---

### User Story 6 - Perfil dos leads cruzado com campanha (Priority: P3)

A gestora vê o que os leads responderam no formulário (ex.: faturamento mensal, profissão) e consegue cruzar essas respostas com a campanha/anúncio de origem, para entender qual campanha traz qual perfil.

**Why this priority**: Gera insight de qualidade de lead por campanha (ex.: "o conjunto para médicos custa mais, mas quem compra são profissionais da beleza"), mas depende das visões de campanha já existirem.

**Independent Test**: Selecionar uma campanha e verificar que a distribuição de respostas de "faturamento mensal" exibida bate com as respostas dos negócios dessa campanha na Clint.

**Acceptance Scenarios**:

1. **Given** um período, **When** a gestora abre a visão de perfil, **Then** vê a distribuição de respostas para cada pergunta de formulário disponível (ex.: faturamento mensal, profissão).
2. **Given** a visão de perfil, **When** a gestora seleciona uma campanha (ou anúncio), **Then** as distribuições passam a refletir só os leads dessa campanha.
3. **Given** respostas equivalentes escritas de formas diferentes em formulários de idiomas diferentes (ex.: "até 3.000" e "menos de $500"), **When** a distribuição é exibida, **Then** cada resposta aparece como está, agrupada por formulário/idioma, sem misturar faixas de moedas diferentes.
4. **Given** leads que não responderam a pergunta, **When** a distribuição é exibida, **Then** aparecem como "Não informado", com sua contagem.

---

### Edge Cases

- Campanha nova dentro de uma origem já existente: precisa aparecer automaticamente (regressão observada no dash anterior).
- Origens arquivadas na Clint: seus negócios históricos continuam contando nos períodos em que existiram; a origem continua disponível no filtro, marcada como arquivada.
- Negócio sem vendedor atribuído: aparece como "Sem responsável" em todas as visões por vendedor.
- Vendedor removido/inativo: histórico dele continua visível no período em que atuou.
- Mensagem de vendedor sem identificação de autor (~30% numa amostra de out/2026, enviadas pelo celular): atribuída conforme FR-029, para não sumir das contagens.
- Lead que escreve fora do horário comercial: o relógio de "sem resposta" só começa a contar no início do próximo expediente.
- Lead que mandou várias mensagens seguidas sem resposta: conta como uma pessoa sem resposta (não uma por mensagem); o tempo de espera conta a partir da primeira mensagem não respondida.
- Negócio aberto sem nenhuma conversa: "dias sem atividade" = "dias sem mudar de etapa".
- Lead sem negócio em aberto (só ganhos/perdidos ou sem negócio) que manda mensagem: não entra na lista de sem resposta; se um negócio dele for reaberto, passa a entrar.
- Mesmo contato com vários negócios (em origens diferentes): na lista de sem resposta aparece uma vez por conversa; nas contagens de negócios cada negócio conta separadamente.
- Respostas de formulário em idiomas/moedas diferentes (PT, ES; R$, US$): não são somadas em uma mesma faixa.
- Fuso horário: "por dia" usa o horário de Brasília, para que um negócio criado às 23h não caia no dia seguinte.
- Fonte de dados indisponível no momento da consulta: o dash mostra os últimos dados válidos com o horário da última atualização e um aviso, em vez de números zerados.
- Período maior que 90 dias: visões de negócios mostram o período todo; visões de mensagens mostram só os últimos 90 dias, com aviso.
- Lead aguardando resposta há mais de 90 dias: continua na lista de sem resposta (o status da conversa vem da Clint, não do histórico de mensagens).
- Lead com mais de uma conversa (ex.: números de WhatsApp diferentes): o leitor mostra a lista de conversas e abre a mais recente.
- Reações (emoji em resposta a uma mensagem) não contam como mensagem enviada (FR-005) nem como mensagem do lead aguardando resposta (FR-008).
- Conversa sem mensagens disponíveis: o leitor mostra "Nenhuma mensagem encontrada".
- Senha não configurada (uso local): o dash funciona sem login e mostra o aviso "Dash sem senha — não publicar".
- Senha incorreta: o dash não mostra nenhum dado; após várias tentativas erradas seguidas, novas tentativas são temporariamente bloqueadas.
- Volume: a base atual tem ~23.500 negócios e ~43 origens; as visões precisam funcionar com esse volume e crescimento.

## Requirements *(mandatory)*

### Functional Requirements

**Filtros globais**

- **FR-001**: O dash MUST ter um filtro de período (padrão: últimos 30 dias) aplicado a todas as visões.
- **FR-001a**: Quando o período selecionado for além dos últimos 90 dias, as visões baseadas em mensagens (FR-005, FR-006, FR-008, FR-009) MUST mostrar só os dias disponíveis e avisar que o histórico de mensagens cobre apenas os últimos 90 dias.
- **FR-002**: O dash MUST ter um filtro de origem com seleção múltipla, permitindo também selecionar um grupo de origens inteiro (ex.: "Comercial Brasil", "STUDIO AF").
- **FR-003**: O dash MUST ter um filtro de vendedor com seleção múltipla.
- **FR-004**: A lista de origens e vendedores nos filtros MUST ser obtida automaticamente do CRM, sem cadastro manual, incluindo origens novas.

**Atividade dos vendedores**

- **FR-005**: O dash MUST exibir a quantidade de mensagens enviadas por vendedor por dia no período.
- **FR-006**: O dash MUST exibir a quantidade de negócios distintos trabalhados por vendedor no período, onde "trabalhado" = o vendedor enviou ao menos uma mensagem no negócio ou mudou o negócio de etapa no período.
- **FR-007**: As visões de vendedor MUST exibir dias sem atividade como zero.

**Sem resposta**

- **FR-008**: O dash MUST exibir o total de pessoas sem resposta, considerando apenas conversas de leads com pelo menos um negócio em aberto, onde "sem resposta" = a última mensagem da conversa foi enviada pelo lead e não houve resposta de um vendedor há mais de 1 hora, contada somente dentro do horário comercial (ex.: mensagem recebida às 17h30 de sexta, com expediente até 18h, vira "sem resposta" às 9h30 de segunda).
- **FR-009**: O dash MUST listar cada pessoa sem resposta com: nome, telefone, origem, vendedor responsável, data/hora da última mensagem dela, tempo aguardando e um botão que abre a conversa no leitor do dash (FR-031).
- **FR-010**: A lista de sem resposta MUST ser ordenada pelo maior tempo aguardando primeiro.

**Entrada de negócios**

- **FR-011**: O dash MUST exibir a quantidade de negócios criados por dia, segmentada por origem.
- **FR-012**: O dash MUST exibir o total de negócios criados no período por origem.

**Negócios parados**

- **FR-013**: O dash MUST exibir, para cada negócio em aberto, duas medidas: "dias sem mudar de etapa" (desde a última mudança de etapa) e "dias sem atividade" (desde o mais recente entre a última mudança de etapa e a última mensagem trocada na conversa do lead, em qualquer direção).
- **FR-014**: O dash MUST listar os negócios em aberto com lead, origem, etapa atual, vendedor, dias sem atividade, dias sem mudar de etapa e botão que abre a conversa no leitor do dash (FR-031), ordenados por dias sem atividade decrescente, permitindo reordenar por dias sem mudar de etapa.
- **FR-015**: O dash MUST exibir a distribuição de negócios em aberto por faixas de dias sem atividade (0–3, 4–7, 8–15, 16–30, 30+).

**Campanhas (UTMs)**

- **FR-016**: O dash MUST exibir a quantidade de negócios por campanha, e permitir detalhar por anúncio e por formulário de origem.
- **FR-017**: Para cada campanha, o dash MUST exibir quantos negócios estão abertos, ganhos e perdidos.
- **FR-018**: Negócios sem dados de campanha MUST aparecer agrupados como "Sem campanha / Orgânico".
- **FR-019**: Campanhas novas MUST aparecer automaticamente assim que o primeiro negócio dela entra no CRM.

**Perfil dos leads**

- **FR-020**: O dash MUST exibir a distribuição das respostas de formulário disponíveis nos negócios/contatos (no mínimo: faturamento mensal e profissão), incluindo "Não informado".
- **FR-021**: O dash MUST permitir cruzar o perfil com campanha, anúncio e formulário (selecionar uma campanha filtra o perfil, e vice-versa).
- **FR-022**: Respostas de formulários em idiomas/moedas diferentes MUST ser exibidas separadas por formulário/idioma, sem somar faixas incompatíveis.
- **FR-023**: Novas perguntas de formulário que passem a ser preenchidas nos negócios MUST poder ser adicionadas ao perfil sem reconstruir o dash (configuração simples).

**Dados e acesso**

- **FR-024**: O dash MUST mostrar a data/hora da última atualização dos dados.
- **FR-025**: Os dados do dash MUST estar no máximo 15 minutos defasados em relação à Clint (exceto quando indicado em FR-026).
- **FR-026**: Os dados de mensagens (FR-005, FR-006, FR-008, FR-009) MUST vir das conversas e do histórico de mensagens da própria Clint, cobrindo os últimos 90 dias (janela móvel). Dados de negócios (FR-011 a FR-023) mantêm o histórico completo.
- **FR-029**: Quando a Clint não informar qual vendedor enviou uma mensagem (ex.: enviada direto pelo celular), a mensagem MUST ser atribuída ao responsável pela conversa; se não houver, ao responsável pelo negócio; se não houver nenhum, a "Sem responsável". O dash MUST mostrar quantas mensagens foram atribuídas dessa forma.
- **FR-030**: O horário comercial usado em FR-008 MUST ser configurável (dias da semana e horário de início/fim).
- **FR-027**: Enquanto o dash roda só localmente, o acesso MAY ser sem senha (com aviso visível de "sem senha"). Antes de publicar em qualquer endereço acessível pela internet, o acesso MUST exigir uma senha única compartilhada; sem a senha correta nenhum dado (incluindo nome e telefone de leads) é exibido. A senha MUST poder ser trocada pelo responsável técnico sem reconstruir o dash, e a troca invalida as sessões abertas.
- **FR-028**: A credencial de acesso à Clint MUST ficar fora do código e nunca ser exposta ao navegador de quem acessa o dash.

**Leitor de conversa**

- **FR-031**: O dash MUST ter um leitor de conversa somente leitura, no estilo de aplicativo de chat: mensagens do lead à esquerda e do vendedor à direita (com o nome do vendedor), data/hora em cada mensagem, separadores por dia e eventos do sistema em destaque discreto.
- **FR-032**: O leitor MUST abrir a partir da lista "Sem resposta" e da lista "Parados", mostrando no topo nome, telefone, origem, etapa e vendedor do lead.
- **FR-033**: O leitor MUST carregar as mensagens mais recentes primeiro e permitir carregar mais antigas, sem limite da janela de 90 dias.
- **FR-034**: O leitor MUST exibir áudio (player com duração), imagem e vídeo (miniatura que amplia) e documento (nome do arquivo + link) quando o arquivo estiver disponível e, caso contrário, indicar o tipo da mídia. Reações (ex.: 🙏) MUST aparecer sobre a mensagem reagida, não como mensagem separada.
- **FR-035**: O leitor MUST NOT permitir enviar mensagens nesta fase. Um botão "Abrir na Clint" MAY aparecer quando o endereço da Clint estiver configurado.

### Key Entities *(include if feature involves data)*

- **Negócio**: oportunidade no CRM. Atributos: origem, etapa atual, status (aberto/ganho/perdido), vendedor responsável, contato, data de criação, data da última mudança de etapa, datas de ganho/perda, valor, dados de campanha (campanha, anúncio, formulário) e respostas de formulário.
- **Contato (lead)**: pessoa. Atributos: nome, telefone, e-mail, Instagram, etiquetas, campos personalizados (ex.: profissão).
- **Origem**: funil/pipeline, pertencente a um grupo (ex.: Comercial Brasil, STUDIO AF), com etapas ordenadas; pode estar arquivada.
- **Etapa**: posição do negócio no funil (tipo base, personalizada ou de fechamento).
- **Vendedor (usuário)**: membro do time que atende negócios e envia mensagens.
- **Mensagem**: comunicação em uma conversa, com direção (enviada pelo vendedor / recebida do lead), autor, data/hora e negócio/contato associado.
- **Campanha / Anúncio / Formulário**: atributos de aquisição do negócio, vindos do formulário de lead (Meta Lead Ads) ou de outras fontes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A gestora identifica quem está sem resposta e lê a conversa do primeiro lead da lista, dentro do dash, em menos de 30 segundos a partir da abertura do dash.
- **SC-002**: Para uma amostra de 10 dias e 3 origens, a contagem de negócios criados por dia/origem no dash bate 100% com a contagem na Clint.
- **SC-003**: Para uma amostra de 5 campanhas, a quantidade de leads por campanha no dash bate 100% com a contagem na Clint.
- **SC-004**: 100% das campanhas que geraram negócios no período aparecem na visão de campanhas, incluindo campanhas novas dentro de origens existentes (ex.: Lead Form São Paulo).
- **SC-005**: Para uma amostra de 20 negócios abertos, "dias sem mudar de etapa" e "dias sem atividade" batem com a data da última mudança de etapa e da última mensagem na Clint (diferença máxima de 1 dia por fuso).
- **SC-006**: Qualquer combinação de filtros atualiza as visões em até 3 segundos para o volume atual (~23.500 negócios).
- **SC-007**: A gestora e as vendedoras conseguem responder, sem ajuda, "qual campanha trouxe mais leads no mês" e "qual o perfil de faturamento dos leads da campanha X" na primeira sessão de uso.
- **SC-008**: O número de leads sem resposta acima do tempo limite cai em relação à primeira semana de uso (meta de negócio, medida após 30 dias).

## Assumptions

- Fonte dos dados de CRM: a conta Clint do Studio Andreia Ferreira, via a credencial já fornecida. Hoje há ~23.500 negócios, ~43 origens e 4 usuários.
- "UTMs" = dados de aquisição já gravados nos negócios pelo formulário de lead da Meta (nome da campanha, anúncio, formulário e respectivos IDs). Parâmetros `utm_*` de páginas/landing pages serão incluídos se e quando passarem a ser gravados nos negócios.
- "Perfil" = respostas de formulário gravadas no negócio/contato; hoje os campos identificados são faturamento mensal (negócio) e profissão (contato). Outros campos serão adicionados conforme forem preenchidos.
- "Dias sem atividade" usa a data da última mensagem registrada na conversa do lead (informação da própria conversa), então não fica limitado à janela de 90 dias do histórico de mensagens.
- "Por dia" segue o fuso de Brasília (America/Sao_Paulo).
- Horário comercial padrão: segunda a sexta, 9h–18h (Brasília), ajustável conforme FR-030.
- A Clint guarda conversas e mensagens com histórico, separando mensagens do lead e do vendedor, e marca se cada conversa foi respondida.
- O conteúdo das mensagens é lido da Clint na hora em que o leitor é aberto (não fica guardado no dash); só os metadados das mensagens (quem, quando, tipo) ficam guardados para as métricas.
- O dash roda primeiro localmente; a publicação na Cloudflare da cliente acontece depois da validação local.
- O dash será hospedado no ambiente Cloudflare (Worker) da própria cliente.
- Fora de escopo nesta fase: dados da Meta Ads (investimento, custo por lead, gênero, idade, desempenho por conjunto/anúncio) e o "fechamento de turma" — dependem de liberação de acesso e virão em uma especificação de marketing separada.
- Fora de escopo: a visão detalhada de pipeline/movimentação diária questionada na call (a validar com a Pat) e a definição de qual etapa representa "venda" (reserva/contrato) — ganhos são considerados pelo status "ganho" da Clint.
- Usuários do dash: gestora/sócia, coordenação comercial e equipe parceira de marketing; uso em desktop, com leitura aceitável no celular.
