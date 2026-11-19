# 0007 — Webhooks públicos do n8n fora da portaria

- Status: aceito
- Data: 2026-11-18

## Contexto

Todo o host do n8n passa pelo `forward_auth` da portaria (`/api/portaria`).
Isso protege o editor, mas também bloqueia os webhooks de produção: quem chama
de fora (Meta, RD Station) recebe `302` para o login, e a verificação do
webhook da Meta falha.

Os fluxos de leads da Credaz dependem de dois avisos externos:

- `/webhook/meta-leads-36b523ec1f6f6c03a3ef`: aviso `leadgen` da Meta (Página,
  app Agencia24/7 Ads). É a entrada geral de leads de todos os clientes.
- `/webhook/credaz-rd-WQMJzJWbDcykuWO3qV8EU6E`: negociação criada ou atualizada
  no RD Station CRM da Credaz (tarefa automática por etapa do funil).
- `/webhook/credaz-rd-conversoes-c41d9e7a2b`: negociação atualizada no RD da
  Credaz (etapas e vendas enviadas à API de Conversões da Meta).

## Decisão

- Em `infra/compose/n8n.caddy`, um matcher `@webhooks_publicos` lista **só esses
  caminhos exatos** e os envia direto para o n8n, sem a portaria.
- Não liberamos `/webhook/*`: um fluxo novo com webhook continua fechado até ser
  incluído aqui de propósito.
- Os caminhos têm sufixo aleatório e cada fluxo valida a entrada (o GET da Meta
  confere o `hub.verify_token`; o POST só aceita IDs numéricos e reconsulta o
  lead na Graph API com o token do usuário de sistema).

## Consequências

- Cada novo webhook externo exige uma linha neste arquivo e um deploy.
- A entrada de leads valida a assinatura `X-Hub-Signature-256` da Meta com o App
  Secret da tabela `segredos` do n8n e recusa o aviso se o segredo estiver ausente.
  **Substituído pelo ADR 0008:** a validação passou para o app
  (`/api/v0/webhooks/meta/assinatura`) e o segredo saiu do n8n.
