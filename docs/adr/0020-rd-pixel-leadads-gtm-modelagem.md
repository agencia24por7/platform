# 0020 — Modelagem de RD Station, Meta Pixel, Lead Ads e GTM no BigQuery

- Status: aceito
- Data: 2026-11-20

## Contexto

Os quatro coletores gravavam um fato cada (ADRs 0012 e 0014) e um snapshot de
governança (GTM). A 0015 abriu o gravador para várias tabelas por plataforma.
Esta decisão usa isso para guardar o que as APIs entregam de útil para
relatório e gestão, sempre sem dado pessoal (LGPD).

## Decisão

### Dimensões SCD2 por plataforma, genéricas

Cada dimensão leva `organization_id`, a chave da fonte (`conta_id`,
`dataset_id`, `page_id`, `conteiner_id`) e a chave da entidade. O dono sai de
`dim_fonte_scd2` na view `vw_dim_*` (`cliente_atual_*`). As linhas passam por
`dimensaoScd2` e `fatoDeLinhas` (`tabelas/construtores.ts`): o coletor manda a
linha com `_tabela`, a função de domínio valida de novo numa lista fechada e
deduplica pela chave. A ausência de uma entidade numa coleta não fecha a versão
(ADR 0015).

### RD Station

- Dimensões: funil, etapa (nome, ordem), fonte, campanha, produto (nome,
  preço, ativo) e usuário. O usuário é só o id opaco e o campo `ativo`; nome,
  e-mail e qualquer outro dado da pessoa não saem do n8n. A negociação ganha
  `responsavel_id`, `fonte_id` e `campanha_id` para ligar às dimensões. Isso
  revoga a parte da 0012 que proibia o responsável: o id é opaco, e a decisão
  de não trazer nome continua valendo.
- `fato_rd_negociacao_produtos`: foto diária dos itens da negociação
  (`deal_products`: quantidade, preço, desconto, total), chave pelo id do
  vínculo. A descrição do produto não sai.
- `fato_rd_negociacao_etapas`: uma linha por entrada numa etapa, tirada de
  `deal_stage_histories` da própria negociação. Isso recupera o histórico que a
  0012 dava por perdido. O formato do histórico não consta na documentação
  pública; o coletor aceita `deal_stage.id`/`deal_stage_id` e
  `created_at`/`start_date` e ignora o que não reconhece.
- `fato_rd_tarefas_diarias`: contagem por dia agendado, tipo e situação
  (`concluida`/`pendente`) de `GET /tasks`, numa janela de 30 dias para cada
  lado. Assunto, notas, negociação e responsáveis são descartados no n8n. O
  filtro `date_start`/`date_end` não tem formato documentado; usa-se ISO sem
  fuso.
- Os catálogos entram em série antes dos funis, com paginação por `page` e
  pausa de 600 ms (limite de 120 requisições por minuto). Recusa de um
  catálogo não derruba a coleta das negociações.

### Meta Pixel (dataset)

- `dim_meta_dataset_scd2`: nome, indisponibilidade, correspondência
  automática, estado do cookie próprio e configuração de uso de dados, de
  `GET /{dataset}?fields=...`. O campo `code` (script do pixel) e
  `last_fired_time` (muda a cada disparo e geraria versão nova sem parar) ficam
  de fora.
- `fato_meta_eventos_dataset_recortes`: formato longo (`recorte`, `valor`) para
  o que `/stats` agrega: `device_type`, `device_os`, `browser_type`, `host`,
  `match_keys` (qualidade de correspondência, só os nomes das chaves) e
  `event_processing_results`. Cada recorte é uma chamada, porque `/stats` não
  combina agregações.
- `url` fica de fora: URL traz parâmetros de consulta com e-mail e telefone.
  `host` guarda só o nome do servidor (esquema, caminho e parâmetros são
  cortados).
- Recorte recusado pela Meta entrega o resto e marca `coleta_incompleta`, como
  o recorte por origem da 0014. A agregação `event_source` segue no fato
  existente (`origem`).

### Meta Lead Ads

- `dim_meta_pagina_scd2` (nome, categoria) e `dim_meta_formulario_scd2` (nome,
  status, idioma, quantidade de perguntas e a lista de tipos de pergunta, como
  `EMAIL` e `CUSTOM`). Texto e chave das perguntas não saem.
- `fato_meta_leads_diario`: contagem por formulário, dia de São Paulo, anúncio
  e campanha. O coletor lê `GET /{form}/leads?fields=ad_id,campaign_id,form_id,created_time`
  com filtro `time_created` dos últimos 30 dias, e conta no n8n. Nunca pede
  `field_data`. O `id` do lead, que a API sempre devolve, é descartado. Sem
  anúncio ou campanha (lead orgânico), usa-se `sem_anuncio` e `sem_campanha`
  porque a chave do MERGE não aceita nulo.
- Isso substitui a regra da 0014 de "nunca ler `/leads`" por "nunca ler dado
  pessoal": o teste agora exige que os campos pedidos sejam exatamente esses
  quatro. O token da Página segue só em memória.
- Cada formulário gasta uma chamada paginada (100 por página, teto de 100
  páginas, 600 ms de pausa). Passar do teto marca `coleta_incompleta`. A
  recontagem dos 30 dias a cada execução mantém o dia sempre completo; o dia
  que sai da janela fica congelado no último valor.

### GTM

Tudo vem de `versions:live` (já lido) e de `containers/{id}/workspaces` (uma
chamada nova): contêiner, workspace, versão publicada (id, nome, totais), tags
(tipo, acionadores de disparo e de bloqueio, pausada), acionadores e variáveis
(tipo e nome). Parâmetros das tags e variáveis (IDs de medição, códigos) não
saem. Remoção de tag no contêiner não fecha a versão da dimensão (ADR 0015); o
`dim_gtm_versao_scd2` mostra a publicação em que ela deixou de existir.
`gov_snapshot_fontes` continua igual.

## Consequências

- DDL: `26_rdstation.sql` (com `ALTER ... ADD COLUMN IF NOT EXISTS` nas tabelas
  de negociação, na fato e na staging), `27_meta_pixel_leads.sql`,
  `27b_meta_leadads.sql` e `28_gtm.sql`.
- Escopos novos: nenhum. `leads_retrieval` e `pages_manage_ads`, já exigidos
  pelos formulários, cobrem `/leads`; o escopo do GTM cobre `workspaces`.
- O n8n precisa receber os coletores de novo (`provisionar-coletores`).
- Premissas a conferir na primeira execução real: formato de
  `deal_stage_histories`, `deal_products.product_id`, formato de
  `date_start`/`date_end` em `/tasks`, nomes de campo de `/products` e
  `/users`, e as agregações `host` e `match_keys` em `/stats`.
