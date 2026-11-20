# 0028 — Endurecimento de infra: papel do worker, plano aplicado, migração atômica, scripts sem alvo padrão e limite de corpo no proxy

- Status: aceito
- Data: 2026-11-20
- Relacionados: 0001 (modelo de acesso), 0008 (revisão de segurança), 0024 (revisão do app de conexões, item 6), 0041/0043 (funções de dimensão)

## Contexto

Revisões de segurança independentes apontaram seis problemas:

1. Web e worker conectavam ao Postgres com o mesmo papel, `orla_app`, que
   executava as funções `SECURITY DEFINER` que devolvem todos os inquilinos
   (`automation.dimensao_*`, `fontes_de_coleta`, `sync_queue`, `task_queue`...)
   e a manutenção `core.aplicar_retencao()`. Uma injeção ou falha de
   autorização numa rota web alcançaria os dados de todos. O ADR 0024 só
   desenhou a separação.
2. `infra.yml` rodava `terraform apply -auto-approve`, que gera um plano novo
   na hora de aplicar em vez de aplicar o plano mostrado.
3. O Caddy (`caddy:2.10-alpine`) era a única imagem da produção sem digest.
4. `migrar.sh` rodava cada arquivo em autocommit e gravava o livro-razão
   (`public.schema_migrations`) noutra chamada: uma falha no meio deixava meia
   migração aplicada e a nova execução explodia em "already exists".
5. `scripts/bq-ddl.mjs` tinha produção (`tria-platform.tria_dw`) como padrão
   e ignorava opções desconhecidas: um agente rodou `--help` e aplicou a DDL.
   `scripts/bq/verificar-integridade.mjs` tinha o mesmo padrão (só leitura,
   mas fatura bytes de produção).
6. `proxyClientMaxBodySize: '16mb'` (next.config.mjs) é global: o Next
   bufferiza até 16 MB de qualquer requisição antes de a rota autenticar.

## Decisões

### 1. Papel `orla_worker` (migração 0070)

Classificação das funções `SECURITY DEFINER` que `orla_app` executava:

| Função | Uso | Destino |
|---|---|---|
| `automation.*` (17: `dimensao_clientes/fontes/mudancas_de_posse`, `fontes_de_coleta`, `historico_de_coleta`, `sync_queue`, `task_queue`, `task_result`, `fechar_coleta`, `coleta_concluida`, `coleta_falhou_por_auth`, `resolve_*`) | atravessa inquilinos; só rotas `/api/v0` | só `orla_worker` |
| `core.aplicar_retencao()` | manutenção, `/api/v0/manutencao/retencao` | só `orla_worker` |
| `core.*` de identidade e escopo (`upsert_identity`, `sessao_*`, `client_scope_of`, `is_member`, `memberships_of`, `organizations_of`, `pending_invitations_for`, `accept_invitation`, `create_organization`, `slug_taken`, `any_organization_exists`, `shares_organization`, `encerrar_sessoes`) | web, escopadas pelo usuário da sessão | fica em `orla_app` |
| `integrations.*` de convite e webhook (`resolve_invite_*`, `invite_item_still_pending`, `complete_invite_item`, `resolve_webhook_connection`, `record_whatsapp_inbound`) | rotas públicas da web (convite, webhooks), por token | fica em `orla_app` |

- `orla_worker`: `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`,
  `NOCREATEROLE`. É **membro de `orla_app`**: as 23 políticas RLS são
  `TO orla_app` e valem para quem é membro, então o worker lê e grava sob as
  mesmas políticas e o mesmo `withTenant`, sem privilégio de tabela próprio.
  Uma lista mínima por tabela foi descartada: as rotas `/api/v0` passam por
  repositórios de quase todos os módulos (conexões, tarefas, coletas, métricas,
  auditoria), e um GRANT esquecido quebraria a coleta em produção sem que o
  ganho de segurança mudasse — o que importa é a web **não** ter as funções
  que atravessam inquilinos, e isso a migração garante.
- A 0070 revoga de `PUBLIC` e de `orla_app` e concede a `orla_worker` toda
  função `SECURITY DEFINER` de `automation` (não-trigger) e
  `core.aplicar_retencao()`, varrendo o catálogo. Migração futura que criar
  função de worker concede a `orla_worker`, não ao `coleta.papel_app`; o teste
  de integração (`tests/fronteiras.test.mjs`) falha se `orla_app` voltar a
  executar qualquer uma.
