# Release 2026-11 — cofre de tokens, contexto do cliente e privacidade

Primeira subida de `dev` para `main` desde o PR #106: PRs #89–#121 (ADRs 0023–0033). Nome da release
(usado no atestado do BigQuery): **`2026-11-cofre-e-contexto`**. Desenho das travas: ADR 0034.

**O que muda de irreversível:** as migrações 0121/0122 (corte para o cofre, ADR 0032) põem toda conexão em
`reauth_pending` e apagam os ponteiros do n8n. A coleta para até cada conexão ser reautorizada. Depois da
limpeza do n8n (passo 9) **não há volta** ao modelo antigo.

Quem faz: **H** = pessoa (credenciais de dono no GCP, Meta, Google, GitHub); **A** = agente (lê, compara,
roda dry-run; nunca aplica em produção). Nenhum passo começa sem o anterior verificado.

## 0. Pré-requisitos (H, antes de mergear o PR de release em `main`)

| # | O quê | Comando / onde | Verificação |
| --- | --- | --- | --- |
| 0.1 | Ambiente `producao` protegido (revisor obrigatório, só branch protegida) | ADR 0028 §"Endurecimento que falta" (`gh api -X PUT repos/agencia24por7/platform/environments/producao ...`) | `gh api repos/agencia24por7/platform/environments/producao --jq '.protection_rules[].type'` mostra `required_reviewers` e `branch_policy` |
| 0.2 | gcloud autenticado na conta de dono, projeto certo | `gcloud auth login && gcloud config set project tria-platform` | `gcloud config get-value project` = `tria-platform` |
| 0.3 | VM ligada | `scripts/vm-ligar.sh` | `gcloud compute instances describe tria-producao-vm --zone us-central1-a --format='value(status)'` = `RUNNING` |
| 0.4 | Snapshot do disco de dados com menos de 24 h (o pre-flight exige) | o agendamento diário (06:00, `backup.tf`) ou à mão: `gcloud compute disks snapshot tria-producao-dados --zone us-central1-a --snapshot-names=tria-producao-dados-pre-release-$(date -u +%Y%m%d%H%M)` | `gcloud compute snapshots list --filter="sourceDisk~/disks/tria-producao-dados$ AND status=READY" --sort-by=~creationTimestamp --limit=1` |
| 0.5 | Exportar o estado das conexões para fora do repositório | `scripts/tunel.sh postgres` e `psql -h 127.0.0.1 -p 15432 -U postgres tria -c "\copy (SELECT id, platform, status, credential_ref, coletor_ref, executor_ref FROM integrations.connections) TO 'conexoes-pre-corte.csv' CSV HEADER"` | arquivo guardado fora do repo, sem ir para chat/ticket |
| 0.6 | Janela anunciada às agências (coleta para até a reautorização) | — | aviso enviado |

## 1. Segredos novos no Secret Manager (H)

O Terraform cria os **contêineres** dos segredos; a **versão** (o valor) é sempre manual.

1. Depois do passo 2 (o segredo `meta-exclusao-pepper` só existe após o apply), gere a pimenta da Meta —
   hexadecimal, 64 caracteres, nunca igual ao segredo de sessão, sem passar pelo terminal compartilhado:
   ```sh
   openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add tria-producao-meta-exclusao-pepper --data-file=-
   ```
2. `tria-producao-alert-webhook-url` (novo, opcional): URL HTTPS do canal de alertas.
   `printf '%s' 'https://...' | gcloud secrets versions add tria-producao-alert-webhook-url --data-file=-`
3. `tria-producao-leadads-login-config-id` (já existia; confira se tem versão): `config_id` da configuração
   "Login for Business" do Lead Ads no painel da Meta.
4. Verificação (sem imprimir o valor):
   ```sh
   for s in meta-exclusao-pepper worker-db-password leadads-login-config-id alert-webhook-url meta-app-secret; do
     printf '%s: ' "$s"; gcloud secrets versions list tria-producao-$s --filter=state=ENABLED --format='value(name)' --limit=1 | grep -q . && echo ok || echo FALTA
   done
   ```
   `meta-exclusao-pepper` e `worker-db-password` são obrigatórios (o pre-flight barra sem eles).
5. Segredo do GitHub `ALERT_WEBHOOK_URL` (opcional, Settings → Secrets → Actions): o smoke pós-deploy avisa por ele.

## 2. Terraform via `main` (H aprova, workflow aplica)

