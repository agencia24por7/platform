# ORLA — v0

Monólito modular em Next.js sobre PostgreSQL, com n8n como plano de execução.
O protótipo navegável de telas fica em [`prototipo/`](prototipo/); a visão de produto, em
[`new_specs.md`](new_specs.md).

## O que a v0 entrega

1. **Cadastrar cliente e depois as contas dele** — `/clientes/novo` e `/clientes/:id/contas/nova`.
2. **Coleta pelo n8n com metadados e auditoria completa** — workflow `ORLA · coleta de métricas`.

## Princípios que o código sustenta

| Princípio | Como é garantido |
| --- | --- |
| Nasce sem credencial | Nenhum segredo no repositório. `npm run bootstrap` gera `.env` local com 600. O app recusa subir com segredo curto, ausente ou de exemplo |
| Onboarding sem pré-requisito | O cliente clica em conectar, autoriza na própria plataforma e escolhe as contas. Não precisa de MCC, developer token nem Business Manager |
| O segredo não passa pela aplicação | O token vai direto para o cofre do n8n; o banco guarda só `credential_ref` |
| Agnóstico de usuário e agência | Banco vazio. A primeira organização é criada pela UI, e ela define o próprio MCC e developer token |
| Guarda só o estritamente necessário | A conexão armazena metadado e um `credential_ref`. O token vive cifrado no n8n e **nunca** trafega pela aplicação |
| Isolamento por tenant | Row Level Security nas 8 tabelas. Sem contexto de organização, consultas voltam vazias |
| Auditoria imutável | `tria_app` tem `INSERT` e `SELECT` em `audit.audit_log`, nunca `UPDATE` nem `DELETE` |

## Subir

```bash
npm install
npm run bootstrap        # gera .env com segredos aleatórios (DATABASE_URL = orla_app, web; DATABASE_URL_WORKER = orla_worker, /api/v0; ADR 0028)
npm run infra:up         # postgres + n8n
npm run db:migrate       # infra/compose/migrar.sh: uma transação por arquivo, livro-razão em public.schema_migrations
node scripts/n8n-credential.mjs                                   # token do worker como credencial cifrada
docker exec tria-n8n n8n import:workflow --input=/workflows/coleta-metricas.json
npm run n8n:sincronizar  # confere os workflows da instância contra o repositório (docs/adr/0009)
./scripts/dev.sh         # app em http://localhost:3000
```

| Serviço | Endereço |
| --- | --- |
| App | http://localhost:3000 |
| n8n | http://localhost:5678 |
| PostgreSQL | 127.0.0.1:5432 (somente loopback) |

## Arquitetura

Monólito modular com regra de dependência estrita: `domain ← application ← infrastructure`,
e `http` dependendo só de `application`. Módulos conversam por serviços de aplicação, nunca
alcançando o repositório um do outro. A fiação acontece em um ponto só, `src/composition.ts`.

```
src/
  modules/
    organizations/   domain · application · infrastructure
    clients/
    connections/     autorizações (grants) e contas de anúncio
    ingestion/       fila, execuções, upsert de métricas, reafirmação
    audit/           trilha append-only, porta usada pelos demais módulos
  shared/
    config/          env validado por zod, falha rápido no boot
    db/              cliente postgres e contexto de tenant
    http/            problem+json, wrapper de rota do worker, server actions
    security/        comparação em tempo constante, rate limit, redação de segredo
    result/          Result e Failure tipados, sem exceção para falha esperada
app/                 rotas finas: UI e route handlers
db/migrations/       SQL versionado
n8n/workflows/       automação versionada
```

## API do worker

Autenticada por bearer com comparação em tempo constante, limitada a 120 chamadas por minuto
por chamador, corpo validado por schema, resposta de erro em `application/problem+json`.

| Rota | Função |
| --- | --- |
| `GET /api/v0/sync/queue` | Contas devidas, com janela de rejanela e `credential_ref` — nunca o segredo |
| `POST /api/v0/sync/runs` | Abre execução. Idempotente por `idempotencyKey` |
| `POST /api/v0/sync/metrics` | Upsert idempotente, rejeita linha fora da janela ou incoerente, registra reafirmação |
| `POST /api/v0/sync/runs/close` | Encerra com status, duração, contagem de chamadas e versão da API |

A travessia de tenant acontece em três funções `SECURITY DEFINER` estreitas
(`automation.sync_queue`, `resolve_account_organization`, `resolve_run_organization`), que
devolvem apenas identificadores. O RLS continua ligado para todo o resto.

## Conexão de contas

| Plataforma | Caminho | Detalhe confirmado na documentação |
| --- | --- | --- |
| Google Ads | OAuth do titular, escopo `.../auth/adwords`, PKCE, `access_type=offline` | Escopo **restrito** — exige verificação do app, senão o refresh token expira em 7 dias. Developer tokens foram encerrados em 09/09/2026; o acesso é do projeto Cloud |
| Meta Ads | Facebook Login for Business com `config_id` | `config_id` **substitui** `scope`. Gera token de usuário do sistema que por padrão não expira. Gerenciar contas de terceiros exige **Advanced Access** |

Descoberta: no Google, `ListAccessibleCustomers` seguido de `customer_client` por raiz; no
Meta, `/me/adaccounts`. O resultado vai para `integrations.connection_accounts` e o passo 3 do
assistente deixa a pessoa escolher o que entra.

Variáveis opcionais que habilitam o fluxo real — o app sobe sem nenhuma delas:
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `META_APP_ID`, `META_APP_SECRET`,
`META_LOGIN_CONFIG_ID`, `N8N_API_URL`, `N8N_API_KEY`.

## Verificação

```bash
npm run typecheck
npm run build
node scripts/smoke.mjs              # autenticação, validação e cabeçalhos
ACCOUNT_ID=<uuid> node scripts/verify-ingestion.mjs   # idempotência, reafirmação, janela
```
