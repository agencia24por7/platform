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

5. **Nenhum coletor funcionava no n8n 2.46.** Todos chamavam
   `this.helpers.httpRequestWithAuthentication` dentro do Code Node. No n8n
   2.x o Code Node roda num *task runner* (obrigatório) que não oferece essa
   função: `The function "helpers.httpRequestWithAuthentication" is not
   supported in the Code Node`. Havia também bugs específicos:
   - **YouTube:** `replace(/\D/g, '')` transformava `UCdYpKe8…` em `8990`.
   - **Meta:** não paginava.
   - **GBP:** podia gerar `locations/locations/…`.

6. **O BigQuery recebia nulo em toda coluna DATE/TIMESTAMP.** Na
   `@google-cloud/bigquery` 9.6, um parâmetro tipado como DATE ou TIMESTAMP é
   lido como `valor.value`. Uma string ISO pura não tem `.value`, então o
   valor vai nulo (`Required field data_dia cannot be null`). Isso afetava os
   fatos, `gov_snapshot_fontes` e `qc_execucoes`.
7. **Um 403 por API desligada era tratado como `reauth_pending`.** A
   Analytics Data API não estava habilitada no projeto, e o erro marcou a
   conexão GA4 como pendente de reautorização, o que a tirou da coleta.
8. **O contrato do `fechar` valida `causa` contra um enum e limita
   `detalhe` a 500 caracteres.** Uma causa fora do enum ou uma mensagem longa
   do Google geraria 400 no `fechar` e deixaria a coleta presa em `running`.

## Decisão

- `parametrosBigQuery.ts` embrulha DATE com `BigQuery.date` e TIMESTAMP com
  `BigQuery.timestamp`, conforme o mapa de tipos de cada tabela. A
  biblioteca só serializa esses tipos quando vêm embrulhados. Um teste de
  regressão prova o comportamento da biblioteca e a correção.
- Os coletores classificam 429, `SERVICE_DISABLED`, `accessNotConfigured` e
  cota esgotada como `api_recusou`. Só 401, 403 de permissão e o código Meta
  190 viram `reauth_pending`. `detalhe` é truncado em 500 caracteres, e o
  `errorMessage` do nó Conferir gravação em 1000.
- `apis.tf` declara todas as APIs de que a coleta depende, entre elas
  `analyticsdata`.

- **Coletores no formato nativo do n8n:** Montar requisição (Code, sem
  rede) → **nó HTTP Request** com a credencial OAuth
  (`predefinedCredentialType`, `fullResponse`, `neverError`, erro de rede
  segue adiante) → Normalizar (Code). A credencial nunca passa pelo código.
  O contrato de saída (`linhas`, `volumetria`, `falhas`, `requests`,
  `versaoApi`) não mudou, então orquestrador e backfill seguem iguais.
  - A Meta pagina por `paging.next`.
  - O GTM encadeia contas → contêineres → `versions:live`, com nós IF que
    levam qualquer falha direto ao Normalizar. Nenhum caminho deixa a
    coleta presa em `running`.

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
