# Atendimento ao titular (LGPD, art. 18)

Canal: contato@agencia24por7.com. Prazo prometido na política: 15 dias.

## 1. Receber e identificar

- Registre o pedido (data, quem pediu, o que pediu) em `docs/lgpd/pedidos/AAAA-MM-DD-*.md`, sem copiar dados
  além do e-mail.
- Confirme a identidade: responda pelo mesmo e-mail do pedido ou peça confirmação pela conta Google.
- Se o dado for de um cliente da agência (lead, contato de CRM), a agência é operadora: encaminhe ao cliente,
  que é o controlador, em até 2 dias úteis, e apoie o atendimento.

## 2. Executar (VM ligada; `gcloud` logado)

| Pedido | Comando |
|---|---|
| Confirmação, acesso, portabilidade | `node scripts/titular.mjs exportar <email> > resposta.json` |
| Exclusão ou anonimização | `node scripts/titular.mjs anonimizar <email>` (simula) e depois com `--confirmar` |
| Exclusão de um cliente inteiro (fim de contrato, pedido do cliente) | `node scripts/titular.mjs excluir-cliente <client_id> --por <quem pediu>` (simula) e depois com `--confirmar` |
| Desfazer a exclusão de um cliente | `node scripts/titular.mjs restaurar-cliente <client_id> --por <quem pediu>` (simula) e depois com `--confirmar` |
| Eliminação definitiva de um cliente por obrigação legal | `node scripts/titular.mjs expurgar-cliente <client_id>` (simula) e depois com `--confirmar` |
| Correção | pela tela do app (nome e foto vêm do Google; o titular corrige na conta Google e o próximo login atualiza) |
| Revogar consentimento de conexão | remover a conexão na tela de conectores; o titular também revoga no Google ou na Meta |

`anonimizar` revoga os vínculos da pessoa, troca e-mail e nome por marcadores, apaga a foto e retira e-mail e IP
dela da trilha de auditoria. Os registros de auditoria continuam (sem identificar a pessoa) até o prazo de 2 anos.

### Exclusão lógica x expurgo (ADR 0022)

`excluir-cliente` é **lógico** e é o caminho padrão: marca o cliente como excluído (`core.clients.excluido_em`,
`excluido_por`) e arquivado, o que o tira da coleta; revoga convites e cancela tarefas pendentes. Nada é apagado.
O cliente e tudo o que pende dele (contas, métricas, coletas, convites) somem do app pela RLS, e as views `vw_*`
do BigQuery escondem as linhas dele na hora: o script dispara a sincronização de dimensões logo depois da
mudança no Postgres (token do worker lido via `gcloud secrets`; em `--local`, `localhost:3000` e `WORKER_TOKEN`).
Se a sincronização falhar, o script só avisa; a exclusão fica e a sincronização diária completa.
Fica um `client.excluded` na auditoria. `restaurar-cliente` desfaz: o cliente volta **pausado** (retomar a
coleta é decisão de quem opera) e fica um `client.restored`.

`expurgar-cliente` é o **expurgo**: apaga de vez no Postgres contas, métricas, coletas, convites e acessos do
cliente, e no BigQuery as linhas do período de posse (manifesto), as das fontes que só foram dele e as linhas com
aquele `client_id`. Não tem volta. Use só quando houver obrigação legal de eliminar (pedido do titular sem base
legal para manter os dados, art. 16 e 18, VI), registrando o motivo no pedido. Fica um `client.purged` na
auditoria, sem dado pessoal; o nome do cliente sai das linhas antigas da trilha (`de`, `para`, `cliente`, `name`
viram `[cliente expurgado]`) e os recursos que eram dele voltam a `discovered`, sem cliente. Os backups expiram
sozinhos em até 30 dias; o time travel do BigQuery, em até 7 (mais 7 de fail-safe do Google).

Ordem e retomada (ADR 0023):

1. O cliente precisa estar **excluído logicamente** antes (`excluir-cliente`): assim ele já saiu da coleta e
   nenhuma gravação nova entra no meio do expurgo (`/coleta/gravar` recusa cliente excluído).
2. O script sincroniza as dimensões do BigQuery e **aborta sem apagar nada** se a sincronização falhar: o
   expurgo dos fatos depende do período de posse em `dim_fonte_scd2`.
3. Apaga no **BigQuery primeiro** (período de posse, sobras das fontes só do cliente, `client_id`) e só depois
   chama `core.expurgar_cliente` no Postgres, que é irreversível. Por fim repete a limpeza por `client_id` e
   sincroniza de novo.
4. Se um passo do BigQuery falhar, o script mostra o passo e a lista dos pendentes e sai com erro. Todo passo é
   idempotente: **rode o mesmo comando de novo**. Se a falha foi depois do Postgres (o cliente já não existe
   lá), o mesmo comando só repete a limpeza por `client_id`.

As `stg_*` do BigQuery não são apagadas pelo expurgo: não têm `client_id` e expiram em 7 dias
(`docs/lgpd/retencao.md`).

`anonimizar` não muda: trata dado pessoal de um usuário, não exclusão de cliente.

## 3. Responder

Envie a resposta (e o JSON, no caso de acesso ou portabilidade) ao titular e anote a data de conclusão no
registro do pedido.