- Senha: o papel já existia (criado como `tria_worker` pelo init do Postgres
  com `WORKER_DB_PASSWORD`, renomeado na 0034) e não tinha privilégio nenhum.
  A migração não guarda senha; o `migrar.sh`, ao final de cada execução,
  aplica `ALTER ROLE orla_worker PASSWORD` com o `WORKER_DB_PASSWORD` do
  contêiner do Postgres (segredo `worker-db-password`, que já existia no
  Terraform). A senha não passa pela linha de comando do host.
- Aplicação: `src/shared/db/client.ts` mantém dois pools (`orla-app` e
  `orla-worker`, `application_name` distintos). `workerRoute` roda o handler
  dentro de `comoWorker()` (AsyncLocalStorage); `sql()`, `withTenant()` e
  `withoutTenant()` escolhem o pool pelo contexto. Assim nenhum repositório
  muda e uma rota web não tem como chegar ao pool do worker: só o
  `workerRoute` chama `comoWorker` (teste de unidade
  `src/shared/db/fronteiraDoWorker.test.ts`, que também exige que toda rota
  `/api/v0` use `workerRoute` e nenhuma outra o use).
- Configuração: `DATABASE_URL_WORKER` (e `DATABASE_WORKER_MAX_CONNECTIONS`,
  padrão 5; com os 10 da web e o n8n cabe em `max_connections=30`).
  Obrigatória em produção e com usuário diferente do `DATABASE_URL`; em
  desenvolvimento e teste, ausente, cai no `DATABASE_URL` (aviso: com a 0070
  aplicada, `orla_app` não executa as funções do worker, então o `.env` local
  precisa da linha — o `npm run bootstrap` já a gera).
- Na VM, `infra/compose/completar-env.sh` deriva `DATABASE_URL_WORKER` de
  `DATABASE_URL` (mesmo host e banco) trocando o usuário por `orla_worker` e a
  senha por `WORKER_DB_PASSWORD` codificada para URL. Roda no deploy, antes
  das migrações, e no `startup.sh` a cada boot (o `.env` é regravado dos
  segredos). Não exige segredo novo nem passo manual no Secret Manager.
  Limitação conhecida: senha com `$` já é interpolada pelo compose em
  `WORKER_DB_PASSWORD`; os segredos são hexadecimais.

### 2. Terraform aplica o plano salvo

`infra.yml`: o job `plan` roda só em PR (identidade somente leitura). Em
`main`, o job `apply` (ambiente `producao`) faz, no mesmo job: confere a
versão do Terraform (`TF_VERSION`, 1.13.1), `fmt -check`, `init
-lockfile=readonly` (providers só das versões e hashes do
`.terraform.lock.hcl`), `validate`, `plan -out=tfplan`, publica o plano
legível e o sha256 do arquivo no resumo do job e aplica `terraform apply
tfplan` — exatamente o arquivo planejado; se o estado mudou entre os dois, o
Terraform recusa o plano velho.

Endurecimento que falta e não se faz por código: regras de proteção do
ambiente `producao` (revisor obrigatório). Com elas, o job `apply` (e o
`publicar` do deploy) só começa depois da aprovação. Passos (admin do repo):

```sh
gh api users/<login-do-revisor> --jq .id
gh api -X PUT repos/agencia24por7/platform/environments/producao \
  --input - <<'JSON'
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [{ "type": "User", "id": <id> }],
  "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false }
}
JSON
```

Pela interface: Settings → Environments → `producao` → *Required reviewers*
(marcar a pessoa ou o time) → *Deployment branches and tags*: *Protected
branches only* → Save. `prevent_self_review: true` exige uma segunda pessoa;
com um só mantenedor fica `false`. Observação: a aprovação acontece antes do
job, portanto antes do plano; quem quiser aprovar vendo o plano lê o plano do
PR (mesmo commit) ou separa plano e apply em dois jobs com artefato — não
feito aqui porque o arquivo de plano carregaria IDs de projeto e de cobrança
num artefato legível por quem lê o repositório.

### 3. Caddy fixado por digest

`caddy:2.10-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d`
— digest do índice multi-arquitetura (OCI image index) da tag, lido em
2026-11-20 da API do registro (token anônimo de `auth.docker.io` +
`HEAD /v2/library/caddy/manifests/2.10-alpine`, cabeçalho
`docker-content-digest`). A tag fica por legibilidade; com digest o Docker a
ignora. O smoke do item 6 baixa e roda exatamente essa imagem no CI. O
Dependabot (`package-ecosystem: docker`) continua propondo atualização.

### 4. Migração atômica

`infra/compose/migrar.sh` (o mesmo script na produção e no CI; o
`scripts/migrate.mjs` local só o chama com o contêiner e o banco do `.env`):

