# 0013 — Dimensões SCD2 de fonte e cliente no BigQuery

- Status: aceito
- Data: 2026-11-20

## Contexto

As tabelas de fato do BigQuery (`fato_ads_diario`, `fato_ga4_diario`,
`fato_search_console_diario`, `fato_youtube_diario`, `fato_gbp_diario`) gravam
`client_id` em cada linha, congelado no momento da ingestão (vem de
`automation.coletas.client_id`). No app, uma fonte pode ser movida para outro
cliente ("Mover": `reassignAccount` para `integrations.ad_accounts`,
`recursoService.mover` para `integrations.connection_accounts`) ou
desvinculada. A auditoria dizia `historicoSegue: true`, mas no BigQuery o
histórico ficava com o dono antigo, e fontes desvinculadas continuavam
contando para o último dono (caso real: `act_687031535847545` e
`act_766076302421240`, desvinculadas no app, com milhares de linhas sob o
cliente da agência em `fato_ads_diario`).

Reescrever fatos a cada mudança é caro, destrói a visão "como era" e brigaria
com o MERGE do coletor, cuja chave inclui `client_id`.

## Decisão

Dimensões de variação lenta tipo 2, sem tocar nos fatos.

### Tabelas (`scripts/bq/05_dimensoes_scd2.sql`)

- `dim_fonte_scd2`: uma versão por mudança de `(organization_id, platform,
  external_id)` → `client_id`, `status`, `nome`. A chave é exatamente a que o
  coletor grava em cada fato, porque o `externalId` do `ContextoGravacao` sai
  de `automation.resolve_coleta_contexto` (`ad_accounts.external_id` ou
  `connection_accounts.external_id`):

  | Fato | Coluna | `platform` na dimensão |
  |---|---|---|
  | `fato_ads_diario` | `ad_account_id` | `platform` do fato (`google`/`meta`) |
  | `fato_ga4_diario` | `property_id` | `ga4` |
  | `fato_search_console_diario` | `site` | `searchconsole` |
  | `fato_youtube_diario` | `channel_id` | `youtube` |
  | `fato_gbp_diario` | `location_id` | `gbp` |

- `dim_cliente_scd2`: versões de `core.clients` (`client_id`, `nome`, `status`,
  `parent_client_id`, `business_model`).
- Colunas de validade: `sk` (sha256 de chave + `valido_de`, determinístico),
  `valido_de`, `valido_ate` (`9999-12-31` na versão aberta), `atual`, `hash`
  (sha256 dos atributos versionados) e `carregado_em`. Intervalo
  semiaberto `[valido_de, valido_ate)`.

### Semântica do dono

- Conta de anúncio (`ad_accounts`): o dono é `client_id`, exceto com status
  `unlinked`, quando a dimensão grava `client_id` nulo (o app mantém o último
  dono na linha para poder religar, mas para relatório ela não tem dono).
- Recurso (`connection_accounts`, plataformas fora de google/meta, que são
  descobertas de contas de anúncio): o dono é `client_id`, que o app zera ao
  desvincular. Se o mesmo `external_id` aparece em duas conexões da mesma
  organização, vale a linha vinculada, ativa e descoberta mais recentemente.
- Sumir do Postgres (cliente excluído, conexão apagada) encerra a versão
  aberta sem abrir outra.

### Views (`vw_ads_diario`, `vw_ga4_diario`, `vw_search_console_diario`, `vw_youtube_diario`, `vw_gbp_diario`)

- `cliente_na_epoca_id`/`_nome` ("como era"): versão da fonte válida às 00:00
  (America/Sao_Paulo) do `data_dia` do fato. O dia em que a fonte mudou de dono
  fica com quem era dono quando o dia começou.
- `cliente_atual_id`/`_nome` ("como é"): versão aberta. Fonte desvinculada hoje
  tem `cliente_atual_id` nulo, então relatório por dono atual a exclui; o
  "como era" a mantém no período em que esteve vinculada.
- Nome do cliente nas duas atribuições é o nome atual daquele cliente.
- `cliente_na_ingestao_id` expõe o `client_id` original do fato, só para
  diagnóstico. As views não têm coluna `client_id` de propósito (ver LGPD).
- As views deduplicam o fato pela chave natural sem `client_id`, ficando com a
  linha de `inserido_em` mais recente: depois de um Mover, uma recoleta grava
  a mesma conta/dia sob o novo `client_id` e a linha antiga continua lá; sem
  deduplicar, a mesma métrica contaria duas vezes.

### Carga

- Postgres → `automation.dimensao_fontes()`, `automation.dimensao_clientes()` e
  `automation.dimensao_mudancas_de_posse()` (migração `0041`), `SECURITY
  DEFINER` no molde de `fontes_de_coleta`, executáveis pelo papel do app.
- Domínio puro (`src/modules/coleta/domain/dimensoes.ts`): `planejarScd2`
  compara o estado atual com as versões no BigQuery e devolve o plano — chave
  nova insere histórico inicial; hash diferente fecha a aberta e abre outra em
  `agora`; chave sem versão aberta que reapareceu abre versão em `agora`; chave
  que sumiu é fechada; duas versões abertas (corrupção) são fechadas e
  reabertas.
