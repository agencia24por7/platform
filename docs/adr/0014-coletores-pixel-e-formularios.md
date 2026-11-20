# 0014 — Coletores genéricos do conjunto de dados (Pixel) e dos formulários de cadastro da Meta

- Status: aceito
- Data: 2026-11-20

## Contexto

Dois fatos da Meta faltavam na camada de coleta:

1. Quantos eventos cada conjunto de dados (pixel) recebe por dia, por nome de
   evento. Isso mostra se o site e a Conversions API estão mandando o que os
   anúncios precisam.
2. Quantos leads cada formulário de cadastro (Lead Ads) recebeu, sem ler os
   leads.

Os dois precisam servir qualquer cliente, entrar pela tela "Fontes de dados"
como GA4, GTM e GBP (recurso vinculado a um cliente) e só ser coletados depois
desse vínculo.

Hoje a conexão `meta` só descobre contas de anúncio (`/me/adaccounts`), que
viram `integrations.ad_accounts`. A plataforma `pixel` já existia como conexão
OAuth ("Meta Pixel", mesmo app e mesmo `META_LOGIN_CONFIG_ID` da `meta`), mas
sem descoberta, sem coletor e marcada como fora do v1 no mapa de fontes.

## Decisão

### Modelo: `pixel` para conjuntos de dados e uma plataforma nova, `leadads`, para Páginas

- **Conjunto de dados → plataforma `pixel` (já existente).** A conexão Meta
  Pixel passa a descobrir conjuntos de dados. Cada um vira uma
  `connection_accounts` (`platform = 'pixel'`, `external_id` = id do pixel),
  vinculável a cliente. `pixel` entra em `PLATAFORMAS_COM_RECURSO` com o rótulo
  "Conjunto de dados".
- **Formulários → plataforma nova `leadads` ("Meta Lead Ads").** O recurso é a
  Página do Facebook (`external_id` = id da Página), com o rótulo "Página". O
  coletor lê todos os formulários da Página vinculada.

Por que não pendurar as Páginas na conexão `meta`: os recursos da `meta` são
contas de anúncio, ligadas ao cliente por `ad_accounts`, e cada conexão tem um
único coletor (`connections.coletor_ref`). Colocar Páginas ali misturaria dois
tipos de recurso na tela de contas pendentes e obrigaria o coletor de insights a
decidir pelo formato do ID o que coletar. Por que não reaproveitar `pixel` para
as Páginas: pelo mesmo motivo (um coletor por conexão), e porque o nome
mentiria sobre o que a conexão faz. Uma plataforma nova custa um valor no enum
`integrations.platform` (migração `0042_plataforma_leadads.sql`) e as entradas
nos mapas por plataforma, que o TypeScript obriga a preencher.

`leadads` é da família Meta (`FAMILIA_META`): usa o mesmo app, o mesmo
`META_LOGIN_CONFIG_ID` e a troca por token de longa duração. Entra no convite
por link, como `pixel`.

### Descoberta

- `pixel`: `/me/adaccounts?fields=id,adspixels.limit(50){id,name,last_fired_time,is_unavailable}`
  e `/me/businesses?fields=id,owned_pixels.limit(100){...}`, seguindo
  `paging.next` (só do próprio `graph.facebook.com`) até 20 páginas. A expansão
  de campo evita uma chamada por conta de anúncio. O mesmo pixel visto por conta
  e por empresa vira uma linha só (`dedupe`). Pixel com `is_unavailable` fica
  inativo (fora da coleta até nova descoberta).
- `leadads`: `/me/accounts?fields=id,name,tasks`. Os campos são explícitos para a
  Meta não devolver o `access_token` de cada Página (o parser também o ignora).
  Página cujas tarefas não incluem `ADVERTISE`, `MANAGE` ou `MANAGE_LEADS` fica
  inativa: a Meta não entregaria o token nem os formulários.

Páginas de uma empresa que não foram atribuídas à pessoa que autorizou não
aparecem em `/me/accounts`. Para elas, a pessoa precisa receber a Página no
Gerenciador de Negócios e reconectar.

