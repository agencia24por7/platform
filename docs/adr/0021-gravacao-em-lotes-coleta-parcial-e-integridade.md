# 0021 — Gravação em lotes, coleta parcial e verificação de integridade do BigQuery

- Status: aceito
- Data: 2026-11-20

## Contexto

As ADRs 0016 a 0020 modelaram as plataformas no menor grão. O volume de uma
execução mudou de ordem de grandeza: numa janela de 28 dias, ações do Meta
(anúncio × dia × tipo de ação) e termos de pesquisa do Google passam de
dezenas de milhares de linhas. Três limites apareceram:

1. O `POST /api/v0/coleta/gravar` aceitava até 50.000 linhas, mas o corpo era
   cortado em 1 MB pelo `workerRoute` e o `proxy.ts` do Next.js bufferiza o
   corpo com teto padrão de 10 MB. Uma execução grande nunca chegava inteira.
2. Um único `INSERT ... SELECT FROM UNNEST(@linhas)` com dezenas de milhares
   de structs passa do limite de tamanho de requisição/parâmetros do BigQuery.
3. Os coletores divergiam no tratamento de recortes opcionais: Meta e RD
   emitiam `coleta_incompleta`, YouTube, GBP, GA4 e Search Console descartavam o
   recorte em silêncio, e o orquestrador tratava qualquer falha como `failed`.

Também faltava um jeito de conferir, em produção, que o modelo continua
íntegro: grão sem duplicata, SCD2 contíguo, views sem multiplicar linhas.

## Decisão

### Lotes na chamada (n8n) e no INSERT (gravador)

- O orquestrador (`coleta-orquestrador.json`) e a janela do backfill
  (`coleta-backfill-janela.json`) dividem as linhas em lotes de até 10.000
  linhas e 8 MB de JSON (nó "Dividir em lotes") e chamam `/coleta/gravar` uma
  vez por lote, em série (`batchSize: 1`, para não disputar o MERGE da mesma
  tabela). "Conferir gravação" soma `linhasGravadas` + `linhasDescartadas` de
  todos os lotes e compara com as linhas recebidas do coletor; qualquer lote
  recusado falha a execução com `gravacao_bq`.
- O contrato baixa para 10.000 linhas por chamada; o corpo de `/coleta/gravar`
  aceita até 12 MB (`GRAVAR_COLETA_MAX_BYTES`) e `proxyClientMaxBodySize` sobe
  para 16 MB no `next.config.mjs`. O n8n fala direto com `app:3000`, sem passar
  pelo Caddy (que não tem limite de corpo configurado).
- Dentro de uma chamada, o gravador insere no staging em lotes de até 5.000
  linhas ou 8 MB (`dividirEmLotes`) e roda **um** MERGE (ou a transação SCD2)
  por tabela depois de todos os lotes.

### MERGE escopado à chamada, sem DDL novo

Cada chamada carimba todas as suas linhas de staging com o mesmo
`inserido_em` (o gravador sobrescreve o valor do `mapear`) e o MERGE filtra
`execucao_id = @execucaoId AND inserido_em = @inseridoEm`. Assim, várias
chamadas da mesma execução fazem MERGE só das próprias linhas: não remergem o
que outra chamada já gravou e uma repetição da mesma chamada (retry do n8n)
continua idempotente, porque o MERGE é por chave. Usar o `inserido_em` como
marcador do lote evita uma coluna `lote_id` em todas as tabelas de staging
(ALTER em produção). O teste `registro.test.ts` garante que todo fato grava
`execucao_id` e `inserido_em`.

`linhasGravadas` passa a vir acompanhada de `linhasDescartadas` (linhas que o
`preparar` da tabela deduplicou ou rejeitou), para a conferência não acusar
falha quando o servidor descarta linhas de propósito.

### Coleta parcial padronizada

