# 0012 — Coletor genérico do RD Station CRM

- Status: aceito
- Data: 2026-11-20

## Contexto

Desde a 0011, a chave do RD Station CRM rende uma `connection_accounts`
vinculável a um cliente. Faltava o coletor: o mapa de fontes ainda marcava
`rdstation` como fora do v1, e `guardarChave` não provisionava workflow no n8n,
ao contrário da autorização OAuth.

Os fluxos em `n8n/workflows/clientes/credaz/` pertencem ao cliente e não podem
ser usados nem alterados pela plataforma. Eles serviram só de referência
(leitura) para saber quais fatos de negócio importam: o `rd-para-meta-conversoes`
transforma a etapa atual da negociação em evento ("Novo lead", "Análise de
crédito", "Aprovado"…) e a negociação ganha (`win === true`) em `Purchase`, com
valor `amount_total` e data `closed_at`.

## Decisão

### Genérico, por etapa, sem nome de etapa no código

O coletor serve qualquer cliente e qualquer funil. Ele não conhece nenhuma
etapa: grava, por negociação, o funil (id e nome), a etapa atual (id, nome e
ordem), a situação (`aberta`, `ganha`, `perdida`, `pausada`), os valores
(`amount_total`, `amount_montly`, `amount_unique`), `created_at`, `updated_at`,
`closed_at`, o nome da fonte (`deal_source.name`) e o da campanha
(`campaign.name`). Os eventos que a Credaz usa saem disso em SQL: "entrou na
etapa X" é a primeira data de snapshot em que `etapa_nome = X`, e "Purchase" é
`situacao = 'ganha'` com `valor_total` e `fechada_em`.

`situacao` deriva de `win` (true = ganha, false = perdida, null = em aberto) e
de `hold` (pausada), conforme a documentação dos filtros de `/deals`.

### Sem dado pessoal

Saem só o ID da negociação e campos estruturais. Nunca saem: nome da
negociação (costuma trazer o nome da pessoa), contatos, e-mails, telefones,
organização, responsável (`user`), anotações, última atividade, produtos e
campos personalizados. Campo personalizado fica de fora por padrão: não há
como provar, de forma genérica, que um campo do cliente não é pessoal (o da
Credaz, por exemplo, guarda o `lead_id` do Meta).

A projeção acontece em três camadas:

1. O nó `Normalizar` do coletor monta cada linha a partir de uma lista fechada
   de campos. A resposta bruta da API, que traz contatos, só existe na memória
   da execução, e o workflow tem `saveDataSuccessExecution` e
   `saveDataErrorExecution` em `none` (mesmo padrão dos fluxos de lead).
2. `negociacaoDaLinha` (domínio) aceita de novo só a lista fechada
   `CAMPOS_DA_NEGOCIACAO`, valida o ID (`[A-Za-z0-9_-]`) e normaliza tipos.
3. O teste unitário roda o código real do nó `Normalizar` contra uma resposta
   cheia de dados pessoais e garante que nenhum deles chega à linha do fato.

### Grão: snapshot diário

`fato_rd_negociacoes` guarda o estado de cada negociação por dia de coleta.
A chave do MERGE é `(organization_id, client_id, deal_id, data_snapshot)`, e
`data_snapshot` é o dia da coleta em `America/Sao_Paulo`, calculado no
servidor. O orquestrador roda a cada 6h: as rodadas do mesmo dia sobrescrevem a
mesma linha (fica o último estado do dia), e cada dia novo cria a sua. A série
de snapshots mostra o movimento no funil e as vitórias ao longo do tempo.

A janela que o orquestrador envia é ignorada pelo coletor. Por isso o mapa de
fontes tem janela 0 (como o GTM) e o backfill gera uma única janela para
`rdstation`: não existe histórico de etapa para recuperar, só o estado de
agora. O primeiro snapshot já traz `created_at` e `closed_at`, o que basta
para reconstruir criação e fechamento passados. A passagem por cada etapa só
existe a partir do primeiro dia coletado.

Como o orquestrador reaproveita a execução quando a chave de idempotência se
repete no mesmo dia, a staging pode receber a mesma negociação mais de uma vez
por `execucao_id`. O MERGE passou a deduplicar a origem pela chave
(`QUALIFY ROW_NUMBER()`), o que também protege as outras plataformas contra
uma regravação.

### Como a API é lida

- `GET /api/v1/deal_pipelines?limit=200` traz os funis com as etapas
  embutidas (`id`, `name`, `order`). Isso dá funil e ordem a partir do
  `deal_stage.id` de cada negociação, que não traz nenhum dos dois.
- `GET /api/v1/deals?deal_pipeline_id=…&limit=200` para cada funil, com
  paginação por `next_page` até `has_more` deixar de ser `true`. A
  documentação não diz se `/deals` sem `deal_pipeline_id` cobre todos os funis,
  então o coletor percorre funil por funil.
- O limite é de 120 requisições por minuto. O coletor espera 600 ms entre
  páginas e entre funis, e para em 60 páginas por funil (12 mil negociações).
  A documentação também avisa que as listagens só devolvem os primeiros
  10 mil registros. Se um funil passa de um desses tetos, o coletor entrega o
  que leu e marca a execução como `coleta_incompleta`, sem descartar dados.
- 401/403 vira `reauth_pending`. CRM sem negociação vira
  `sem_dados_no_periodo`.

Premissa não confirmada: o esquema de resposta de `/deals` na documentação
oficial não lista `deal_source` nem `campaign`, embora a listagem aceite
`campaign_id` como filtro. O coletor lê `deal_source.name` e `campaign.name`
se vierem. Se não vierem, as colunas ficam nulas e a coleta segue. Isso deve
ser conferido na primeira execução real.

### Chave de API ganha coletor

- A credencial do RD Station no cofre do n8n passa de `httpHeaderAuth`
  (`Authorization: Bearer`, que a API v1 não aceita) para `httpQueryAuth`
  (`token=<chave>`), o mesmo formato que o teste da chave já usava.
- `guardarChave` provisiona o coletor como a autorização OAuth faz: cria o
  workflow a partir de `n8n/workflows/coletores/coletor-rdstation.json`, grava
  em `connections.coletor_ref` com `trocarColetorRef` e remove o workflow
  anterior. Uma falha ao provisionar não desfaz a chave guardada: fica no log
  (`coletor.provisionar.ignorado`), e a coleta aparece como `sem_credencial`
  até a chave ser guardada de novo. A auditoria `connection.key_stored`
  registra `coletorProvisionado`.
- Apify e Z-API seguem fora do v1. Como não têm modelo de coletor, o
  provisioner devolve `null` para eles.

## Consequências

- Uma conexão do RD Station já existente (chave guardada antes desta mudança)
  tem credencial `httpHeaderAuth` e nenhum `coletor_ref`. Para ela passar a
  coletar, basta guardar a mesma chave de novo na tela do conector: isso cria a
  credencial `httpQueryAuth`, descarta a antiga, provisiona o coletor e mantém o
  vínculo com o cliente (o `upsert` da 0011 preserva a conta). Não há migração.
  Até lá, se a conta estiver vinculada a um cliente, o orquestrador a lista e
  fecha a execução como `sem_credencial`. Conta sem cliente não entra na fila.
- O BigQuery precisa de `fato_rd_negociacoes` e `stg_rd_negociacoes`
  (`scripts/bq/01_fatos.sql` e `02_staging.sql`, aplicados por
  `node scripts/bq-ddl.mjs`, que é idempotente).
- O nome do funil, da etapa, da fonte e da campanha são textos do cliente.
  São catálogos de configuração, não dados de pessoa, mas ficam truncados em
  200 caracteres.
- Para incluir um campo personalizado, é preciso uma lista explícita por
  cliente e a prova de que o campo não é pessoal. Isso fica fora deste coletor.
