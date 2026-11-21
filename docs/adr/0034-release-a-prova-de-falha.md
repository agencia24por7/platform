# 0034 — Release à prova de falha: pre-flight, espera do Terraform e portão do corte

Data: 2026-11-20. Status: aceita. Procedimento: `docs/release/2026-11-release-cofre-e-contexto.md`.

## Contexto

`dev` acumulou os PRs #89–#121 sem nunca ir para `main`. Um push em `main` dispara, em paralelo e sem
coordenação, `infra.yml` (plan → apply) e `deploy.yml` (imagem, `completar-env.sh`, KMS, `migrar.sh` com
**todas** as migrações pendentes 0043–0134, troca do app). Entre elas está o corte 0121/0122 (ADR 0032): toda
conexão vira `reauth_pending`, e depois da limpeza do n8n não há volta. Pré-requisitos externos (KMS, bucket,
segredos com versão, DDL do BigQuery, snapshot recente) só eram descobertos — quando eram — depois de o banco
já ter mudado. A auditoria também achou:

- a imagem de produção **não construía**: `.dockerignore` tirava `scripts/`, mas `manifestoDoBigQuery.ts` e
  `expurgoNoBigQuery.ts` importam `scripts/bq/expurgo.mjs` e `scripts/bq/manifesto/*.json`, e o `next build`
  confere o tipo dos `*.test.ts`, que importam `scripts/lib/*`. O CI não percebia porque roda `next build` fora
  do Docker;
- `ALERT_WEBHOOK_URL` existia no `env.ts` mas não chegava ao contêiner (nem segredo, nem startup, nem compose);
- `CONTEXT_BUCKET` só entra no `.env` pelo startup, que só roda no boot: sem reiniciar a VM, o app subiria com
  arquivos e brain desligados.

## Decisão

1. **Espera do Terraform.** O deploy começa por `scripts/release/aguardar-infra.sh`: consulta
   `gh run list --workflow infra.yml --commit $GITHUB_SHA` (permissão `actions: read`) até 25 min; falha se o
   apply falhou ou não terminou; segue sem esperar quando o commit não mexeu em `infra/terraform` (diff
   `github.event.before..sha`) e nenhuma execução aparece em 2 min. Em `workflow_dispatch` (sem `before`) o modo
   é `auto`: espera se houver execução, segue se não houver.
2. **Pre-flight antes de qualquer migração** (`scripts/preflight-release.sh` no runner →
   `infra/compose/preflight-vm.sh` na VM), depois da imagem publicada e da pilha enviada, antes da cópia de
   volumes e do `migrar.sh`. No runner (conta de deploy, `compute.viewer`): VM `RUNNING` e snapshot `READY` do
   disco de dados com menos de 24 h (senão imprime o comando para tirar um). Na VM (conta da VM, que já lê os
   segredos, usa a chave e o bucket): segredos obrigatórios com versão não vazia (pimenta da Meta obrigatória
   quando há `meta-app-secret`), `completar-env.sh`, cifrar+decifrar real no KMS, `gs://` do contexto listável,
   objetos da DDL desta release no BigQuery por `bq show` (lista em `infra/compose/preflight-bq.txt`), e o
   ambiente **que o app vai receber** validado dentro da imagem nova
   (`docker compose run --no-deps app node --experimental-strip-types /app/release/validarAmbienteCli.ts`: schema do
   `env.ts` + política da release, só nomes e motivos, nunca valores). Tudo é conferido e listado de uma vez; com
   qualquer falha sai 1 antes de tocar no Postgres. Aprovado, sobe o Postgres, lista as pendentes
   (`MIGRAR_MODO=listar`), faz `pg_dumpall` para o bucket de backups (só `objects.create`, ADR 0008) e grava
   `/opt/tria/.preflight-ok` com o sha.
3. **BigQuery sem permissão de leitura**: se o `bq show` não puder responder (ferramenta ausente, acesso negado —
   diferente de "not found"), vale o atestado explícito `BQ_DDL_APLICADO=<nome da release>` (input
   `bq_ddl_aplicado` do dispatch ou variável do repositório). Objeto comprovadamente ausente nunca é atestável.
4. **Portão do corte** (`db/corte-gate.txt`, conferido no `migrar.sh` antes da primeira migração): num banco que
   já tem migrações, arquivo listado só roda com `RELEASE_CORTE_AUTORIZADO=1` **e** a marca do pre-flight do mesmo
   `RELEASE_ID`. Bloqueado, sai 3 sem aplicar nada. Banco vazio (CI, dev novo) não tem o que cortar e passa.
   A autorização vem só do input `autorizar_corte` do `workflow_dispatch` ou da variável
   `RELEASE_CORTE_AUTORIZADO=true`; um push comum em `main` nunca autoriza.
5. **Por que abortar tudo e não aplicar "até antes do corte".** O app de `dev` não funciona no esquema anterior
   ao corte: as rotas do cofre usam `integrations.resolver_conexao_do_token` e a concessão de renovação (0122), o
   contexto usa as reservas de arquivo (0130), a privacidade usa a função nova da Meta (0134), e as migrações
   0130–0134 vêm depois de 0121/0122 na ordem. Aplicar só 0043–0120 deixaria um banco que nem a imagem nova nem a
   antiga usam por inteiro, sem ganho. Então o push sem autorização **falha vermelho antes de qualquer migração**,
   com a versão anterior no ar, e o operador refaz por dispatch depois do runbook. O pre-flight recusa o corte
   já no passo da lista (código 3) e o `migrar.sh` recusa de novo (defesa em profundidade).
6. **Smoke pós-troca** (`scripts/release/smoke-pos-deploy.sh`): `/api/health` 200, `/api/v0/sync/queue` sem
   token 401, `/api/v0/coleta/token`, `/api/v0/tokens/*` e `/api/v0/tarefas/token` 404 pelo proxy; falha manda
   alerta para o segredo `ALERT_WEBHOOK_URL` do GitHub e deixa o job vermelho. Não há rollback automático: depois
   das migrações, voltar exige restaurar o backup (decisão humana, tabela do runbook).
7. **Correções de caminho**: `.dockerignore` re-inclui `scripts/bq/expurgo.mjs`, `expurgo.d.mts` e
   `scripts/bq/manifesto/` e exclui `**/*.test.ts`; o CI agora constrói a imagem e roda o validador dentro dela.
   `alert-webhook-url` entra no Secret Manager, no startup e no compose. `completar-env.sh` completa sem reiniciar
   a VM `CONTEXT_BUCKET` (convenção `<projeto>-<prefixo>-contexto` do `contexto.tf`), `LEADADS_LOGIN_CONFIG_ID`,
   `ALERT_WEBHOOK_URL` e a pimenta, sem nunca trocar valor presente.

## Consequências

- O primeiro deploy do merge em `main` falha de propósito (sem autorização ou sem DDL). É o comportamento
  desejado: nada mudou no banco.
- A aprovação do ambiente `producao` vale para dois jobs (apply do Terraform e publicar). Aprovar o Terraform
  primeiro evita o deploy esgotar os 25 min de espera.
- Release futura com migração destrutiva acrescenta o arquivo em `db/corte-gate.txt` (a próxima é a 0123) e a
  DDL nova em `infra/compose/preflight-bq.txt` com o nome da release.
- Testes: `tests/release-preflight.test.mjs` (gcloud, bq, docker, gh e migrar falsos no `PATH`; metadados e upload
  num servidor local), `tests/corte-gate.test.mjs` (Postgres real), `src/shared/config/validarAmbiente.test.ts`
  (lista chaves sem vazar valores).