Todo coletor que perde um recorte opcional devolve uma falha
`{ causa: 'coleta_incompleta', detalhe: '<tabela>: <motivo>' }` (uma por
tabela, com a contagem de pedidos recusados) e grava o resto. O orquestrador
classifica as falhas:

| Falhas | Status da execução | Linhas |
|---|---|---|
| nenhuma ou só `sem_dados_no_periodo` | `success` | gravadas |
| alguma `coleta_incompleta`, nenhuma outra | `partial` (`errorCode = coleta_incompleta`) | gravadas |
| qualquer outra causa | `failed` | as que vierem |

`partial` conta como coleta concluída da fonte (`marcarColetaConcluida`):
o dado principal foi gravado e um recorte opcional indisponível de forma
permanente (API desligada, dimensão incompatível) não pode prender a fonte em
retentativa. A lista de recortes perdidos fica em `qualidade_resumo.faltantes`
(`qc_execucoes`) e no `errorMessage` da execução. No backfill, a janela
`partial` conta como `ok`.

### Limites do backfill

O backfill não tem histórico por tabela: cada coletor recebe uma janela e
devolve todas as suas tabelas. Mantemos 37 meses para Google e Meta (janelas de
28 dias). Google Ads no nível Básico (15.000 operações/dia): ≈ 456 operações por
conta no backfill completo (41 janelas × 11 consultas + 5 dimensões), então o
backfill aceita no máximo 20 contas Google por disparo
(`MAX_FONTES_POR_PLATAFORMA` em `coleta-backfill.json`, ≈ 9.100 operações,
deixando folga para a coleta diária). Hoje são 1 ou 2 contas. Para mais
contas, dispare de novo no dia seguinte com `fontes: [fonteId, ...]` no corpo
(o filtro novo do backfill) com as contas que ficaram de fora — a ordem é por
`fonteId`, então o mesmo disparo repetido escolhe as mesmas contas.

### Verificação de integridade

`npm run bq:verificar` (`scripts/bq/verificar-integridade.mjs`) só lê o
dataset (SELECT e dry run pelo `bq`) e falha (código 1) quando:

- falta no dataset uma tabela do manifesto ou transversal, ou há tabela/view
  fora do README (e vice-versa);
- um fato tem duplicata no grão (`grao` do manifesto);
- uma dimensão SCD2 tem chave sem exatamente uma versão atual, versões
  sobrepostas ou com lacuna, `valido_de >= valido_ate`, ou `atual` diferente de
  `valido_ate = 9999-12-31`;
- uma view `vw_*` não executa ou tem número de linhas diferente da base
  (deduplicada pelo grão quando a view deduplica);
- somas não batem: `fato_ads_diario` (campanha × dia) contra a soma de
  `fato_meta_entrega_diaria` e contra `fato_google_campanha_diario`.

Linhas de fato sem versão de `dim_fonte_scd2` que cubra a data e ids de
entidade ausentes na dimensão (`entidades` do manifesto) são avisos: podem ser
legítimos (fonte ainda sem dono, entidade removida antes da primeira coleta de
dimensão) e viram falha com `--estrito`.

Cada entrada do manifesto declara `grao` (a chave do MERGE no registro de
tabelas, ou a chave da dimensão) e, opcionalmente, `entidades`
(`[{ coluna, dimensao, chaveDim }]`). `registro.test.ts` falha se o `grao`
divergir da chave do registro ou se uma tabela do registro ficar fora do
manifesto; `titular.mjs` ignora os dois campos.

## Consequências

- Execuções grandes viram várias chamadas e vários jobs de INSERT; o custo de
  DML do BigQuery é por bytes, não por job, então o custo não muda.
- Duas chamadas no mesmo milissegundo para a mesma execução e tabela
  colidiriam no marcador; o n8n chama em série, então não acontece.
- O `bq:verificar` roda `COUNT(DISTINCT ...)` em todos os fatos: bytes
  processados crescem com o dataset. Rodar sob demanda (depois de DDL,
  backfill ou mudança de coletor), não em agenda.
