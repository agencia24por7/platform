---
paths:
  - "db/**"
  - "src/modules/**/infrastructure/**"
  - "scripts/migrate.mjs"
---
# Banco (Postgres 16 + RLS)

- Todo acesso a dado de inquilino passa por `withTenant` (define `app.organization_id` e `app.client_ids`). Query sem tenant é bug de isolamento.
- Migração nova em `db/migrations/NNNN_nome.sql` roda numa transação junto com a linha do livro-razão. O que não pode rodar em transação vai em `NNNN_nome.sem_transacao.sql`, idempotente.
- Migração destrutiva (DROP de tabela ou coluna) entra em `db/corte-gate.txt`; o `migrar.sh` recusa sem `autorizar_corte` (ADR 0034). Em produção o agente aplica seguindo o roteiro de release; o corte destrutivo pede confirmação nomeada do humano (ADR 0069).
- Função `SECURITY DEFINER` que atravessa inquilinos recebe `GRANT EXECUTE` para `orla_worker`, nunca para `orla_app`. Exceção: só as funções da allowlist exata do ADR 0045 (lista em `tests/apoio/funcoesDefinerDoApp.mjs`, conferida por `tests/fronteiras.test.mjs`), cada uma com prova de inquilino. O ADR 0041 item 4 foi superado por ela.
- Recorte de clientes tem modo explícito (`members.escopo`, ADR 0044): lista vazia nega, `'*'` em `app.client_ids` é sempre explícito.
- Alertas de plataforma (`automation.alertas`): o app não tem `SELECT`; a leitura é só pelo worker (`comoWorker`) depois de confirmar operador (ADR 0043).
- Nunca apagar backups do Postgres.
- Tabela nova com dado de cliente precisa de RLS e de teste de isolamento em `tests/`.
