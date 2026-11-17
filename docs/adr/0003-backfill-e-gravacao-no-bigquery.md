# 0003 — Backfill da coleta e gravação real no BigQuery em produção

- Status: aceito
- Data: 2026-11-17
- Issue: 24K-111

## Contexto

Em 17/11, todas as tabelas de `tria_dw` estavam vazias. Havia quatro motivos:

1. **A produção nunca recebeu `BQ_PROJECT_ID`.** Nem o startup script nem o
   compose repassavam a variável. Sem ela, o gravador responde
   `bigquery_indisponivel`. O IAM já estava certo (`bigquery.jobUser` e
   `dataEditor` para a SA da VM).
2. **O orquestrador só coleta amostras** (`modo=amostra`, de 7 dias para trás,
   no máximo 500 linhas) e não tem como buscar o histórico.
3. **O orquestrador fechava como `success` uma coleta cuja gravação no
   BigQuery tinha falhado.** O `rowsWritten` ficava em 0 e nada sinalizava o
   problema.
4. **O GTM estava ativo no mapa de fontes, mas não tinha coletor nem
   gravador.** Ele é um snapshot e vai para `gov_snapshot_fontes`, não para
   um fato diário.

## Decisão

- `BQ_PROJECT_ID`/`BQ_DATASET` são gerados pelo startup script (Terraform)
  e repassados pelo compose.
- **Backfill em dois workflows:**
  - `ORLA · coleta · backfill` (pai): disparado por webhook autenticado
    (credencial do worker). Lê as fontes elegíveis, gera janelas de 28 dias
    (o limite do modo `completa`) e chama o filho uma janela por vez.
  - `ORLA · coleta · backfill · janela` (filho): abre, coleta, confere,
    grava e fecha uma janela, e devolve só um resumo.
  - O motivo da divisão: uma execução única do n8n guardaria no `runData`
    as linhas de centenas de janelas, o que não cabe no heap de 640 MB.
    Cada janela vira uma execução própria e o pai guarda só resumos.
- **Profundidade do histórico**, a mais recente primeiro: Meta 37 meses,
  Search Console 16 (com 3 dias de atraso), GBP 18, e Google Ads, GA4 e
  YouTube limitados a 37 meses. O GTM gera um snapshot por execução.
- **Retentativa:** o corpo do disparo aceita `tentativa` e uma lista
  explícita de `janelas`. A chave de idempotência inclui `:t<tentativa>`,
  o que permite reabrir uma janela que falhou sem colidir com a execução
  anterior.
- **Nó "Conferir gravação"** (no orquestrador e no filho): se a coleta
  trouxe linhas e o BigQuery não gravou todas, a execução fecha como
  `failed` com `errorCode = gravacao_bq`.
- **Coletor do GTM:** encontra o contêiner pelo `publicId`, lê
  `versions:live` e grava um snapshot em `gov_snapshot_fontes`.

## Consequências

- O backfill é idempotente por janela e tentativa, e retentar é seguro: o
  `MERGE` no fato elimina duplicatas pela chave natural.
- `gov_snapshot_fontes` passa a ter histórico do GTM, uma linha por
  execução.
- Lacuna conhecida: a UI ainda não tem como vincular contas que não são de
  anúncio (GA4, Search Console, YouTube, GTM, GBP) a um cliente.
  `markLinkedToClient` existe no repositório, mas nada o chama.