### Coletor do conjunto de dados (`coletor-meta-dataset.json`)

- `GET /{pixel_id}/stats?aggregation=event&start_time=<unix>&end_time=<unix>`,
  verificado em produção: baldes por hora `{start_time, aggregation, data:
  [{value, count}]}`, com `paging.next`.
- A janela (dias de `America/Sao_Paulo`) vira `start_time` = meia-noite local do
  primeiro dia e `end_time` = meia-noite local do dia seguinte ao último.
- O nó `Normalizar` soma os baldes por dia local e nome de evento e descarta
  dias fora da janela. A mesma regra está em `agregarPorDia`
  (`src/modules/coleta/domain/eventosDoDataset.ts`), e o teste roda o código real
  do nó e compara com o domínio.
- `origem`: três chamadas por janela. `total` sem filtro (o número verificado),
  `navegador` com `event_source=WEB_ONLY` e `servidor` com
  `event_source=SERVER_ONLY` (parâmetro documentado na referência de
  `/stats`, ainda não visto em produção). Relatório que precisa do total usa
  `origem = 'total'`: nada garante que navegador mais servidor dê o total
  (a Meta deduplica o mesmo evento vindo pelas duas fontes). Se o
  recorte falhar e o total vier, o coletor entrega o total e marca
  `coleta_incompleta`.
- Grão do fato: `(organization_id, client_id, dataset_id, data_dia, evento,
  origem)`, sem `client_id` (ver "Dono da linha", abaixo). O fato é série
  temporal, como os outros diários.

**Histórico.** A referência de `/stats` não diz até quando `start_time` pode
voltar; diz só que `end_time` alcança até sete dias do momento da chamada. O
Gerenciador de Eventos mostra cerca de 28 dias, e guias de terceiros falam em
30. O backfill pede só 28 dias para `pixel` (`HISTORICO_DIAS` em
`coleta-backfill.json`), numa janela. Se a Meta devolver menos, os dias antigos
voltam vazios, sem erro. A coleta recorrente (amostra de 7 dias a cada 6h)
regrava os últimos dias, o que absorve evento que chega atrasado.

### Coletor dos formulários (`coletor-meta-formularios.json`)

`/{page_id}/leadgen_forms` pede token da Página. A documentação de Lead Ads
exige que ele venha de quem pode anunciar na Página, com `pages_show_list`,
`pages_read_engagement`, `pages_manage_ads`, `leads_retrieval` e
`ads_management`. O fluxo:

1. `Token da Página`: `GET /{page_id}?fields=access_token` com a credencial
   `facebookGraphApi` do usuário (a que o provisioner troca).
2. `Tem token da Página?`: sem token, ou com ID de Página inválido, vai direto ao
   `Normalizar`, que devolve `reauth_pending` (ou `api_recusou` para ID
   inválido).
3. `Listar formulários`: `GET /{page_id}/leadgen_forms?fields=id,name,status,leads_count,expired_leads_count,created_time&limit=100`,
   **sem credencial no nó** e com `access_token` na query, lido por expressão do
   nó anterior. No n8n 2.x o nó Code não faz chamada autenticada, e o nó HTTP
   com a credencial `facebookGraphApi` acrescentaria o token do usuário. A
   paginação segue `paging.next`, que já traz o token.
4. `Normalizar`: projeta cada formulário numa lista fechada
   (`formId`, `nome`, `status`, `leadsTotal`, `leadsExpirados`, `criadoEm`).

O token da Página nunca é gravado:

- o workflow tem `saveDataSuccessExecution` e `saveDataErrorExecution` em
  `none`, como o coletor do RD Station;
- a saída do coletor (que o orquestrador guarda e manda ao app) é só a do
  `Normalizar`, que não carrega o token;
- o `Normalizar` apaga o token (literal e qualquer `access_token=...`) de toda
  mensagem de erro antes de devolvê-la;