O merge do PR de release em `main` dispara `infra.yml` (plan salvo → apply) **e** `deploy.yml`. O deploy agora
**espera** o `infra.yml` do mesmo commit (`scripts/release/aguardar-infra.sh`, até 25 min) e falha se o apply
falhar. Aprove primeiro o job `apply` do `infra.yml` no ambiente `producao`.

Cria/importa: anel e chave KMS (`tria-producao-tokens/conexoes`, `tokens.tf`), IAM da VM na chave, audit config do
KMS, API `cloudkms`, bucket `tria-platform-tria-producao-contexto` (`contexto.tf`), segredos
`meta-exclusao-pepper` e `alert-webhook-url`, importa `whatsapp-*` e `rdstation-*`, novo `startup-script` (só vale
no próximo boot; o `completar-env.sh` cobre o `.env` sem reiniciar).

Verificação: job verde; no resumo, o plano aplicado. `gcloud kms keys describe conexoes --keyring tria-producao-tokens --location us-central1`
e `gcloud storage buckets describe gs://tria-platform-tria-producao-contexto` respondem.

O primeiro `deploy.yml` desse merge **vai falhar de propósito** no pre-flight (código 3, "corte sem autorização")
ou por falta da DDL do BigQuery: nada é tocado no banco e a versão anterior continua no ar. Isso é o esperado.

## 3. DDL do BigQuery ANTES do deploy (H roda, A pode rodar o dry-run)

```sh
node scripts/bq-ddl.mjs --help
node scripts/bq-ddl.mjs --prod --dry-run      # valida todos os arquivos, não altera nada
node scripts/bq-ddl.mjs --prod --confirmar    # aplica (idempotente: CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / views)
```

Novos desde a última DDL de produção: `gov_snapshot_fontes.execucao_id` (03), `fato_/stg_search_console_tipo_diario`
e `vw_search_console_tipo_diario` (23), `gov_cobertura_cliente` (29); as views de todas as plataformas foram
recriadas. A lista que o pre-flight confere está em `infra/compose/preflight-bq.txt`.

Verificação: `bq show --schema tria-platform:tria_dw.gov_snapshot_fontes | grep execucao_id` e
`bq show tria-platform:tria_dw.gov_cobertura_cliente`. Se a VM não conseguir ler o BigQuery, o pre-flight pede o
atestado: input `bq_ddl_aplicado=2026-11-cofre-e-contexto` no deploy.

## 4. Deploy com autorização do corte (H)

```sh
gh workflow run deploy.yml --ref main -f autorizar_corte=true -f bq_ddl_aplicado=2026-11-cofre-e-contexto
gh run watch "$(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Ordem do job `publicar` (cada etapa só começa com a anterior verde):

1. espera o `infra.yml` do mesmo commit;
2. imagem nova publicada; pilha enviada à VM (inclui `corte-gate.txt`, `preflight-vm.sh`, `preflight-bq.txt`);
3. **pre-flight** (`scripts/preflight-release.sh` → `infra/compose/preflight-vm.sh`): VM `RUNNING`, snapshot < 24 h,
   segredos com versão, `completar-env.sh`, KMS cifra+decifra real, bucket do contexto acessível, objetos do
   BigQuery, ambiente validado **dentro da imagem nova** pelo schema do `env.ts` (sem imprimir valor), Postgres
   pronto, lista de migrações pendentes, recusa do corte sem `autorizar_corte`, **backup lógico** `pg_dumpall` em
   `gs://tria-platform-tria-producao-backups/postgres/pre-release-<sha>-<hora>.sql.gz`, marca `.preflight-ok`;
4. `migrar.sh` (o portão recusa 0121/0122 sem `RELEASE_CORTE_AUTORIZADO=1` **e** marca do pre-flight do mesmo sha);
5. troca do app e restart do proxy;
6. smoke: `/api/health` 200, `/api/v0/sync/queue` sem token 401, rotas do cofre (`/api/v0/coleta/token`,
   `/api/v0/tokens/*`, `/api/v0/tarefas/token`) 404 pelo proxy; falha alerta em `ALERT_WEBHOOK_URL`.

Verificação no log: `aplicando 0121_corte_para_cofre.sql ... ok`, `0122 ... ok`, `0130`–`0134 ... ok`,
`smoke pós-deploy aprovado`. No banco (túnel): `SELECT status, count(*) FROM integrations.connections GROUP BY 1;`
(tudo `reauth_pending`/`revoked`) e `SELECT count(*) FROM integrations.corte_para_cofre_refs;` (= conexões sem token).

