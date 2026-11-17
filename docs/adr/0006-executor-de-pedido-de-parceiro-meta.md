# 0006 — Executor do pedido de parceiro na Meta (`bm_partner_request`)

- Status: aceito
- Data: 2026-11-17
- Issue: 24K-111

## Contexto

A página do cliente tem a ação "Pedir acesso parceiro no Meta". Ela cria uma
tarefa `bm_partner_request` com:

- o Business Manager da agência (`managerExternalId`);
- a conta de anúncio do cliente (`targetExternalId`, `act_…`);
- a conexão Meta da agência, autorizada pela equipe.

Nenhum workflow executava essas tarefas. Até o ADR 0005 elas seriam
consumidas e falhariam; depois dele, ficavam pendentes para sempre.

## Decisão

- **Executor por conexão Meta** (`executores/executor-meta-partner.json`), no
  molde do executor da MCC. O app o cria ao autorizar a Meta
  (`executorProvisioner`) e grava o `executor_ref` da conexão.
- **O pai foi generalizado** para `ORLA · tarefas de conta`
  (`tarefas-de-conta.json`, antes `convites-mcc.json`). Ele lê
  `kinds=mcc_invite,mcc_accept,bm_partner_request` e roteia cada tarefa ao
  executor da conexão dela. Cada executor só aceita os tipos da própria
  plataforma.
- **O pedido** é `POST /{bm-da-agência}/client_ad_accounts`, com
  `adaccount_id` e `permitted_tasks`. Ele fica pendente até o cliente aprovar
  no Business Manager dele. A tarefa termina `done`, com o estado devolvido
  pela Meta (`PENDING`/`CONFIRMED`) no `outcome`.

### Segurança

- **Mínimo privilégio:** o pedido solicita **só `ANALYZE`**, que basta para
  ler insights. A Orla só coleta (ver a verificação de acesso na 24K-111), então
  pedir `ADVERTISE` ou `MANAGE` na conta de um cliente daria à agência um
  poder que o produto não usa. Se um dia a Orla operar campanhas, ampliar a
  lista é uma decisão explícita, com ADR próprio.
- **Entrada validada antes de virar URL:** o BM precisa ser só dígitos e a
  conta precisa seguir `act_<dígitos>`. Um caminho ou parâmetro injetado é
  recusado no plano, sem chamada à Meta.
- **`validarSomente` só lê.** A Graph API não tem modo de validação nesse
  endpoint. Nesse modo, o executor faz um `GET` no BM, para conferir que a
  credencial o enxerga, e nunca chama o `POST`.
- A credencial continua no cofre do n8n, presa ao nó do executor da conexão.
  O app só conhece o `executor_ref`.

## Consequências

- O pedido de parceiro passa a funcionar de ponta a ponta. A concessão
  efetiva depende do cliente aprovar.
- Para a organização pedir, ela precisa de um `business_manager_id`
  (descoberto na autorização da Meta ou informado em `/config`) e de uma
  conexão Meta autorizada pela equipe.
