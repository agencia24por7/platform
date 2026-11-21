# 0011 — Conexão por chave de API rende uma conta vinculável

- Status: aceito
- Data: 2026-11-20

## Contexto

RD Station CRM, Apify e Z-API se conectam por chave de API (`guardarChave`).
Diferente das plataformas OAuth, não há descoberta: nada era gravado em
`integrations.connection_accounts`, e a tela do conector só oferecia
"Conectar recurso" para `PLATAFORMAS_COM_RECURSO` (ga4, gtm, searchconsole,
youtube, gbp). Resultado em produção: a chave do RD Station era testada e
guardada, mas não havia como dizer de qual cliente (Credaz, Agência 24por7…)
aquela conta é.

## Decisão

- A chave guardada rende exatamente um `connection_accounts` (identidade
  `principal`, nome = rótulo da conexão, estado `discovered`). O `upsert` por
  `(connection_id, external_id)` preserva o vínculo quando a chave é trocada
  ou guardada de novo depois de removida (a conexão é renovada com o mesmo id).
- `rdstation`, `apify` e `zapi` entram em `PLATAFORMAS_COM_RECURSO` (rótulos
  "Conta" e "Instância"). Vincular, mover e desvincular reaproveitam
  `recursoService`, a tela do conector, a do cliente e "Vincular conta ou fonte".
- O vínculo é de dono, não de coleta: essas plataformas estão fora do v1 do
  mapa de fontes. `coletaService.fontes` só devolve plataformas com
  `ativaNoV1`, filtradas no SQL antes do `LIMIT`, para o orquestrador do n8n
  não abrir execução fadada a "sem coletor" nem ter a vaga do lote ocupada.
- A migração `0040_conta_da_chave_de_api.sql` cria a conta para as conexões por
  chave já existentes e não revogadas. É idempotente (`ON CONFLICT DO NOTHING`).
- O assistente de onboarding (`/comecar/contas`) passa a listar só contas de
  anúncio: ele marca como ignorado tudo o que não foi escolhido, e um recurso
  ignorado não pode mais ser vinculado.

## Consequências

- Remover a conexão continua sendo revogação suave: a conta segue com o cliente
  como histórico, e `fontes_de_coleta` já a exclui pelo estado da conexão.
- Quando o RD Station ganhar coletor, basta ligar `ativaNoV1` no mapa de fontes;
  o dono de cada conta já estará definido.

## Adendo (2026-11-20) — remover a conexão solta as contas

Substitui o primeiro item de Consequências e a parte da Decisão que dizia que
guardar a chave de novo depois de removida preserva o vínculo.

Em produção, a conta `principal` do RD Station seguiu vinculada à Credaz depois
de "Remover" e continuou listada como fonte; o único caminho que a tela oferecia
era desvincular, e para quem usa isso soou como "não deixou apagar a conta".

- `connectionService.removerConexao`, depois de revogar, chama
  `liberarContasDaConexao`: toda `connection_accounts` daquela conexão com
  `state = 'linked'` e `client_id` preenchido volta para `discovered` sem
  cliente — a mesma semântica de `recursoService.desvincular`.
- Cada conta solta grava `connection_account.unlink` com `metadata.de` (nome do
  cliente anterior) e `metadata.motivo = 'connection.removed'`, e a remoção dispara
  o aviso de posse (`coleta.dimensoes.sincronizadas`, motivo
  `connection_account.unlink`). Assim `dim_fonte_scd2` (ADR 0013) fecha a posse
  na sincronização seguinte, e `dimensao_mudancas_de_posse` reconstrói o dono
  anterior pela trilha de auditoria como em qualquer desvínculo.
  `connection.removed` passa a levar `contasLiberadas`.
- `listAll`, `listPending` e `listByConnection` ignoram contas de conexões
  revogadas: elas somem da tela do conector, de "Vincular conta ou fonte" e do
  onboarding, e não podem ser vinculadas a partir dali. Guardar a chave de novo
  renova a mesma conexão e a conta reaparece como `discovered`, para ser
  vinculada outra vez de forma explícita.
- `integrations.ad_accounts` (Meta/Google) **não** é tocado. Ali o vínculo é o
  dono histórico das métricas ("O histórico de métricas fica"); a coleta já para
  porque `fontes_de_coleta` (0033) exige `connections.status = 'active'`, e
  reautorizar a conexão retoma a coleta sem precisar revincular cada conta.
  Desvincular uma conta de anúncio continua sendo ação explícita (`unlinkAccount`).
- Os botões "Remover" e "Testar e guardar no cofre" usam `BotaoDeEnvio`
  (`useFormStatus`): ficam desabilitados e mostram "Removendo…"/"Testando e
  guardando…" enquanto a ação roda. Em produção a chave foi guardada quatro
  vezes em dez segundos, e cada envio provisiona um coletor novo no n8n e
  remove o anterior.
- Contas que já estavam vinculadas a conexões revogadas antes desta mudança não
  são migradas: seguem com o cliente até alguém desvincular ou a chave ser
  guardada de novo e removida.

## Adendo (ADR 0029) — revogar no provedor

Remover a conexão do Google ou da Meta passa a revogar o acesso no provedor antes de apagar a credencial do
cofre (workflow temporário com a credencial da própria conexão). A falha do cofre continua sem alterar nada; a
falha da revogação não impede a remoção e vira aviso ao admin. Ver ADR 0029.

## Adendo (ADR 0032, 2026-11-20): a chave mora no cofre de tokens

A chave de API (RD Station, Apify, Z-API) deixou de virar credencial do n8n. `guardarChave` testa a chave em
claro, cifra com `CofreDeTokens.selar` (`tipo = 'api_key'`) e grava conexão e token na mesma transação; rotacionar
a chave renova a mesma conexão (mesma identidade `principal`) e sobe a `versao` do token. O coletor genérico do
RD recebe a chave pela rota `/api/v0/coleta/token` (`tipo = 'query'`, vai em `?token=`). Não há mais coletor
provisionado por conexão.