Migrações aplicadas nesta release (produção estava em 0042): 0043, 0044, 0045, 0050, 0051, 0060, 0070, 0080, 0090,
0100, 0120, **0121**, **0122**, 0130, 0131, 0132, 0133, 0134. Nenhuma `.sem_transacao`. Cuidados: 0043/0044 trocam
`core.excluir_cliente`; 0060 cria o contexto (34 KB); 0070 cria o papel `orla_worker` (senha sincronizada do
`WORKER_DB_PASSWORD`); 0080 e 0133 reescrevem `metadata` de `audit.audit_log` (posse legada por nome, revista pela
0133); 0122 **remove** `automation.fontes_de_coleta`, `task_queue` e `sync_queue` antigas (workflows antigos do n8n
quebram até o passo 5); 0132 preenche `status_desde`; 0134 troca a função do callback da Meta (pimenta nova).

## 5. n8n logo depois do deploy (H, túnel IAP)

```sh
scripts/tunel.sh n8n                                   # outro terminal; n8n em localhost:15678
export N8N_API_URL=http://localhost:15678 N8N_API_KEY=<chave de DONO da instância>
npm run n8n:sincronizar                                # simulação: revisar o relatório
npm run n8n:sincronizar -- --criar --aplicar           # repetir até nenhum "bloqueado" nem "fluxo de erro ainda não implantado"
```

A ordem de implantação é fixa (alertas → genéricos → backfill · janela → demais), então a segunda rodada liga o
`errorWorkflow` de quem foi criado antes dos alertas. Criados agora: `ORLA · plataforma · alertas de falha`,
`ORLA · tokens · renovação`, `ORLA · brain · publicar catálogos pendentes`, `ORLA · brain · cobertura diária`,
`ORLA · contexto · publicar brain pendente`, `ORLA · privacidade · YouTube 30 dias` (e atualizados
`ORLA · privacidade · retenção diária`, `ORLA · coleta · dimensões diárias`, orquestrador, backfill e tarefas de
conta), os coletores genéricos
`ORLA · {Plataforma} · coletor` e os executores `ORLA · Google Ads · executor` / `ORLA · Meta Ads · executor`.
Todos usam só a credencial **"ORLA · worker token"** (ligada pelo nome; tem de existir com esse nome exato).

Verificação: no orquestrador, nó `Chamar coletor`, e em `tarefas de conta`, nó `Executar tarefa`, os ids são os
dos genéricos recém-criados (sem `origem:`), e os genéricos têm a tag `platform`. Rodar
`ORLA · tokens · renovação` à mão uma vez: `{ avaliadas, renovadas, reautorizar, falhas }`.

## 6. Piloto de reautorização (H, na tela Integrações)

