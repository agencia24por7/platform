# 0024 — Revisão dos workflows do n8n: falha visível, sem segredo em execução, sem contagem encolhida

- Status: aceito
- Data: 2026-11-20
- Complementa: 0009 (sincronização), 0018 (GA4 e Search Console), 0021 (gravação em lotes)

## Contexto

Uma revisão dos coletores e do orquestrador achou falhas silenciosas e vazamentos:

1. Coletor que quebra (`onError: continueRegularOutput`) devolvia `{ error }`; o
   orquestrador tratava a ausência de `falhas` como sucesso com 0 linhas.
2. Execuções salvas (`saveData*: all`) guardavam respostas da Graph API cujo
   `paging.next` carrega `access_token`, termos de pesquisa e o conteúdo do contêiner do GTM.
3. Contagens de leads por dia eram sobrescritas por valores menores (MERGE
   `WHEN MATCHED` substitui): o corte de 30 dias não era à meia-noite e o teto
   de 100 páginas cortava os leads mais antigos.
4. Tetos de paginação cortavam dados sem marcar `coleta_incompleta`.
5. `Gravar métricas` sem `onError`: erro de rede abortava o laço e deixava a coleta aberta.
6. O corte `page` do Search Console guardava URLs completas, com query string
   (e-mail, token de redefinição).
7. A sincronização podia sobrescrever workflow alheio (tags de cliente) e a
   marcação com a tag `platform` substituía as tags existentes.

## Decisão

- **Falha de coletor.** `Calcular qualidade` (orquestrador e backfill) trata
  `error`, `linhas` não-array ou `volumetria` ausente como falha fatal com a causa
  `falha_coletor` (constante aditiva em `CausaFaltante` e no contrato de fechamento).
  O detalhe é a mensagem truncada, sem `access_token`, `Bearer` ou chaves.
- **Sem persistência.** Todos os coletores, executores, orquestrador, backfill e
  `tarefas-de-conta` usam `saveDataSuccessExecution`/`saveDataErrorExecution = none`
  e `saveManualExecutions = false`. O erro fica visível em `error_message` da coleta,
  não na execução do n8n. Um teste percorre os JSONs e falha se algum voltar a salvar.
  O GTM já projeta só os campos que grava; com o salvamento desligado a resposta
  completa de `versions:live` deixa de existir fora da memória da execução.
- **Leads por dia.** O corte começa à meia-noite de `America/Sao_Paulo` (UTC−3, sem
  horário de verão desde 2019), então o dia mais antigo vem inteiro. Se a última
  página de um formulário ainda tem `paging.next` (teto atingido), o dia mais antigo
  daquele formulário é descartado e a coleta sai `coleta_incompleta`. Falha ao ler
  qualquer página de leads descarta todos os `leads_diarios` da execução.
- **Tetos de paginação.** Insights e dataset da Meta, GA4 (`rowCount`), Search Console e
  os catálogos do RD passam a marcar `coleta_incompleta` quando o último pedido ainda
  indica mais páginas. Google Ads, YouTube, GBP e GTM não paginam por nó.
- **Gravação.** `Gravar métricas`, `Fechar execução` e `Fechar execução (sem coletor)`
  seguem em frente em caso de erro; `Conferir gravação` transforma a resposta com
  `error` em `gravacao_bq` e a coleta sempre fecha, com o laço continuando.
- **Search Console.** A dimensão `pagina` perde `?...` e `#...` (esquema, host e caminho
  ficam). Linhas que só diferiam pela query são somadas (cliques, impressões; CTR
  recalculado; posição ponderada por impressões), para não duplicar a chave do MERGE.
- **Sincronização.** `marcarDaPlataforma` lê as tags atuais e grava atuais + `platform`.
  Alvo com tag `credaz` ou `agencia` nunca é tocado (`bloqueado`). Alvo sem nota de
  origem e sem a tag `platform` só é assumido com `--adotar`. `provisionar-coletores`
  passa por `ClienteN8n.criar` (que aplica a tag) e cobre `rdstation`, `pixel` e `leadads`.

## Consequências

- Pendente fora do escopo: `pagePath` e `landingPage` do GA4 também podem trazer query string.
- O dataset da Meta com teto atingido marca incompleta mas ainda grava as somas parciais.
- O sync dos workflows precisa rodar para valer (nada muda no n8n até lá).

## Adendo (ADR 0032, 2026-11-20): coletores genéricos

Os modelos por conexão viraram coletores genéricos por plataforma (`ORLA · {Plataforma} · coletor`): o primeiro
nó pede o access token ao app (`POST /api/v0/coleta/token {coletaId}` com a credencial "ORLA · worker token") e
todo nó HTTP do provedor usa `authentication: none` com `Authorization: Bearer …` (ou `?token=` no RD). A lógica
de cada coletor (janelas, lookback, coleta_incompleta, limite_de_uso, sem_acesso, Graph v27.0, saveData none e a
limpeza de segredo nas mensagens) não mudou. `provisionar-coletores` foi removido.
