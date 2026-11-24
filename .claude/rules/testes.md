---
paths:
  - "tests/**"
  - "src/**/*.test.ts"
---
# Testes

- Unidade: `npm run test:unit` (`src/**/*.test.ts`, sem infraestrutura). Integração: `npm run test:integration` (`tests/*.test.mjs`, concorrência 1, exige app e Postgres).
- Parametrização: `TRIA_TEST_BASE` (URL do app) e `TRIA_TEST_PG`. Todo teste resolve o container por `tests/apoio/pgContainer.mjs` (`TRIA_TEST_PG`, com `ORLA_PG_CONTAINER` e `PG_CONTAINER` como alias; padrão `orla-postgres`); o container local fica defasado. Para rodar tudo, suba um Postgres descartável com `infra/compose/postgres-init` + `infra/compose/migrar.sh` e defina `TRIA_APP_BASE_URL` igual à porta do app.
- O app sob teste precisa subir com `PLATAFORMA_OPERADORES` contendo `operador@tria.local` (ou o valor de `PLATAFORMA_OPERADORES` do processo de teste): `ensureOperador()` em `tests/helpers.mjs` usa esse e-mail (ADR 0043).
- Sessão de teste: cookie `tria_sessao` assinado com `TRIA_SESSION_SECRET`.
- Teste novo cobre sucesso, erro e isolamento entre organizações quando toca dado de inquilino.
- `tests/ambiente-agentes.test.mjs` valida o ambiente de agentes e não precisa de infraestrutura.
- Escada: typecheck → unit → build → integração só se tocou rota, autorização ou banco.
