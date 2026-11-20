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
