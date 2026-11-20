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
| Exclusão de um cliente inteiro | `node scripts/titular.mjs excluir-cliente <client_id>` (simula) e depois com `--confirmar` |
| Correção | pela tela do app (nome e foto vêm do Google; o titular corrige na conta Google e o próximo login atualiza) |
| Revogar consentimento de conexão | remover a conexão na tela de conectores; o titular também revoga no Google ou na Meta |

`anonimizar` revoga os vínculos da pessoa, troca e-mail e nome por marcadores, apaga a foto e retira e-mail e IP
dela da trilha de auditoria. Os registros de auditoria continuam (sem identificar a pessoa) até o prazo de 2 anos.

`excluir-cliente` apaga no Postgres contas, métricas, coletas, convites e acessos do cliente, e no BigQuery as
linhas com aquele `client_id` em todas as tabelas do `tria_dw`. Fica um `client.purged` na auditoria, sem dado
pessoal. Os backups expiram sozinhos em até 30 dias.

## 3. Responder

Envie a resposta (e o JSON, no caso de acesso ou portabilidade) ao titular e anote a data de conclusão no
registro do pedido.
