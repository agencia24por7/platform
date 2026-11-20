# 0022 — Exclusão lógica de cliente (Postgres e BigQuery)

- Status: aceito
- Data: 2026-11-20
- Revê: ADR 0013 (o `DELETE` de cliente no BigQuery vira expurgo)

## Contexto

Excluir um cliente era físico: `core.excluir_cliente` (migração 0038) apagava
métricas, execuções, coletas, convites, acessos, contas e o próprio cliente, e
`scripts/titular.mjs excluir-cliente` apagava do BigQuery os fatos do período
de posse (manifesto + `dim_fonte_scd2`) e as linhas com `client_id`. Um engano
não tinha volta, o fim de contrato destruía histórico que a agência ainda pode
precisar (contestação, auditoria, obrigação contábil) e o caminho do dia a dia
era o mesmo da eliminação por obrigação legal.

## Decisão

### Dois caminhos com nomes diferentes

- **Exclusão lógica** (`core.excluir_cliente(uuid, por text)`,
  `titular.mjs excluir-cliente`): é o padrão. Nada é apagado.
- **Restauração** (`core.restaurar_cliente(uuid, por text)`,
  `titular.mjs restaurar-cliente`).
- **Expurgo** (`core.expurgar_cliente(uuid)`, `titular.mjs expurgar-cliente`):
  o antigo caminho físico, renomeado, só para obrigação legal de eliminação.
- `anonimizar` (dado pessoal de usuário) não muda: é anonimização, não exclusão.

As três funções são `SECURITY DEFINER` com `search_path` fixo e só o dono do
banco executa (nenhum `GRANT` ao papel do app), como as de 0038. Não há tela
de exclusão de cliente no app; o atendimento é pelo `titular.mjs`.

### Postgres (migração 0043)

- `core.clients` ganha `excluido_em` e `excluido_por` (com `CHECK` de
  coerência). Não reaproveitamos `status`: o enum `core.lifecycle_status` é
  compartilhado com organizações e aparece na tela (`ciclo.ts`), e excluir é
  uma dimensão diferente de pausar/arquivar.
- Excluir também põe `status = 'archived'`. Com isso as travessias de coleta
  que já exigem cliente ativo (`automation.sync_queue`, `fontes_de_coleta`,
  `resolve_coleta_fonte`, `resolve_account_organization`) param sem
  redefinição. Restaurar devolve o cliente **pausado**: retomar a coleta é
  decisão de quem opera.
- Excluir revoga convites de integração pendentes (e seus itens) e marca como
  `failed` as tarefas pendentes do cliente; grava `client.excluded` na
  auditoria com o status anterior. Restaurar grava `client.restored`.
- **Visibilidade por RLS, num lugar só.** `clients_tenant` passa a exigir
  `excluido_em IS NULL`. As tabelas que pendem do cliente (`ad_accounts`,
  `coletas`, `connection_invites`, `account_tasks` quando têm cliente) exigem
  `EXISTS (SELECT 1 FROM core.clients c WHERE c.id = <tabela>.client_id)`.
  Como esse `SELECT` já passa pela política de `clients`, a regra "cliente
  visível = da organização, no recorte e não excluído" fica escrita uma vez.
  `metrics_daily`, `metrics_restatements` e `sync_runs` herdam, porque as
  políticas delas consultam `ad_accounts`. O `EXISTS` vira semi-join; não
  pusemos a checagem dentro de `core.cliente_no_escopo` porque ela deixaria de
  ser inlinizável (ADR 0001) e rodaria uma subconsulta por linha.
- Ficam como estavam: `member_clients` (revogar o recorte de um membro cujo
  único cliente foi excluído abriria a organização inteira para ele) e
  `connection_accounts` (recurso da conexão, da organização; o vínculo a um
  cliente excluído aparece como "—" e pode ser desfeito na tela do conector).
- O nome do cliente passa a ser único só entre não excluídos (índice parcial
  no lugar da constraint): excluir não bloqueia recadastrar o mesmo nome.
  Restaurar recusa se já houver cliente ativo com o nome.

### BigQuery

- Nenhum `DELETE`. `automation.dimensao_clientes()` devolve `excluido_em`, e
  a sincronização diária grava em `dim_cliente_scd2` uma versão com
  `status = 'excluido'` (`statusDoClienteNaDimensao`, função pura testada).
  Restaurar gera outra versão com o status de volta.
- `dim_fonte_scd2` não muda: a fonte continua do cliente excluído. O
  histórico de posse fica verdadeiro e a restauração é exata.
- **Filtro em toda `vw_*`, com o mesmo texto.** Escolhemos esconder por
  padrão (opção a) e não só expor uma flag (opção b): quem lê as views é BI e
  relatório, e um filtro esquecido vazaria dado de cliente excluído. Toda
  view expõe `cliente_atual_status` (e `cliente_na_epoca_status` nas de fato)
  e termina em `WHERE IFNULL(cliente_epoca.status, '') != 'excluido' AND
  IFNULL(cliente_atual.status, '') != 'excluido'` (só o segundo termo nas
  `vw_dim_*`). Esconder pelo dono na época espelha o que o expurgo apagaria
  (o período de posse); esconder pelo dono atual cobre a fonte que hoje é de
  um cliente excluído. `registro.test.ts` recusa view sem o filtro.
- `titular.mjs` dispara a sincronização de dimensões
  (`POST /api/v0/manutencao/dimensoes`, token do worker lido do Secret Manager;
  em `--local`, `localhost:3000` e `WORKER_TOKEN`) logo depois de excluir,
  restaurar ou expurgar, e as views refletem na hora. Falha na sincronização
  só avisa: a mudança no Postgres fica, e a sincronização diária completa.
- `bq:verificar` deixa de exigir contagem igual entre view e base: falha se a
  view tiver **mais** linhas (multiplicação) e informa quantas ficaram ocultas.

## Consequências

- Excluir é reversível e auditável; o expurgo continua disponível e explícito.
- Fonte (conta de anúncio, propriedade) de cliente excluído continua presa a
  ele: para dá-la a outro cliente, restaure e mova, ou expurgue.
- Consulta direta em `fato_*`/`dim_*` (fora das views) vê o histórico de
  clientes excluídos; a convenção é ler as `vw_*` (README do BigQuery).
- Ordem de aplicação: migração 0043, deploy do app (repositório de dimensões),
  `node scripts/bq-ddl.mjs` (views).

## Adendo (ADR 0029)

O BigQuery passa a ter `DELETE` fora do expurgo, só para dado da API do YouTube: prazo de 30 dias das
`dim_youtube_*` e expurgo do canal cuja autorização acabou (ADR 0029). A exclusão de cliente continua lógica.
