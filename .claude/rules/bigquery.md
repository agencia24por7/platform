---
paths:
  - "scripts/bq/**"
  - "scripts/bq-ddl.mjs"
  - "src/modules/coleta/**"
---
# BigQuery (`tria_dw`)

- `scripts/bq/README.md` é o catálogo canônico das tabelas: toda mudança de DDL (`scripts/bq/*.sql`), de configuração (`src/modules/coleta/infrastructure/tabelas/`) ou de manifesto (`scripts/bq/manifesto/`) atualiza esse README no mesmo PR (ADR 0015).
- `node scripts/bq-ddl.mjs` e `npm run bq:verificar` exigem `--projeto` e `--dataset` ou `--prod`; em produção o `bq-ddl` exige `--confirmar` e tem `--dry-run`. Rode `--help` antes e leia o alvo impresso (ADR 0028).
- DDL nova que o app já usa entra em `infra/compose/preflight-bq.txt`.
- Agente roda dry-run, lê o alvo impresso e aplica o DDL em produção (ADR 0069).
- Coletor não grava dado pessoal.