- Infraestrutura (`dimensoesBigQuery.ts`): um script com `BEGIN TRANSACTION`,
  `UPDATE` que fecha por chave e `INSERT ... SELECT FROM UNNEST(@novas)` com
  guarda `NOT EXISTS` (mesmo `sk`, ou versão aberta da mesma chave). Execução
  repetida ou concorrente não duplica versão aberta.
- `dimensoesService` serializa execuções no processo. Rodam:
  - `POST /api/v0/manutencao/dimensoes` (worker, auditado como
    `coleta.dimensoes_sincronizadas` com o resumo), chamado pelo workflow
    `ORLA · coleta · dimensões diárias` às 04:00 e sob demanda;
  - em segundo plano logo depois de vincular, mover ou desvincular conta de
    anúncio ou recurso (`AvisoDePosse`). É fire-and-forget: falha vira log
    `coleta.dimensoes.erro` e nunca afeta a ação do usuário; avisos seguidos se
    juntam numa execução só. A diária corrige o que escapar.
- A auditoria de Mover e de desvincular conta de anúncio passa a gravar
  `historico: 'scd2'` no lugar de `historicoSegue: true`/`historicoPreservado:
  true`, que prometiam algo que o BigQuery não fazia.

### Histórico inicial (limitação)

Não existe registro de posse anterior a esta mudança além da auditoria. Na
primeira carga de cada fonte:

- O histórico é reconstruído de `audit.audit_log` (`ad_account.reassigned`,
  `ad_account.unlinked`, `ad_account.relinked`,
  `connection_account.reassigned`/`unlink`/`link`). O dono anterior vem de
  `metadata.de`, que guarda o NOME do cliente; se o nome não casa mais com um
  cliente (renomeado/excluído), a reconstrução para ali e o período seguinte
  conhecido é estendido para trás.
- Conta desvinculada sem evento de auditoria usa `updated_at` como momento do
  desvínculo e `ad_accounts.client_id` como dono anterior — é o caso das duas
  contas Meta citadas.
- A primeira versão de cada fonte vale desde `1970-01-01`, não desde a
  criação: o backfill busca meses para trás depois do vínculo, e esses dias
  precisam de dono "como era". Um período inicial sem dono (antes do primeiro
  vínculo) é absorvido pelo primeiro dono pelo mesmo motivo.
- A auditoria guarda 2 anos (`docs/lgpd/retencao.md`); mudanças mais antigas
  não são reconstruídas. Nomes de fonte nas versões reconstruídas são os
  atuais.
- Clientes não têm reconstrução: a primeira versão vale desde `1970-01-01`.

## Consequências

- Relatórios devem ler as views, não os fatos. Os fatos continuam com o
  `client_id` da ingestão; nada foi reescrito.
- O `client_id` do fato deixa de ser a fonte da verdade de dono. A coleta
  continua gravando-o (o MERGE do coletor depende dele) e
  `bigQueryGravador.ts` não mudou.
- Clientes por nome e fontes por nome ficam no BigQuery, que já tinha
  `client_id` em toda tabela. `scripts/titular.mjs excluir-cliente` apaga de
  toda tabela-base com coluna `client_id`, o que inclui as duas dimensões; a
  consulta agora filtra `table_type = 'BASE TABLE'` para nunca tentar `DELETE`
  numa view.
- O plano é enviado como parâmetro de array; com milhares de fontes cabe com
  folga no limite de requisição do BigQuery. Se passar de dezenas de milhares,
  trocar por carga em tabela de staging.
- Ordem de aplicação: migração `0041` no Postgres, `05_dimensoes_scd2.sql` no
  BigQuery (`node scripts/bq-ddl.mjs`), deploy do app, primeira execução da
  rota (manual pelo workflow) e implantação manual do workflow no n8n (ADR
  0009).

> Revisto pela ADR 0022: `excluir-cliente` passou a ser exclusão lógica e o
> `DELETE` descrito aqui é o `expurgar-cliente`.

## Adendo (2026-11-20): um padrão só, fatos sem `client_id`

O `tria_dw` foi apagado e recriado (só o BigQuery; nenhum backup do Postgres
foi tocado) para não conviver com dois padrões. Isso substitui as duas
primeiras consequências acima:

- Fatos e `gov_snapshot_fontes` não têm `client_id`. Cada linha carrega
  `organization_id` e a chave da fonte; o dono vem só de `dim_fonte_scd2`,
  pelas views `vw_*` (`cliente_na_epoca_*` e `cliente_atual_*`).
- A chave do MERGE de cada fato é a chave natural da fonte, sem `client_id`.
- `qc_execucoes` e `gov_paridade` continuam com `client_id`: registram a
  execução em si, que pertence ao cliente da coleta.
- `scripts/titular.mjs excluir-cliente` apaga dos fatos e de
  `gov_snapshot_fontes` as linhas cujo momento cai no período em que a fonte
  foi do cliente, segundo a dimensão; depois apaga das tabelas com
  `client_id`, dimensões incluídas.
- `HASH` é reservada no BigQuery: a coluna de versão chama `hash_versao`.
