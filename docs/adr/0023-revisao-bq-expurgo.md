# 0023 — Revisão do expurgo LGPD e da gravação no BigQuery

- Status: aceito
- Data: 2026-11-20
- Revê: ADR 0013, ADR 0015, ADR 0021 e ADR 0022 (pontos listados abaixo)
- Migrações: `0044_posse_por_id_e_expurgo_completo.sql`, `0045_gravacao_so_em_coleta_aberta.sql`

## Contexto

Uma revisão adversarial do expurgo de cliente e do gravador do BigQuery achou
falhas que deixavam dado de cliente expurgado para trás, custos sem teto e
gravações que quebravam por uma linha ruim ou por concorrência:

1. O expurgo dos fatos dependia de versões em `dim_fonte_scd2`, que só a
   sincronização diária grava. Sincronização atrasada ou falha deixava os fatos
   para sempre (o Postgres já tinha apagado a fonte) e as views os mostravam sem
   dono.
2. O Postgres, irreversível, era expurgado primeiro; depois vinham ~70 `bq
   query` em série. Falha no meio não tinha retomada: rodar de novo parava em
   `cliente % não existe`.
3. O dono anterior das mudanças de posse (`dimensao_mudancas_de_posse`) era
   achado pelo **nome** em `audit_log.metadata.de`. Desde a 0043 o nome só é
   único entre clientes não excluídos: dois homônimos duplicavam ou trocavam o
   dono em `dim_fonte_scd2`.
4. O expurgo deixava o nome do cliente na trilha (`de`, `para`, `cliente`,
   `name`) e recursos em `connection_accounts` como `linked` sem cliente.
5. O `ON` do MERGE não tinha filtro constante: toda chamada de
   `/coleta/gravar` lia a tabela de fato inteira (todas as organizações, todo o
   histórico). Nenhum job tinha `maximumBytesBilled`.
6. DML concorrente (MERGE e transação SCD2 na mesma tabela) é cancelado pelo
   BigQuery, e o erro derrubava a chamada; `gov_snapshot_fontes` era append
   com `now()`, então repetir a chamada duplicava.
7. Uma linha com chave nula ou data inválida derrubava a chamada inteira
   (colunas `NOT NULL` da staging).
8. `fato_ga4_diario.canal` e `fato_search_console_diario.device` nulos nunca
   casam no MERGE (`NULL = NULL` é falso): cada reprocesso duplicava.
9. `workerRoute` lia o corpo inteiro antes de medir.
10. `/coleta/gravar` aceitava coleta já fechada e cliente excluído.
11. A política de retenção não falava da staging nem do time travel.

## Decisão

### Expurgo (itens 1, 2, 4, 11)

- **Id normalizado.** O `client_id` informado vai para minúsculas, e o id
  usado nos `DELETE` do BigQuery é o `id::text` devolvido pelo Postgres (o
  BigQuery compara `@id` como texto). Se o cliente tem fontes, o script confere,
  depois da sincronização, que `dim_fonte_scd2` tem versões dele, e aborta
  antes de apagar se não tiver. Se o cliente não existe, só segue (limpeza por
  `client_id`) quando há `client.purged` para aquele id na auditoria; id errado
  falha.

- **BigQuery antes do Postgres.** `titular.mjs expurgar-cliente --confirmar`
  agora: exige o cliente **já excluído logicamente** (fora da coleta, e o
  `/coleta/gravar` recusa); sincroniza as dimensões e **aborta** se falhar;
  apaga pelo período de posse; apaga as **sobras**; apaga por `client_id`
  (`dim_fonte_scd2` por último, porque os passos anteriores dependem dela); só
  então chama `core.expurgar_cliente`; repete a limpeza por `client_id`
  (pega a versão que uma sincronização diária no meio possa ter regravado) e
  sincroniza de novo.
