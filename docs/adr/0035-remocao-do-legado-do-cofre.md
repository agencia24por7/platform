---
status: accepted
date: 2026-11-21
---
# ADR-0035: Remoção do legado do cofre (migração 0123)

## Contexto

O corte para o cofre de tokens (ADR 0032, migrações 0121/0122) zerou `credential_ref`, `coletor_ref` e
`executor_ref` em `integrations.connections` e guardou os ponteiros do n8n em `integrations.corte_para_cofre_refs`.
As colunas e a tabela ficaram de propósito: a imagem anterior ainda as lia durante o deploy e a limpeza do n8n
precisava da tabela como fonte de verdade. A migração destrutiva esperava em `db/pendentes/`.

## Decisão

- A `0123_remover_legado_do_cofre.sql` foi para `db/migrations/` só depois do piloto de reautorização aprovado e
  da limpeza do n8n concluída em 2026-11-21 (24 itens, 0 pendências): antes disso, a tabela era o único registro do
  que apagar e o rollback ainda dependia dela.
- A migração derruba `corte_para_cofre_refs` e as três colunas. Recusa se houver linha sem `limpo_em` ou conexão
  com ponteiro (a imagem anterior não pode ter voltado).
- O portão é mantido: `0123_remover_legado_do_cofre.sql` entra em `db/corte-gate.txt`, então o deploy exige
  `autorizar_corte=true` e a marca do pre-flight da mesma release (ADR 0034). Antes de disparar, conferir
  `SELECT count(*) FROM integrations.corte_para_cofre_refs WHERE limpo_em IS NULL` = 0.
- `scripts/n8n-limpar-legado.mjs` e o script npm `n8n:limpar-legado` foram removidos: dependiam da tabela dropada.
  A pasta `db/pendentes/` deixou de existir.
- `privacidade.conexao_no_corte` e `corte_do_cofre_em_andamento` (0132) já tratam a tabela ausente com
  `to_regclass` e devolvem `false`: o expurgo do YouTube segue normal.

## Consequências

- Não há volta ao modelo antigo sem restaurar backup anterior à 0123.
- Os testes de corte (`tests/corte.test.mjs`) exercitam 0121/0122 sobre dados legados e depois a 0123 (gate,
  recusas e remoção); `tests/segredos.test.mjs` afirma que as colunas não existem mais.