- o teste roda o código real do nó com um token e dados pessoais na resposta e
  garante que nenhum dos dois sai.

Nenhuma chamada lê `/leads`, `field_data` ou a expansão `leads{}`: o teste do
modelo falha se alguma aparecer.

Grão do fato: snapshot diário, como o do RD Station. Chave
`(organization_id, page_id, form_id, data_snapshot)`, sem `client_id`, com
`data_snapshot` = dia da coleta em `America/Sao_Paulo`, calculado no servidor. A
janela é ignorada (janela 0 no mapa de fontes, uma janela só no backfill).
Leads por dia saem da diferença entre snapshots de `leads_total`.
`expired_leads_count` pode não vir; a coluna fica nula.

### Gravação

`CONFIG_POR_PLATAFORMA` ganha `pixel` (`stg_meta_eventos_dataset` →
`fato_meta_eventos_dataset`) e `leadads` (`stg_meta_formularios` →
`fato_meta_formularios`). `preparar` valida de novo cada linha numa lista
fechada (`eventosUnicos`, `formulariosUnicos`) e deduplica pela chave, para que
o número de linhas gravadas bata com o que o orquestrador confere. O
`dataset_id` e o `page_id` vêm da fonte (`ctx.externalId`), não do n8n.

### Dono da linha: só pelas dimensões SCD2

Os dois fatos não têm `client_id`, nem nas colunas nem na chave do MERGE. A
linha guarda `organization_id` e a chave da fonte: `dataset_id` (plataforma
`pixel`) e `page_id` (plataforma `leadads`), iguais ao
`connection_accounts.external_id`. O cliente sai de `dim_fonte_scd2`
(0013), que já cobre toda `connection_accounts` fora de `google` e `meta`.
As views `vw_meta_eventos_dataset` e `vw_meta_formularios` seguem o molde de
`05_dimensoes_scd2.sql`: deduplicam o fato pela chave e trazem
`cliente_na_epoca_*` (dono no dia do fato) e `cliente_atual_*`. Clusterização
por `organization_id` e pela chave da fonte.

## Consequências

- **Migração**: `db/migrations/0042_plataforma_leadads.sql` (`ALTER TYPE ...
  ADD VALUE IF NOT EXISTS 'leadads'`), sem transação, como a `0024` e a `0025`.
- **BigQuery**: `fato_meta_eventos_dataset`, `fato_meta_formularios`,
  `stg_meta_eventos_dataset`, `stg_meta_formularios` e as views
  `vw_meta_eventos_dataset` e `vw_meta_formularios` num arquivo próprio,
  `scripts/bq/06_meta_dataset_formularios.sql` (`node scripts/bq-ddl.mjs`,
  idempotente; depende de `dim_fonte_scd2` e `dim_cliente_scd2` do
  `05_dimensoes_scd2.sql`).
- **Meta Login for Business**: as permissões vêm da configuração do
  `META_LOGIN_CONFIG_ID`, não do parâmetro `scope`. Para os formulários, ela
  precisa incluir `pages_show_list`, `pages_read_engagement`,
  `pages_manage_ads` e `leads_retrieval`. Sem isso a descoberta de Páginas volta
  vazia e o coletor fecha como `reauth_pending`. Isso se confere no painel do
  app, não no código.
- **Para começar a coletar**: conexões Meta Pixel já existentes não têm coletor
  nem recursos descobertos. É preciso reconectar Meta Pixel (descobre os
  conjuntos de dados e provisiona o coletor) e conectar Meta Lead Ads (descobre
  as Páginas e provisiona o coletor). Depois, vincular cada conjunto de dados e
  cada Página ao cliente em "Fontes de dados". Recurso sem cliente não entra na
  fila.
- Nome de evento e nome de formulário são textos do cliente, truncados em 200
  caracteres. São configuração, não dado de pessoa.
- Premissas a conferir na primeira execução real: o filtro `event_source` em
  `/stats`, quantos dias `/stats` devolve, e se `expired_leads_count` vem para
  todos os formulários.