- **Sobras.** As fontes do cliente são lidas do Postgres antes de tudo
  (`ad_accounts` e `connection_accounts` fora de Google/Meta). Depois do
  período de posse, cada fato apaga as linhas daquelas fontes por
  `organization_id` + chave da fonte, **se a fonte nunca foi de outro
  cliente** em `dim_fonte_scd2` — a mesma regra de `todoPeriodo` (ADR 0015).
  Fonte que mudou de dono fica com o recorte por período.
- **Retomada.** Escolhemos a ordem (BigQuery primeiro) em vez de um modo
  `--somente-bigquery` com arquivo de estado: com o Postgres intacto até o fim,
  a lista de fontes e o cliente continuam lá, e todo passo é um `DELETE`
  idempotente. Se um passo falha, o script mostra o passo e os pendentes e sai;
  basta rodar o mesmo comando. Se a falha foi depois do Postgres, o cliente já
  não existe e o mesmo comando só repete a limpeza por `client_id`. Nenhum
  estado local a guardar ou a vazar.
- Os construtores de SQL saíram para `scripts/bq/expurgo.mjs` (puros, com
  testes em `src/modules/coleta/infrastructure/expurgoBigQuery.test.ts`).
- **Trilha e recursos (0044).** `core.expurgar_cliente` troca por
  `[cliente expurgado]` os valores de `de`, `para`, `cliente` e `name` da
  organização quando o id gravado ao lado (`deId`, `paraId`, `clientId`, ou o
  `target_id` de evento de cliente) é o do cliente, ou quando o valor é o nome
  dele **e** nenhum outro cliente da organização tem esse nome. Nome
  compartilhado com um homônimo fica nas linhas antigas sem id: não identifica
  só este cliente, e apagar trocaria a trilha do outro. Recursos
  (`connection_accounts`) do cliente, ou espelho de conta dele, voltam a
  `discovered` com `client_id` e `ad_account_id` nulos.
- **Staging e time travel.** As `stg_*` não entram no expurgo: não têm
  `client_id`, guardam só uma chamada e expiram em 7 dias. O time travel do
  dataset (7 dias, mais 7 de fail-safe do Google) guarda o que foi apagado por
  esse prazo. Ambos estão em `docs/lgpd/retencao.md`.

### Dono por id (item 3, 0044)

- Quem registra mudança de posse grava `deId` (e `paraId` ao mover) ao lado do
  nome: `connectionService` (mover e desvincular conta), `recursoService`
  (mover e desvincular recurso) e `liberacaoDeContas`.
- `automation.dono_anterior_da_auditoria(org, metadata)` decide o dono
  anterior: com `deId`, pelo id; sem `deId` (linha antiga), pelo id ou pelo
  nome em `de`, **só se exatamente um** cliente da organização (excluído ou
  não) casar. Mais de um vira dono desconhecido, como nome que não casa.
  `dimensao_mudancas_de_posse` usa essa função nos dois ramos.
- **Dono desconhecido empurra o histórico.** `reconstruirPosse`
  (`dimensoes.ts`) descarta tudo antes da última mudança com dono desconhecido
  e o primeiro dono conhecido passa a valer desde 1970 (versões iniciais sem
  cliente também são descartadas). Mantemos: é a regra que já valia para nome
  que não casa, e gravar um período com `client_id NULL` mudaria a semântica
  das views (fato sem dono na época). Consequência aceita: os fatos anteriores
  a uma mudança ambígua ficam com o próximo dono conhecido, inclusive para o
  expurgo dele. Só afeta a primeira carga de cada fonte; linhas novas têm
  `deId`.
- **Cliente renomeado.** `dono_anterior_da_auditoria` (linha antiga) e a
  anonimização do expurgo comparam com o nome **atual** do cliente. Linha
  antiga gravada com um nome anterior não casa: o dono fica desconhecido e o
  nome antigo fica na trilha. Linhas novas não dependem do nome.

### Gravação no BigQuery (itens 5 a 8)

