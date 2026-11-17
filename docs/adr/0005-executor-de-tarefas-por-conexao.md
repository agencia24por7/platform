# 0005 — Executor de tarefas de conta por conexão

- Status: aceito
- Data: 2026-11-17
- Issue: 24K-111

## Contexto

O workflow `ORLA · vínculos com a MCC` (`convites-mcc.json`) executa as
tarefas `mcc_invite` e `mcc_accept` de `automation.account_tasks`. Ele tinha
quatro defeitos:

1. **Não funcionava no n8n 2.x.** As chamadas ficavam num Code Node com
   `this.helpers.httpRequestWithAuthentication`, que o *task runner* recusa
   (o mesmo defeito dos coletores, ADR 0003).
2. **Usava uma credencial fixa** (`triaGoogleAds`) para os dois tipos. O
   aceite precisa da credencial **da conta convidada** (migração 0029). A
   fila já entregava o `credential_ref` de cada tarefa, mas o nó HTTP do n8n
   não escolhe credencial por item.
3. **Reivindicava qualquer tipo de tarefa.** `task_queue` não filtrava por
   tipo, então tarefas `bm_partner_request` (Meta) seriam marcadas como
   falhas com "tipo de tarefa desconhecido".
4. **O convite mandava `operations`.** `MutateCustomerClientLink` recebe
   `operation`, no singular, então o pedido sempre levaria 400.

Além disso, ele nunca tinha sido importado em produção.

## Decisão

- **Um executor por conexão**, no mesmo molde dos coletores:
  - `connections.executor_ref` (migração 0036) aponta para um workflow
    criado do template `executores/executor-mcc.json`, com a credencial da
    conexão;
  - o app o cria quando autoriza uma conexão Google Ads, via
    `executorProvisioner`;
  - a criação de workflow com credencial ficou em
    `shared/n8n/workflowComCredencial.ts`, usada também pelo coletor.
- **O pai (`convites-mcc.json`)** lê a fila pedindo só
  `kinds=mcc_invite,mcc_accept`, chama o executor da conexão de cada tarefa e
  sempre reporta um resultado:
  - sem executor: "reautorize a conexão";
  - se o executor falhar: o erro dele.

  Nenhuma tarefa fica presa em `running`.
- **O executor usa nós HTTP Request nativos:**
  - convite: `customerClientLinks:mutate` com `operation`;
  - aceite: busca o vínculo pendente da MCC e faz `customerManagerLinks:mutate`
    com `operations` e `updateMask`.

  A entrada `validarSomente` repassa `validateOnly` à API, o que permite
  testar em produção sem gravar.
- **`task_queue(limit, kinds)`** passa a filtrar tipos. Sem filtro, o
  comportamento antigo se mantém.

## Consequências

- Tarefas `bm_partner_request` ficam **pendentes** até existir um executor
  da Meta. Antes, seriam consumidas e falhariam. Esse executor ainda não
  existe; é uma lacuna conhecida.
- Conexões Google Ads autorizadas antes desta mudança não têm executor.
  Criá-los é um passo único: provisionar o executor e gravar
  `executor_ref`.