- Cada arquivo roda com `psql --single-transaction` num único fluxo:
  `pg_advisory_xact_lock`, `INSERT` no livro-razão, corpo do arquivo. Se
  qualquer comando falha, tudo é desfeito, inclusive a linha do livro-razão,
  e a próxima execução tenta o arquivo do zero. Duas execuções simultâneas se
  serializam na trava e a segunda falha na chave primária do livro-razão sem
  aplicar nada.
- As linhas exatas `BEGIN;` e `COMMIT;` de topo (padrão das migrações) são
  removidas antes de embrulhar. Sobrando qualquer outro controle de transação
  (`COMMIT`, `ROLLBACK`, `BEGIN;`, `START TRANSACTION` em outra forma), o
  script recusa o arquivo sem aplicar nada.
- Exceção explícita por nome: `NNNN_nome.sem_transacao.sql` roda como está,
  fora de transação, e só depois grava o livro-razão. Para o que o Postgres
  não aceita em transação (`CREATE INDEX CONCURRENTLY`, `VACUUM`); o arquivo
  precisa ser idempotente (`IF NOT EXISTS`). `ALTER TYPE ... ADD VALUE` (0015,
  0022–0025, 0029, 0030, 0042, 0050) roda em transação desde o Postgres 12
  enquanto o valor novo não é usado na mesma transação — todas as migrações
  atuais passam assim (conferido aplicando 0001–0070 num banco novo).
  Marcador por nome e não por comentário porque o nome aparece no `ls` e no
  livro-razão.
- Nome fora de `NNNN_nome.sql` é recusado (o nome entra no SQL do
  livro-razão).
- Provas: `tests/migrar.test.mjs` (banco temporário no contêiner do CI):
  arquivo que falha no meio não deixa tabela nem linha no livro-razão;
  corrigido, aplica; rodar de novo não reaplica; `.sem_transacao` roda
  `CREATE INDEX CONCURRENTLY`; controle de transação no meio é recusado. O CI
  também roda `scripts/migrate.mjs` duas vezes e exige "0 migração(ões)" na
  segunda.
- Bancos locais antigos, criados pelo `migrate.mjs` anterior (que reaplicava
  tudo e não tinha livro-razão), precisam ser recriados (`npm run infra:down
  -- -v`, `infra:up`, `db:migrate`).

### 5. Scripts sem alvo padrão

`scripts/lib/alvoDoBigQuery.mjs` (`node:util` `parseArgs`, `strict`) é usado
por `scripts/bq-ddl.mjs` e `scripts/bq/verificar-integridade.mjs`:

- Não há alvo padrão: exige `--projeto` e `--dataset`, ou `--prod`
  (`tria-platform.tria_dw`). Variáveis de ambiente não viram alvo.
- `-h`, `--help`, `--ajuda`: imprime o uso e sai 0 sem chamar o `bq`.
- Opção desconhecida ou argumento solto: imprime o erro e o uso e sai 2 sem
  chamar o `bq` (código diferente de 0 para que um engano não pareça sucesso
  num script encadeado).
- `bq-ddl`: imprime o alvo; produção (por `--prod` ou pelo alvo explícito
  igual) exige `--confirmar`; `--dry-run` valida cada arquivo com
  `bq query --dry_run` e não altera nada (também em produção sem
  `--confirmar`). O dry run valida contra o estado atual: num dataset vazio,
  arquivos que dependem de tabelas criadas pelos anteriores falham.
- Prova: `tests/scripts-sem-alvo-padrao.test.mjs`, com um `bq` falso no PATH
  que registra cada chamada.
- Fora do escopo, conferidos: `n8n-sincronizar.mjs` (alvo só por variável,
  ensaio por padrão), `titular.mjs` (outro dono), `vm-ligar.sh` e
  `vm-desligar.sh` (a VM de produção é o único alvo e a operação é a
  intenção do script).

### 6. Limite de corpo no proxy

O Next não limita corpo por rota; o Caddy sim. `infra/compose/Caddyfile`:

- Host do app: `request_body` 1 MB para tudo, exceto `/api/contexto/*`
  (matcher `@upload_de_contexto`, 30 MB) para o upload de arquivos de contexto
  que está a caminho. 1 MB cobre os webhooks públicos (WhatsApp aceita até
  1.000.000 bytes, Z-API 500 mil) e as server actions.
- Host do n8n (`n8n.caddy`): 1 MB para `/api/portaria/receber*` e `/webhook/*`,
  16 MB (o `N8N_PAYLOAD_SIZE_MAX` padrão do n8n) para o editor, que já passa
  pelo `forward_auth`.