- **Filtro constante.** O MERGE de fato vira script: `DECLARE data_minima` e
  `data_maxima` a partir das linhas do próprio lote na staging, e o `ON` ganha
  `alvo.organization_id = @organizationId AND alvo.<data> BETWEEN data_minima
  AND data_maxima`. A coluna de data é derivada: a única `DATE`/`TIMESTAMP` da
  `chave` (`registro.test.ts` exige exatamente uma em todo fato, e todos já têm;
  `fato_rd_negociacao_etapas` usa `entrou_em`, que não é a coluna de partição,
  e fica só com o filtro de organização no cluster). Não declaramos
  `colunaData` na configuração porque a chave já diz. Como não há `WHEN NOT
  MATCHED BY SOURCE`, filtrar o alvo não apaga nada. O SCD2 filtra
  `d.organization_id` no `UPDATE` e nos dois `EXISTS` (dimensão é clusterizada
  por organização). Todo job do gravador e da sincronização de dimensões leva
  `maximumBytesBilled` (`BQ_MAXIMO_BYTES_FATURADOS`, padrão 10 GB; sem mudança
  de infra, vale o padrão).
- **Retentativa.** `retentativaBigQuery.ts`: até 4 tentativas, espera
  exponencial de 0,5 s a 8 s com jitter na metade de cima, só para erro de
  concorrência/limite (`could not serialize access`, `transaction is aborted`,
  `concurrent update`, `too many DML statements`, `exceeded rate limits`,
  motivos `rateLimitExceeded`/`jobRateLimitExceeded`/`backendError`, HTTP
  429/503). Vale por job (INSERT na staging, MERGE, transação SCD2) e na
  transação de `dim_fonte_scd2`/`dim_cliente_scd2`. Repetir é seguro: a
  staging é filtrada por `execucao_id` + `inserido_em` da tentativa, o MERGE e o
  SCD2 são idempotentes.
- **Snapshot idempotente.** `gov_snapshot_fontes` ganha `execucao_id`
  (`ADD COLUMN IF NOT EXISTS`) e é gravado por MERGE que só insere, pela chave
  `organization_id`, `fonte_id`, `execucao_id` na janela de 7 dias. Com isso
  todas as tabelas do laço multi-tabela são idempotentes e o n8n pode repetir a
  chamada inteira.
- **Descarte por chave vira `partial`.** A resposta de `/coleta/gravar` traz
  `descartesDeChave` (linhas descartadas por chave inválida, por tabela), além
  de `linhasGravadas` e `linhasDescartadas`. O nó "Conferir gravação" dos dois
  fluxos (só esse nó mudou nos JSONs) soma por tabela, rebaixa `success` para
  `partial` com `errorCode = coleta_incompleta` e acrescenta um faltante
  `{ fonte: <tabela>, causa: coleta_incompleta, detalhe: "N linha(s) com chave
  inválida descartada(s)" }` ao `qualidadeResumo`, sem mudar o contrato de
  `/coleta/fechar`. Descarte comum do `preparar` (dedupe) continua `success`.
- **Retentativa da sincronização de dimensões.** Se a transação de
  `dim_fonte_scd2`/`dim_cliente_scd2` foi confirmada mas a resposta voltou
  429/503, a nova tentativa fecharia a versão recém-aberta (`valido_ate =
  valido_de = @agora`) e pularia o INSERT (o `sk` já existe), deixando a fonte
  sem versão aberta. O `UPDATE` agora só fecha versão com `valido_de <
  @agora` (`sqlDasDimensoes.ts`); a versão substituta sempre nasce com
  `valido_de = @agora`.
- **Chave inválida.** Depois do `mapear`, `separarPorChaveValida` descarta a
  linha cuja coluna da `chave` é nula ou inválida para o tipo (`DATE`
  `AAAA-MM-DD` real, `TIMESTAMP` legível, `INT64` inteiro, `BOOL`) e soma em
  `linhasDescartadas`. Texto vazio continua valendo como chave (as
  especificações do Google usam `''` para recorte ausente). É um passo do
  gravador para todas as tabelas, em vez de um `preparar` por configuração: o
  defeito é igual em todas. `linhasGravadas + linhasDescartadas` continua
  igual às linhas enviadas, então o "Conferir gravação" do orquestrador fecha.
