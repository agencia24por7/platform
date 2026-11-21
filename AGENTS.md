<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## BigQuery

`scripts/bq/README.md` é o catálogo canônico das tabelas do BigQuery. Toda mudança no BigQuery (DDL em `scripts/bq/*.sql`, configuração em `src/modules/coleta/infrastructure/tabelas/`, manifesto em `scripts/bq/manifesto/`) atualiza esse README no mesmo PR, dentro da seção da plataforma. Fundamentos: ADR 0015.

Scripts que tocam produção não têm alvo padrão (ADR 0028): `node scripts/bq-ddl.mjs` e `npm run bq:verificar` exigem `--projeto` e `--dataset` ou `--prod`; `bq-ddl` em produção exige `--confirmar` e tem `--dry-run`. Antes de rodar qualquer script novo, rode `--help` (sai sem efeito) e leia o alvo impresso. Migração nova em `db/migrations` roda numa transação junto com a linha do livro-razão; o que não roda em transação vai num arquivo `NNNN_nome.sem_transacao.sql` idempotente. Função `SECURITY DEFINER` que atravessa inquilinos recebe `GRANT EXECUTE` para `orla_worker`, nunca para `orla_app`.

## Release para produção

Nunca mergear `dev` em `main` sem seguir `docs/release/` (a release atual: `docs/release/2026-11-release-cofre-e-contexto.md`). O deploy espera o `infra.yml` do mesmo commit, roda o pre-flight (`scripts/preflight-release.sh` → `infra/compose/preflight-vm.sh`) antes de qualquer migração e o `migrar.sh` recusa as migrações de `db/corte-gate.txt` sem `autorizar_corte` (ADR 0034). Migração destrutiva nova entra em `db/corte-gate.txt`; DDL nova do BigQuery que o app já usa entra em `infra/compose/preflight-bq.txt`. Agente não aplica nada em produção: prepara, roda dry-run e entrega o passo ao humano.