- O n8n chama o app direto em `http://app:3000/api/v0` pela rede `interna` do
  compose (os workflows apontam para lá), sem passar pelo Caddy; por isso
  `/api/v0/coleta/gravar` mantém os 12 MB do próprio `workerRoute`
  (`GRAVAR_COLETA_MAX_BYTES`). Pelo endereço público, `/api/v0` fica em 1 MB.
- O Caddy corta o corpo quando o upstream o lê (`MaxBytesReader`) e responde
  413; não decide pelo `Content-Length`. O Next lê o corpo antes de a rota
  rodar, então o corte acontece antes do buffer de 16 MB.
- Prova: `scripts/smoke-limite-de-corpo.sh` sobe o Caddy com a imagem fixada
  e os arquivos reais, com upstreams que leem o corpo, e confere 200/413 por
  rota e tamanho. Roda no CI (job `integracao`) e localmente com Docker.

### 7. Outros achados no caminho

- `scripts/migrate.mjs` (CI e local) não tinha livro-razão e reaplicava todos
  os arquivos; passou a chamar o `migrar.sh`.
- O `.env` do `bootstrap` não tinha `DATABASE_URL_WORKER`; passou a ter.
- `infra.yml` não fixava os providers no `init` (sem `-lockfile=readonly`).

## Rollout em produção

Ordem (tudo pelo merge em `main`, sem acesso manual):

1. Merge em `main`. O `deploy.yml` envia `infra/compose` (com
   `completar-env.sh` e o `migrar.sh` novo) e as migrações para a VM.
2. "Aplicar migrações pendentes": `completar-env.sh` escreve
   `DATABASE_URL_WORKER` no `/opt/tria/.env` (falha aqui para antes de mudar o
   banco); sobe o Postgres; `migrar.sh` aplica a 0070 (cria/ajusta o papel,
   move as funções) e sincroniza a senha de `orla_worker`.
3. "Subir a nova versão": o app novo sobe com os dois pools.
4. O `infra.yml` roda porque `startup.sh.tftpl` mudou: atualiza o metadado da
   VM no lugar (sem recriar); vale no próximo boot.

Janela: entre o passo 2 e o 3 (um a dois minutos), o contêiner antigo ainda
usa `orla_app` nas rotas `/api/v0` e recebe `permission denied` nas funções
movidas. As rotinas do n8n que caírem nessa janela falham e repetem no
próximo ciclo; nenhuma escrita fica pela metade (as funções falham antes de
gravar).

Verificação depois do deploy: `/api/health` responde; a próxima rotina de
coleta e `manutencao/dimensoes` terminam sem erro;
`pg_stat_activity` mostra `application_name = 'orla-worker'` com
`usename = 'orla_worker'`.

Passo manual (uma vez, admin do GitHub): regras de proteção do ambiente
`producao` (seção 2).

## Rollback

- Código: reverter o merge e publicar. O app antigo usa só `DATABASE_URL`
  (`orla_app`); para isso voltar a funcionar, as funções precisam voltar para
  `orla_app`: migração nova `00NN_devolve_funcoes_ao_app.sql` com
  `GRANT EXECUTE ON FUNCTION ... TO orla_app` para cada função da tabela
  acima (a mesma varredura da 0070 com `GRANT` no lugar de `REVOKE`). A 0070
  não é desfeita por edição: o livro-razão já a registrou.
- Não há atalho por configuração: apontar `DATABASE_URL_WORKER` para
  `orla_app` é recusado pela validação de produção e, de todo modo, `orla_app`
  não executa mais as funções; o caminho é a migração acima.
- `migrar.sh`: a versão antiga continua compatível com o livro-razão (mesma
  tabela e colunas).
- `infra.yml`: reverter o arquivo; não há estado novo.
- Caddy: trocar o digest; os limites de corpo saem revertendo `Caddyfile` e
  `n8n.caddy` e reiniciando o `proxy`.

## Consequências

- Uma falha na web não executa mais as funções que leem todos os inquilinos;
  o worker continua sob RLS e sem `BYPASSRLS`.
- O worker herda o acesso de tabela da web. Dar a ele menos que a web exige
  trocar a herança por GRANTs explícitos por tabela; não é necessário para o
  objetivo deste ADR e fica como evolução.
- Duas conexões a mais por processo (pool do worker, até 5).
- Migração com falha não deixa estado parcial; arquivo novo que precisar de
  autocommit tem de ser nomeado `.sem_transacao.sql`.