- **Chave anulável.** `canal` (GA4) e `device` (Search Console) passam por
  `textoDaDimensao` (`(not set)`). As linhas antigas com `NULL` ficam; o README
  do BigQuery traz uma limpeza única para revisar e rodar à mão.

### Rota de worker (item 9)

- `workerRoute` recusa com **413** quando o `Content-Length` declarado passa
  do limite, sem ler o corpo, e lê o corpo em fluxo, cancelando assim que
  passa do limite (`corpoLimitado.ts`). Antes era 422 depois de bufferizar
  tudo.
- `experimental.proxyClientMaxBodySize = '16mb'` é global no Next: não há como
  restringir por rota. Fica a exposição: qualquer rota passa a aceitar até 16 MB
  no proxy. O limite efetivo de cada rota de worker é o `maxBodyBytes` dela (1
  MB por padrão, 12 MB em `/coleta/gravar`), agora conferido antes e durante a
  leitura; rotas de usuário dependem do limite próprio do Next para server
  actions e route handlers.

### Gravar só em coleta aberta (item 10, 0045)

- `resolve_coleta_contexto` devolve também `coleta_status` e
  `cliente_excluido` (mantidos `SECURITY DEFINER`, `search_path` fixo e o
  `GRANT` ao papel do app). `/coleta/gravar` responde 404 para cliente excluído
  e 409 para coleta que não está `running`.
- **Reabrir depois de fechada.** O orquestrador usa a chave de idempotência
  `fonteId:início:fim:modo`, que só muda de um dia para o outro: as rodadas
  seguintes do mesmo dia reabriam a coleta já fechada e, com a regra acima,
  gastariam cota para receber 409. Agora `coletaService.abrir` só devolve a
  coleta existente se ela está `running` (retry em voo); se está fechada, abre
  outra com a próxima chave livre `<chave>#2`, `#3`, ... (até 50, dentro dos
  160 caracteres; `tentativaDeColeta.ts`). Retry de uma rodada nova cai na
  mesma `#N` em `running`.
- **Retry do n8n só antes do fechar.** A idempotência do laço multi-tabela vale
  enquanto a coleta está `running`: repetir `/coleta/gravar` depois do
  `/coleta/fechar` dá 409, e o reprocesso é uma rodada nova.

## Ordem de implantação

1. Migrações 0044 e 0045 (o app atual continua funcionando: só lê colunas que
   já existiam).
2. DDL do BigQuery `03_governanca.sql` (coluna `execucao_id` em
   `gov_snapshot_fontes`), antes do app: o MERGE novo do snapshot usa a coluna.
3. Deploy do app.
4. Opcional, revisado à mão: a limpeza única de `canal`/`device` nulos do
   README do BigQuery.

## Adiado

- Apagar `stg_*` no expurgo: a staging não tem `client_id` nem um mapa simples
  fato → staging no script; expira em 7 dias e está documentada.
- Restringir `proxyClientMaxBodySize` por rota: o Next não oferece.
- Validar `NOT NULL` de colunas fora da chave (por exemplo `data_dia` de
  `fato_rd_negociacao_etapas`): fora do escopo desta revisão.
- Anonimizar nome antigo de cliente renomeado (a trilha guardou o nome da
  época): só o id permitiria; linhas novas já têm `deId`/`paraId`.

## Adendo (ADR 0029)

- O expurgo apaga também a `stg_*` de cada entrada do manifesto (campo `staging`), por organização + chave da
  fonte. Deixa de valer "As `stg_*` não entram no expurgo" e o primeiro item de "Adiado".
- "Dono desconhecido empurra o histórico" foi substituído: o período desconhecido fica em `dim_fonte_scd2` com
  `client_id NULL` e `status = 'desconhecido'`, e o expurgo não o apaga nem trata a fonte como só do cliente.
- "Cliente renomeado": a migração 0080 preenche `deId`/`paraId`/`clientId` nas linhas antigas cujo nome aponta
  para exatamente um cliente na história da organização, inclusive nome antigo visto ao lado de um id.
