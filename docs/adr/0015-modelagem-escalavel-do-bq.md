# 0015 — Modelagem escalável do BigQuery (várias tabelas por plataforma)

- Status: aceito
- Data: 2026-11-20

## Contexto

Cada coletor gravava em exatamente um fato: `CONFIG_POR_PLATAFORMA` em
`bigQueryGravador.ts` tinha uma entrada por plataforma, GTM era um caso
especial no meio do gravador e a exclusão de cliente tinha a lista de fatos
fixa em `scripts/titular.mjs`. A próxima etapa é modelar várias tabelas por
plataforma (fatos por campanha/anúncio/criativo, dimensões de entidade como
campanhas e formulários), em paralelo, por agentes diferentes. Com tudo em
três arquivos compartilhados, cada tabela nova seria um conflito de merge e
um risco de regressão nas outras plataformas.

## Decisão

### Saída do coletor com várias tabelas

- Uma linha de `linhas` pode trazer `_tabela: string` (nome lógico); sem ela,
  `padrao`. O contrato do POST `/api/v0/coleta/gravar` não muda.
- `agruparPorTabela` (`sqlDaGravacao.ts`) valida **todas** as linhas antes de
  gravar qualquer coisa: `_tabela` sem configuração → `tabela_desconhecida:<nome>`;
  `_tabela` não-string → `tabela_invalida`. A gravação não começa, a execução
  falha com o motivo e nada fica pela metade por erro de configuração.
- Cada grupo passa por `preparar` → `mapear` → escrita do seu tipo. O retorno
  é a soma das linhas gravadas de todos os grupos, e o "Conferir gravação" do
  orquestrador continua comparando total enviado × total gravado sem mudança.
- Falha de BigQuery num grupo interrompe os seguintes; os já gravados ficam.
  É seguro porque toda escrita é idempotente por execução (staging filtrada por
  `execucao_id` + MERGE/SCD2), e o retry da execução regrava tudo.

### Tipos de configuração (`ConfiguracaoTabela`)

- `fato`: o comportamento de antes, sem mudança — INSERT na staging e MERGE no
  fato pela `chave`, deduplicando a staging com `QUALIFY ROW_NUMBER() ...
  ORDER BY inserido_em DESC`.
- `scd2`: dimensão de entidade genérica. A configuração declara `chave` e
  `atributos`; o gravador acrescenta `execucao_id`/`inserido_em` à staging e
  roda, numa transação:
  1. `UPDATE ... FROM origem`: fecha (`valido_ate = @agora`, `atual = FALSE`)
     a versão aberta cuja `hash_versao` difere;
  2. `INSERT`: abre versão (`valido_ate = 9999-12-31`, `atual = TRUE`) para
     cada chave sem versão aberta (as recém-fechadas e as novas).
  `hash_versao = TO_HEX(SHA256(TO_JSON_STRING(STRUCT(<atributos>))))`, só dos
  atributos, em ordem fixa. Rodar de novo sem mudança não altera nada.
  Primeira versão de uma chave vale desde `1970-01-01`, as seguintes desde
  `@agora`: um fato antigo coletado em backfill encontra a entidade num
  join "como era", como em `dim_fonte_scd2` (ADR 0013). Chave ausente de uma
  coleta **não** é fechada: coletas podem ser parciais (janela, paginação,
  falha), e fechar por ausência apagaria entidades vivas. Remoção na origem,
  quando importar, vira atributo (`status`). Sem `sk`: a chave natural +
  `valido_de` identifica a versão.
- `snapshot`: append direto na tabela, sem staging nem MERGE. É o que o GTM
  faz em `gov_snapshot_fontes`, agora como configuração em vez de `if` no
  gravador.

### Registro por plataforma

`src/modules/coleta/infrastructure/tabelas/<plataforma>.ts` exporta um
`Record<string, ConfiguracaoTabela>`; `tabelas/index.ts` só agrega. A chave
`padrao` de cada plataforma é a tabela de antes, com o mesmo comportamento.
SQL puro (agrupamento, MERGE, SCD2, INSERT) fica em `sqlDaGravacao.ts`, com
teste unitário; o gravador só executa.

### DDL por plataforma

`scripts/bq-ddl.mjs` já aplicava todo `scripts/bq/*.sql` em ordem de nome.
Ficam reservadas faixas por plataforma (`20` meta, `21` google, `22` ga4,
`23` searchconsole, `24` youtube, `25` gbp, `26` rdstation, `27` pixel e
leadads, `28` gtm), para nenhum agente editar arquivo de outro.

### Manifesto de exclusão de cliente

`scripts/titular.mjs` lê `scripts/bq/manifesto/*.json` em vez da lista fixa.
Cada entrada valida identificadores (`[a-z][a-z0-9_]*`) e exatamente um
recorte:

- `data`/`momento`: apaga as linhas do período em que a fonte foi do cliente
  em `dim_fonte_scd2` (comportamento de antes).
- `todoPeriodo: true`: para dimensões de entidade, que não têm data de fato.
  Apaga todas as linhas da fonte se ela foi do cliente em alguma versão **e
  nunca de outro cliente**.

`plataforma` passa a ser o valor literal; `colunaPlataforma` restringe tabela
compartilhada (`fato_ads_diario` em `meta.json` e `google.json`,
`gov_snapshot_fontes` em `gtm.json`). O resultado é o mesmo da lista antiga.

#### Por que `todoPeriodo` não apaga fonte que mudou de dono

Recortar uma dimensão SCD2 pelo período de posse não funciona: uma versão da
entidade pode atravessar a troca de dono, e apagá-la deixaria o novo dono sem
versão (ou com buraco no histórico). Apagar tudo da fonte apagaria dado que
também é do dono atual. A regra escolhida:

- fonte só do cliente excluído: a dimensão some inteira;
- fonte que também foi de outro cliente: a dimensão fica. Ela descreve a
  fonte (nome de campanha, formulário), não o cliente, não tem `client_id`, e
  o vínculo com o cliente excluído desaparece quando o passo seguinte apaga
  as versões dele em `dim_fonte_scd2`. Os **fatos** daquele período continuam
  apagados pelo recorte de data.

A ordem do `titular.mjs` importa e foi mantida: manifesto primeiro (usa
`dim_fonte_scd2` ainda com o cliente), tabelas com `client_id` depois.

### Documentação

`scripts/bq/README.md` é o catálogo canônico: convenções, como adicionar
tabela e uma seção por plataforma que termina num marcador; cada agente edita
só a sua seção. `AGENTS.md` exige atualizar o README em toda mudança de
BigQuery.

## Consequências

- Tabela nova = DDL `2X_<plataforma>.sql` + entrada em `tabelas/<plataforma>.ts`
  + `_tabela` no coletor + manifesto + seção do README. Nenhum arquivo
  compartilhado muda.
- Um coletor que hoje só manda `padrao` continua funcionando sem mudança.
- Uma `_tabela` errada no coletor falha a execução inteira, visível no
  `qc_execucoes`/painel, em vez de perder linhas em silêncio.
- `preparar` que deduplica (RD, pixel, formulários) continua podendo gravar
  menos linhas que as recebidas; é o comportamento de antes e vale por tabela.