Uma conexão de cada família, **com a mesma conta que autorizou antes** (a tela avisa "Você autorizou com outra
conta" com o e-mail esperado): 1 Google (Ads), 1 Meta (Ads) e 1 chave de API (RD Station). Para cada uma:

```sql
SELECT c.id, c.platform, c.status, t.tipo, t.kms_key_version FROM integrations.connections c
  JOIN integrations.connection_tokens t ON t.connection_id = c.id WHERE c.id = '<id>';
SELECT status, error_message FROM automation.coletas WHERE connection_id = '<id>' ORDER BY created_at DESC LIMIT 3;
```

Mesmo `id` de antes, vínculos preservados, `kms_key_version` começando por `projects/`, primeira coleta
`success`/`partial`, linhas novas no BigQuery (`npm run bq:verificar -- --prod`). Google Ads: se
`error_message` trouxer `DEVELOPER_TOKEN_*`, siga ADR 0032 passo 5.

## 7. Reautorização do resto (H, por conexão)

- [ ] Google Ads
- [ ] Google Analytics 4
- [ ] Google Tag Manager
- [ ] Search Console
- [ ] YouTube (remover em vez de reautorizar enfileira o expurgo do BigQuery: não faça)
- [ ] Google Business Profile
- [ ] Meta Ads
- [ ] Meta Pixel
- [ ] Meta Lead Ads (usa `LEADADS_LOGIN_CONFIG_ID`)
- [ ] RD Station (cole a chave de API de novo)

Acompanhe na página **Coletas** e por `SELECT platform, status, count(*) FROM integrations.connections GROUP BY 1, 2;`
até não sobrar `reauth_pending` que deveria voltar. Lead Ads perde o que passar de 90 dias de janela.

## 8. Painéis Meta e Google (H)

- Meta → Configurações do app → Básico → Exclusão de dados do usuário: **URL de retorno de chamada** =
  `https://platform.agencia24por7.com/api/meta/exclusao` (ADR 0029). Testar com o botão do painel.
- Meta → Login for Business: as configurações de `META_LOGIN_CONFIG_ID` e `LEADADS_LOGIN_CONFIG_ID` não precisam
  mais de `ads_management` (o app pede `ads_read`). **Só remova `ads_management` depois de reautorizar e coletar um
  Lead Ads de uma Página real** com a configuração nova; se a Página falhar, mantenha e abra pendência.
- Google Cloud → Credenciais OAuth: URIs de redirecionamento continuam `https://platform.agencia24por7.com/api/oauth/<plataforma>/callback`
  (sem mudança nesta release). O app está publicado e verificado; Ads API no nível Básico.
- DNS/Caddy: nada a mudar no DNS. O Caddy novo responde 404 às rotas do cofre e limita corpo (1 MB; 30 MB em
  `/api/contexto/*`), conferido pelo smoke.

## 9. Limpeza do n8n — só depois do piloto aprovado (H)

Concluído em 2026-11-21 (24 itens, 0 pendências); script `n8n:limpar-legado` removido junto da 0123 (ADR 0035).

Verificação: `SELECT count(*) FROM integrations.corte_para_cofre_refs WHERE limpo_em IS NULL;` = 0.

## Rollback (árvore de decisão)

| Momento | Situação | O que fazer |
| --- | --- | --- |
| Antes do passo 4 / pre-flight reprovado | Nada foi tocado no banco | Corrija o pré-requisito que o log apontou e rode o deploy de novo. A versão anterior continua no ar |
| Falha numa migração (passo 4) | Cada arquivo é atômico: o que falhou foi desfeito; os anteriores ficaram | Não rode a imagem antiga sobre o esquema novo por muito tempo. Corrija e rode de novo, ou restaure (linha abaixo) |
| Depois do passo 4, antes do 9 | App novo com problema | Restaurar o backup lógico `pre-release-<sha>` (ou o snapshot do passo 0.4) **e** a imagem anterior. O deploy só roda de `main`: reverta o merge em `main` (o deploy do revert não tem migração pendente) ou, na VM, `APP_IMAGE=<imagem:sha-anterior>` no `.env` + `docker compose -f docker-compose.prod.yml up -d app` depois de restaurar. As credenciais e workflows antigos ainda estão no n8n. Perde o que o banco gravou depois do backup |
| Smoke reprovado | App no ar com erro | Ler o alerta; `gcloud compute ssh tria-producao-vm --tunnel-through-iap -- sudo docker logs orla-app --tail 200`. Rollback = linha acima |
| Depois do passo 9 | — | **Sem volta** ao modelo antigo: as credenciais do n8n foram apagadas; restaurar exige reautorizar tudo de novo |
| BigQuery | — | A DDL é aditiva (tabelas/colunas novas, views recriadas); não precisa voltar |

Restaurar o backup lógico: `gcloud storage cp gs://tria-platform-tria-producao-backups/postgres/pre-release-<sha>-<hora>.sql.gz .`
(conta de dono), parar `app`/`n8n`, `gunzip -c ... | docker exec -i orla-postgres psql -U postgres` num banco
recriado. Restaurar o snapshot: novo disco a partir do snapshot e `data_disk_source_snapshot` no Terraform (ADR 0002).

## Release 0123 (remoção do legado do cofre)

A `0123_remover_legado_do_cofre.sql` está em `db/migrations/` e em `db/corte-gate.txt` (é um `DROP`): o deploy só a
aplica com `autorizar_corte=true` e a marca do pre-flight da mesma release. Antes de disparar, confirmar na VM:

```sql
SELECT count(*) FROM integrations.corte_para_cofre_refs WHERE limpo_em IS NULL;  -- 0
```

A própria migração recusa se houver linha sem `limpo_em` ou conexão com `credential_ref`/`coletor_ref`/`executor_ref`.
Depois dela, não há volta ao modelo antigo sem restaurar backup (ADR 0035).

## Depois da release

- Remover a variável `RELEASE_CORTE_AUTORIZADO`/`BQ_DDL_APLICADO` do repositório, se foram criadas.
- Release 0123: ver a seção "Release 0123" abaixo.
- Job de recifragem após rotação do KMS (ADR 0032, pendências).
- Monitoramento: workflow `ORLA · plataforma · alertas de falha` (ligado a todos os workflows da plataforma por
  `errorWorkflow`), página Coletas, `ORLA · tokens · renovação` a cada 6 h, `npm run bq:verificar -- --prod` diário
  na primeira semana.
