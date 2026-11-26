# Terraform da produção

Aplicado só pelo workflow `.github/workflows/infra.yml` (merge em `main`); o `bootstrap/` é aplicado
à mão, uma vez, por uma pessoa. Não rode `terraform apply` daqui.

## Bucket do contexto do cliente (ADR 0027)

Ordem para ativar a funcionalidade:

1. Merge em `main`: o `infra.yml` cria `google_storage_bucket.contexto`, o vínculo
   `roles/storage.objectAdmin` da conta da VM (só neste bucket) e inclui `CONTEXT_BUCKET` no script de
   inicialização. A mudança do script reinicia a VM, que regrava `/opt/tria/.env`.
2. Com credencial de operador: `node scripts/contexto-verificar-bucket.mjs "$(terraform output -raw contexto_bucket)"`.
3. Deploy do app. Sem `CONTEXT_BUCKET` o app sobe e a funcionalidade responde "indisponível".

O papel `roles/storage.admin` da conta `tria-terraform` (bootstrap) já cobre criar bucket e
definir IAM de bucket; nenhuma permissão nova é necessária. A conta de plano (`tria-terraform-plan`) lê
a configuração do bucket pelo papel personalizado `orlaPlanoMetadados` (ver "Identidades do pipeline").

## Identidades do pipeline, dataset e metadados da VM (ADR 0057)

### Quem assume cada conta (provedor `github-oidc` do bootstrap)

O provedor só aceita token cujo `repository_id` e `repository_owner_id` sejam os das variáveis
`github_repository_id` e `github_repository_owner_id` (sem padrão). Para obter os dois ids:

```sh
gh api repos/agencia24por7/platform --jq '.id, .owner.id'
```

| Conta | Atributo exigido | Quem consegue |
|---|---|---|
| `tria-terraform-plan` | `attribute.plano_de_pr = infra-pull-request` | job com `environment: plano`, em evento `pull_request`, cujo workflow é `.github/workflows/infra.yml` (`workflow_ref` começa com `<repo>/.github/workflows/infra.yml@refs/pull/`) |
| `tria-terraform` | `attribute.ambiente_no_ramo = producao@refs/heads/main` | job com `environment: producao` rodando em `main` (apply do `infra.yml`) |
| `tria-deployer` | `attribute.ambiente_no_ramo = producao@refs/heads/main` | job `publicar` do `deploy.yml` em `main` (push ou `workflow_dispatch` a partir de `main`) |

Um `workflow_dispatch` a partir de outro ramo não recebe identidade de produção.

**O que a conta de plano garante, exatamente.** Num `pull_request`, o `workflow_ref` aponta para o `infra.yml` **da
versão do PR**, e o próprio PR pode editá-lo. Então o GCP não garante que roda o `infra.yml` revisado: garante só
que o job está no `infra.yml` (de qualquer PR do repositório), em `pull_request`, e no environment `plano`. Duas
camadas fecham o resto:

1. **O que a conta alcança:** só leitura de metadados e do state, sem escrita de lock (abaixo). Um PR que edite o
   `infra.yml` e assuma a conta não lê dado, não grava lock falso nem apaga o lock de um apply.
2. **Aprovação humana:** o environment `plano` precisa de revisor obrigatório no GitHub. Quem aprova olha o diff do
   PR, em especial `.github/workflows/`, antes de liberar o job.

**Ação manual no GitHub, obrigatória antes do merge:** Settings → Environments → New environment → `plano` →
*Required reviewers* (a pessoa ou o time) → *Deployment branches and tags*: **No restriction** (o `ref` de um PR é
`refs/pull/N/merge`; restringir a ramos protegidos bloqueia todo plano) → Save. Pela API:

```sh
gh api users/<login-do-revisor> --jq .id
gh api -X PUT repos/agencia24por7/platform/environments/plano --input - <<'JSON'
{ "wait_timer": 0, "prevent_self_review": false, "reviewers": [{ "type": "User", "id": <id> }], "deployment_branch_policy": null }
JSON
gh api repos/agencia24por7/platform/environments/plano --jq '.protection_rules'
```

**Sem revisor configurado, o environment `plano` não protege nada.** O GitHub cria o environment sozinho, sem
proteção, na primeira execução de um job que o referencia; a condição do GCP só confere o nome do environment, não
se ele tem revisor. Confira o `protection_rules` acima: precisa listar `required_reviewers`. Com um só mantenedor,
`prevent_self_review: false` deixa a pessoa aprovar o próprio PR; a aprovação continua sendo um passo consciente.

**Lock e concorrência.** O job `plan` roda `init` e `plan` com `-lock=false`, e a conta de plano não tem escrita
no bucket de state (o antigo `planner_lock`, `objectAdmin` em `*.tflock`, saiu). A fila é por job, não por workflow:

- `plan`: `group: infra-plano-<número do PR>`, `cancel-in-progress: true`. Um push novo no mesmo PR cancela o plano
  velho, inclusive o que espera aprovação no environment `plano`. Um plano parado na aprovação não segura nada além do
  próprio PR.
- `apply`: `group: infra-apply`, `cancel-in-progress: false`. Um apply em curso nunca é cancelado. O GitHub guarda só
  **um** pendente por grupo: com três execuções seguidas (A rodando, B e C pendentes), B é descartado quando C chega.
  Isso não perde mudança, porque o apply não usa artefato de outra execução: ele faz checkout do commit da própria
  execução (`github.sha`, que no push em `main` contém os commits anteriores), roda `plan -out=tfplan` e aplica esse
  arquivo no mesmo job. C cobre B. Efeito visível: o `deploy.yml` do commit B espera o `infra.yml` do commit B,
  encontra `cancelled` e falha no passo "Esperar o Terraform"; o deploy do commit C segue e publica o mesmo código.
  O deploy vermelho de B é esperado nesse caso e não precisa ser repetido.
- Plano e apply em paralelo: o plano lê o state sem lock enquanto o apply pode estar gravando. O objeto do state no
  GCS é trocado inteiro a cada gravação, então o plano lê a versão anterior ou a nova, nunca metade. O pior resultado é
  um **plano desatualizado** no resumo do PR; o state não corrompe, porque `terraform plan` não grava state e a conta de
  plano não tem escrita no bucket. Se o resumo do PR parecer estranho logo depois de um apply, rode o plano de novo
  (novo push ou "Re-run jobs").
- Um PR malicioso pode editar a seção `concurrency` do próprio `infra.yml`, mas só afeta a fila do próprio plano: o
  grupo `infra-apply` é declarado no job `apply`, que só roda em `main`.

**O state não guarda segredo.** Conferido em 2026-11-24 pelos recursos da raiz: `google_secret_manager_secret` guarda
só o nome (as versões não são geridas pelo Terraform), não há `random_*`, chave de service account nem material de
chave do KMS, e o `startup-script` lê os segredos na hora. O state traz identificadores: ids do projeto e da conta de
faturamento, e-mails das contas de serviço e dos canais de alerta, IP público, nomes de bucket e o texto do
`startup-script`. Recurso novo que guarde segredo no state (por exemplo `google_secret_manager_secret_version` ou
`random_password`) muda essa conclusão e precisa de ADR. O segredo de borda `proxy-secret` (`TRIA_PROXY_SECRET`, ADR 0060)
segue a regra: o Terraform cria só o recurso; o humano cria a versão por pipe, sem eco, antes do deploy (roteiro em
`docs/release/2026-11-identidades-e-metadados.md`).

### Apply cancelado por outro workflow (risco aceito) e recuperação

**O risco.** O repositório é público. Num `pull_request`, inclusive de fork, roda a definição de workflow **do
próprio PR**. Qualquer job, em qualquer arquivo de `.github/workflows/`, sem OIDC e sem environment, pode declarar
`concurrency: { group: infra-apply, cancel-in-progress: true }`. O nome do grupo vale para o repositório inteiro, então
esse job cancela o apply de produção em andamento ou na fila. O código não fecha isso: o workflow roda antes de
qualquer revisão (CODEOWNERS e ruleset não impedem), mudar o apply de arquivo não muda o alcance do nome do grupo, e
`concurrency` não lê `secrets`, então não há como esconder o nome. O risco é de disponibilidade e de state inconsistente,
não de confidencialidade: quem cancela não ganha identidade nem leitura.

**Passo manual (admin do GitHub): aprovação para todo colaborador externo.** Settings → Actions → General → *Approval
for running fork pull request workflows from contributors* → **Require approval for all external contributors** →
Save. Hoje está em `first_time_contributors`. Para conferir:

```sh
gh api repos/agencia24por7/platform/actions/permissions/fork-pr-contributor-approval
```

O esperado é `"approval_policy": "all_external_contributors"`. Isso reduz o risco para quem **não** tem escrita no
repositório: o workflow do fork só roda depois de alguém aprovar, e quem aprova olha o diff de `.github/workflows/`
antes. Quem **tem** escrita continua podendo abrir um PR do próprio repositório com esse `concurrency` e cancelar o
apply. Esse é o risco residual aceito (ADR 0057).

**Defesa no workflow, e o limite dela.** No job `apply`, os passos "Plan salvo" e "Apply do plano salvo" rodam
`exec terraform ...`. Sem o `exec`, o runner manda o sinal ao `bash` do passo; o `bash` não repassa o SIGINT ao filho e
espera ele terminar (comportamento conferido localmente), e o Terraform só leva o SIGKILL no fim do prazo. Com o `exec`,
o Terraform recebe o SIGINT direto: para de começar operação nova, espera a que está em curso, grava o state e solta o
lock. O limite é de tempo. Pela documentação do GitHub, ao cancelar o runner manda SIGINT, espera cerca de 7,5 s, manda
SIGTERM, espera cerca de 2,5 s e mata. O Terraform trata o SIGTERM como segunda interrupção e sai na hora. Na prática,
o apply tem uns 7 s para terminar a operação em curso: uma atualização de VM ou de chave que demore mais termina sem
state gravado para aquele recurso. Recursos já concluídos tendem a estar no state, porque o Terraform grava o state
durante o apply. O `exec` reduz o estrago; não o elimina, e o procedimento abaixo continua necessário.

**Como identificar.** No GitHub, uma execução do `infra.yml` com o job `apply` em `cancelled` (ou falha no meio do passo
"Apply do plano salvo"):

```sh
gh run list --repo agencia24por7/platform --workflow infra.yml --limit 10 --json databaseId,status,conclusion,headSha,createdAt
gh run view <id> --repo agencia24por7/platform --log --job <id-do-job-apply> > /tmp/apply.log
grep -nE 'Interrupt received|Two interrupts|Still creating|Creation complete|Modifications complete|Error' /tmp/apply.log
```

O log diz quais recursos terminaram (`Creation complete`, `Modifications complete`) e qual estava em curso (`Still
creating...` ou `Still modifying...` sem o `complete` correspondente). O deploy do mesmo commit falha em "Esperar o
Terraform" e não migra nada.

**Lock do state.** O backend é GCS com `prefix = "ambiente/producao"` (`backend.tf`). O lock é o objeto
`gs://<projeto>-tfstate/ambiente/producao/default.tflock`, criado só se não existir e apagado ao fim; o id do lock é a
generation desse objeto. Se o Terraform morreu sem soltar, o próximo apply falha com `Error acquiring the state lock` e
mostra o `ID`, o `Who`, a `Operation` e o `Created`. Para conferir sem o Terraform:

```sh
gcloud storage objects describe gs://tria-platform-tfstate/ambiente/producao/default.tflock --format='value(generation,creation_time)'
gcloud storage cat gs://tria-platform-tfstate/ambiente/producao/default.tflock
```

Soltar é passo do **humano, com ADC** (o agente não roda Terraform local). Só é seguro quando **nenhuma** execução do
`infra.yml` está `in_progress` ou `queued` (`gh run list ... --status in_progress` e `--status queued` vazios) e o
`Created` do lock bate com a execução cancelada. Soltar o lock de um apply vivo deixa dois applies gravando o mesmo
state.

```sh
export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)
terraform -chdir=infra/terraform init -input=false -lockfile=readonly -backend-config="bucket=tria-platform-tfstate"
terraform -chdir=infra/terraform force-unlock <ID>
```

**Recurso criado fora do state.** O recurso que estava sendo criado quando o Terraform morreu pode existir no GCP sem
estar no state. Rode o plano (um PR qualquer em `infra/terraform/`, aprovado no environment `plano`, ou o `plan` local do
humano com ADC) e leia cada `+ create`. Para cada um, confira se já existe (console ou `gcloud ... describe`). Se
existir, o apply tentaria recriá-lo e falharia com `409 already exists`. A saída é importar, no mesmo padrão de
`secrets.tf`:

```hcl
import {
  to = google_kms_crypto_key.tokens
  id = "projects/tria-platform/locations/us-central1/keyRings/tria-producao-tokens/cryptoKeys/conexoes"
}
```

O formato do `id` de cada tipo está na documentação do provedor (seção *Import*). O PR com o `import` mostra no plano
`will be imported` sem `create`. Depois do merge, o bloco pode ficar (é inócuo) ou sair num PR seguinte. Recurso que
estava sendo **atualizado** não precisa de import: o próximo plano lê o estado real e mostra o que falta.

**Passo final.** Reexecutar o apply da `main` (`gh workflow run infra.yml --ref main` ou "Re-run jobs" na execução
cancelada, aprovando o environment `producao`) e conferir que termina sem erro. Depois, o deploy do commit (repetir o
`deploy.yml` se o anterior falhou em "Esperar o Terraform").

### Permissões da conta de plano

Só o papel personalizado `orlaPlanoMetadados` no projeto, mais `roles/storage.objectViewer` no bucket de state. Nenhum
papel predefinido: os prontos de leitura juntam permissões que leem dado (`roles/compute.viewer` traz
`compute.instances.getSerialPortOutput`, `getScreenshot` e `getGuestAttributes`, que leem a saída de boot e o
console da VM; os de storage leem objetos; os de logging leem entradas). O papel personalizado lista só `get`, `list`
e `getIamPolicy`.

| Recurso ou data source do `plan` | Permissões em `orlaPlanoMetadados` |
|---|---|
| `data.google_project` | `resourcemanager.projects.get` |
| `google_project_service` | `serviceusage.services.get`, `serviceusage.services.list` |
| `google_compute_network`, `_subnetwork`, `_address`, `_firewall`, `_resource_policy`, `_disk`, `_disk_resource_policy_attachment`, `_instance` | `compute.{networks,subnetworks,addresses,firewalls,resourcePolicies,disks,instances}.get`, e o que o provedor consulta junto: `compute.{projects,regions,zones,machineTypes,diskTypes}.get` |
| `google_service_account` | `iam.serviceAccounts.get` |
| `google_service_account_iam_member` | `iam.serviceAccounts.getIamPolicy` |
| `google_project_iam_member`, `google_project_iam_audit_config` | `resourcemanager.projects.getIamPolicy` |
| `google_storage_bucket`, `google_storage_bucket_iam_member` | `storage.buckets.get`, `storage.buckets.getIamPolicy` |
| `google_bigquery_dataset` (com `access`) | `bigquery.datasets.get` |
| `google_secret_manager_secret` (e os `import`), `_iam_member` | `secretmanager.secrets.get`, `secretmanager.secrets.getIamPolicy` |
| `google_kms_key_ring`, `google_kms_crypto_key`, `_iam_member` | `cloudkms.keyRings.get`, `cloudkms.cryptoKeys.get`, `cloudkms.cryptoKeys.getIamPolicy` |
| `google_dns_record_set` (A e CAA) | `dns.managedZones.get`, `dns.resourceRecordSets.get`, `dns.resourceRecordSets.list` |
| `google_logging_metric`, `_project_exclusion`, `_project_sink`, `_project_bucket_config` | `logging.{logMetrics,exclusions,sinks,buckets}.get` |
| `google_monitoring_alert_policy`, `_notification_channel` | `monitoring.alertPolicies.get`, `monitoring.notificationChannels.get` |
| `google_billing_budget` | nenhuma: `billing.budgets.get` é na **conta de faturamento** (ver abaixo) |
| state no bucket `<projeto>-tfstate` | `roles/storage.objectViewer` **só nesse bucket** |

O que cada permissão expõe, sem dado: `bigquery.datasets.get` devolve a configuração e o `access` do dataset, sem
esquema nem linha (a conta de plano não tem `tables.*`); `compute.instances.get` devolve o metadado da VM, inclusive o
texto do `startup-script` (sem segredo); `dns.resourceRecordSets.list` lista os registros da zona, que já são
públicos; `monitoring.notificationChannels.get` devolve o e-mail do canal. Os papéis prontos que estavam na versão
anterior (`browser`, `iam.securityReviewer`, `iam.serviceAccountViewer`, `serviceusage.serviceUsageViewer`,
`compute.viewer`, `bigquery.metadataViewer`, `secretmanager.viewer`, `cloudkms.viewer`, `dns.reader` e os dois de
monitoring) saíram: `compute.viewer` lê dado, e dos outros não dava para garantir o conteúdo sem consultar o GCP
(`bigquery.metadataViewer` traz `tables.get` e `routines.get`, que mostram esquema, SQL de view e corpo de rotina;
`iam.securityReviewer` é amplo e muda com o tempo).

Incertezas, ditas como são: a lista vem dos tipos de recurso do código e do que se sabe do provedor; o `plan` não foi
rodado com a conta nova. Permissão que falte faz o `plan` falhar fechado com `403`, e a mensagem diz qual; acrescente-a
ao papel se for `get`, `list` ou `getIamPolicy` de metadado. Pontos mais prováveis: o `data.google_project` lê o
vínculo de faturamento do projeto (Cloud Billing), que pode exigir permissão de faturamento; o orçamento é lido na
conta de faturamento, e se o `plan` falhar em `google_billing_budget`, a conta de plano precisa de
`roles/billing.viewer` **na conta de faturamento** (concessão de quem administra o faturamento, fora deste
repositório; mostra custos, não dado de cliente). Uma permissão que não possa entrar em papel personalizado faz o
`apply` do bootstrap falhar; para conferir antes:

```sh
gcloud iam list-testable-permissions //cloudresourcemanager.googleapis.com/projects/tria-platform \
  --filter='customRolesSupportLevel=NOT_SUPPORTED' --format='value(name)' > /tmp/nao-suportadas.txt
grep -c . /tmp/nao-suportadas.txt
```

e confira que nenhuma permissão do `orlaPlanoMetadados` aparece no arquivo.

### Dataset `tria_dw`

`access` autoritativo: `projectOwners` OWNER, `tria-terraform` OWNER e a conta da VM WRITER. Saem `projectReaders`,
`projectWriters` e qualquer `userByEmail` que não esteja no código. O `google_bigquery_dataset_iam_member.vm_editor`
sai do state por `removed` (sem destruir), para a VM não ficar sem escrita no meio do `apply`. Quem mais precisar ler
ou escrever entra por PR com uma entrada `access` nomeada.

O que o `plan` do PR deve mostrar, e o humano confere antes de aprovar:

1. `google_bigquery_dataset.dw` **atualizado no lugar** (`~`), nunca recriado (`-/+`).
2. No `access`: saem `READER projectReaders` e `WRITER projectWriters`; a entrada `WRITER` com o e-mail
   `tria-<ambiente>-vm@...` **não** aparece como removida (ela é igual antes e depois).
3. Se aparecer `- OWNER userByEmail <e-mail>` diferente de `tria-terraform@...`, decida se essa pessoa precisa
   continuar dona; dono do projeto continua OWNER por `projectOwners`.
4. `google_bigquery_dataset_iam_member.vm_editor will no longer be managed by Terraform` (com `destroy = false`),
   e **nenhum** `destroy` desse recurso.
5. Antes, liste quem perde acesso: `gcloud projects get-iam-policy <projeto> --format=json` e procure membros com o
   papel básico de leitor ou de editor do projeto; se algum deles usa o `tria_dw` (console, Looker Studio), acrescente
   a entrada no mesmo PR.

### Bootstrap (humano, com ADC)

```sh
gh api repos/agencia24por7/platform --jq '.id, .owner.id'
export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)
terraform -chdir=infra/terraform/bootstrap init -backend-config="bucket=tria-platform-tfstate"
terraform -chdir=infra/terraform/bootstrap plan -out=bootstrap.tfplan \
  -var project_id=tria-platform -var region=us-central1 \
  -var github_repository_id=<id> -var github_repository_owner_id=<id-do-dono>
terraform -chdir=infra/terraform/bootstrap apply bootstrap.tfplan
```

`-var github_repository=...` deixou de existir; passá-lo dá erro. O `plan` do bootstrap deve mostrar: o provedor
`github-oidc` atualizado no lugar (mapeamento e condição); `google_project_iam_member.planner["roles/viewer"]` e
`planner["roles/iam.securityReviewer"]` destruídos; `google_storage_bucket_iam_member.planner_lock` destruído;
`orlaPlanoMetadados` e `planner_metadados` criados; `terraform_wif`, `deployer_wif` e `planner_wif` substituídos (o
membro muda). Não aplique com workflow do `infra.yml` ou do `deploy.yml` rodando. Antes do bootstrap, crie o
environment `plano` com revisor (acima): sem ele, o próximo PR cria o environment sem proteção.

### Verificação pós-bootstrap (só leitura)

```sh
gcloud iam workload-identity-pools providers describe github-oidc --workload-identity-pool=github \
  --location=global --format='value(attributeCondition)'
gcloud iam service-accounts get-iam-policy tria-terraform-plan@tria-platform.iam.gserviceaccount.com
gcloud iam service-accounts get-iam-policy tria-terraform@tria-platform.iam.gserviceaccount.com
gcloud iam service-accounts get-iam-policy tria-deployer@tria-platform.iam.gserviceaccount.com
gcloud projects get-iam-policy tria-platform --flatten=bindings --format='table(bindings.role)' \
  --filter='bindings.members:tria-terraform-plan@'
```

Espera-se: a condição com `repository_id` e `repository_owner_id`; o plano vinculado a
`attribute.plano_de_pr/infra-pull-request`; Terraform e deployer a `attribute.ambiente_no_ramo/producao@refs/heads/main`;
na conta de plano, só `orlaPlanoMetadados` no projeto; `gcloud storage buckets get-iam-policy gs://tria-platform-tfstate`
com a conta de plano só em `roles/storage.objectViewer`, sem condição de `.tflock`. Depois, abra um PR que toque
`infra/terraform/`: o job `plan` fica esperando aprovação no environment `plano`; aprove e confirme que ele termina. Se
falhar com `403`, a mensagem diz a permissão que falta.

Para provar que o environment é exigido: num ramo de teste, remova `environment: plano` do job `plan` do `infra.yml`
e abra o PR; o passo de autenticação deve falhar. Para provar que outro workflow não assume a conta de plano: num ramo
de teste, crie
`.github/workflows/teste-plano.yml` com `on: pull_request`, `permissions: id-token: write` e só o passo
`google-github-actions/auth` com `secrets.WIF_PROVIDER` e `secrets.TF_PLAN_SERVICE_ACCOUNT` (com e sem
`environment: plano`), abra o PR e confira que o passo falha (`Permission 'iam.serviceAccounts.getAccessToken' denied` ou `unauthorized_client`). Feche o PR e apague
o ramo sem mergear. O mesmo vale para `workflow_dispatch` do `deploy.yml` a partir de um ramo que não seja `main`: o
passo de autenticação falha.

### Verificação pós-`apply` da raiz

```sh
bq show --format=prettyjson tria-platform:tria_dw
```

O `access` deve ter só `projectOwners` OWNER, `tria-terraform@...` OWNER e `tria-<ambiente>-vm@...` WRITER. Em
seguida, rode uma coleta (ou espere a próxima rotina) e confirme que ela grava no BigQuery.

### Metadados da VM

`infra/compose/docker-compose.prod.yml` separa as redes: `interna` (`internal: true`, compartilhada), `saida`
(ponte `orla-saida`, n8n e proxy) e `saida_app` (ponte `orla-app`, só o app). `infra/compose/metadados-bloquear.sh`
grava a cadeia `ORLA-METADADOS` na `DOCKER-USER`: só o que entra pela ponte `orla-app` alcança `169.254.169.254`
(DNS na porta 53 continua para todos). O deploy roda `rede-transicao.sh` antes do pre-flight (recria as redes uma
vez e instala o bloqueio) e `metadados-verificar.sh` depois do smoke. Roteiro e reversão:
`docs/release/2026-11-identidades-e-metadados.md`.

### CAA

Com `dns_zone_name` preenchido, o Terraform cria CAA em `app_hostname` e `n8n_hostname` autorizando
`letsencrypt.org` e `sectigo.com` (ZeroSSL), sem wildcard. Se `DNS_ZONE_NAME` estiver vazio nas variáveis do GitHub,
nada é criado e o CAA é manual no provedor de DNS do domínio, com os mesmos três valores.

## Logs na nuvem (opt-in) (ADR 0049, decisão 6)

Desligado por padrão no Terraform (`logs_na_nuvem_habilitado = false`); em produção é ligado pela variável do GitHub
`LOGS_NA_NUVEM_HABILITADO` (ADR 0052), que o `infra.yml` repassa ao `plan` e ao `apply`. Com a variável em `false` o `plan`
não mostra mudança alguma: o script de inicialização renderiza byte a byte igual ao anterior e nenhum recurso novo é criado.

### O que liga

- No script de inicialização da VM: instalação do Google Cloud Ops Agent pelo repositório apt (`packages.cloud.google.com`,
  chave dearmored em `/etc/apt/keyrings`). Não usa o script de instalação baixado e executado na hora (risco de
  cadeia de suprimentos: executaria código remoto não revisado como root). O risco que resta é confiar na chave
  e no repositório do Google, e por isso a chave só é aceita se a impressão digital conferir (ver "Antes de ligar").
- Só logs: métricas de host e o pipeline padrão de syslog ficam desativados (`default_pipeline` com `receivers` vazio).
  O agente lê todos os `/var/lib/docker/containers/*/*-json.log`, mas só sai da VM a linha com o formato da
  aplicação (`src/shared/logging/linha.ts`): `at` em ISO e `level` em debug, info, warn ou error. O resto é descartado
  na própria VM por um `exclude_logs` (lista de permissão: a regra descarta tudo que NÃO tem esse formato).
  Isso deixa de fora Postgres (texto, com `DETAIL: Key (...)=(valor)`), n8n e o Caddy. O Caddy escreve JSON em
  stdout (`http.log.error` leva `request.uri` e `remote_ip`) e várias URIs carregam segredo (`/contexto/<token>`,
  `/convite/<token>`, `/api/webhooks/zapi/<token>`, `/api/portaria/receber?t=`); o JSON do Caddy usa `ts`, `logger`
  e `msg`, sem `at`, então não passa. Linhas da aplicação: `level` vira `severity` e só elas entram na métrica.
  Escolha do critério: filtrar pelo formato não exige mudar `docker-compose.prod.yml` (produção só muda com a
  variável ligada) e falha fechado, pois linha que não parseia como JSON da aplicação é descartada. A alternativa
  `labels` do `json-file` identificaria o container com exatidão, mas altera o compose de produção e a variável
  deixaria de ser a única chave. Limite do critério: qualquer container que emita exatamente `at` ISO e `level` válido
  passaria; hoje só a aplicação emite.
- `google_logging_project_exclusion.containers_fora_da_aplicacao`: segunda trava, do lado da nuvem. Se a sintaxe do
  `exclude_logs` do agente estiver errada, o filtro da VM falha aberto e o log de Caddy ou Postgres chegaria ao
  Cloud Logging. Esta exclusão descarta do armazenamento do `_Default` tudo do log `containers_docker` que não tenha
  `jsonPayload.at`, então esse conteúdo não é guardado nem consultável. O dado ainda trafega da VM até a API, por
  isso o teste obrigatório na VM (abaixo) continua valendo.
- `google_logging_metric.erros_app`: conta linhas `severity>=ERROR` do log `containers_docker` com `jsonPayload.at`, portanto herda o mesmo recorte.
  A mensagem `client.erro` (endpoint anônimo `app/api/erros`, nível ERROR) fica fora da métrica e do alerta
  (`AND NOT jsonPayload.message="client.erro"`) para que um anônimo não dispare e-mail; o log em si continua gravado.
- `google_monitoring_alert_policy.erros_app`: dispara com contagem maior que 0 em janela de 5 minutos e avisa
  os canais `google_monitoring_notification_channel.budget`. Sem e-mails em `budget_notification_emails` a política
  é criada sem canal (aparece no console, não notifica); a mensagem não carrega conteúdo de log.
- `google_logging_project_bucket_config.aplicacao`, `google_logging_project_sink.aplicacao` e
  `google_project_iam_member.sink_aplicacao`: bucket próprio `<prefixo>-aplicacao` com retenção de
  `logs_na_nuvem_retencao_dias` (padrão 3), que recebe só a linha da aplicação. O sink escreve com identidade própria e
  o papel `logging.bucketWriter` restrito, por condição, a esse bucket. O `_Default` do projeto **não é alterado**: a
  auditoria de acesso a dados do KMS e do Secret Manager (ADR 0032) e os demais logs ficam nos 30 dias padrão.
- `google_logging_project_exclusion.aplicacao_no_bucket_proprio`: tira a linha da aplicação do `_Default` para não
  guardá-la duas vezes nem contá-la em dobro nos 50 GiB. Só é criada depois do sink e do papel, mas o IAM propaga de forma
  eventual: nos primeiros minutos do `apply` a linha pode ser descartada antes de a permissão valer. Para investigar, no Logs Explorer use "Refinar escopo" e escolha o bucket `<prefixo>-aplicacao`.
- `google_monitoring_alert_policy.uso_de_logs`: avisa por e-mail quando os logs ingeridos no mês passam de
  `logs_na_nuvem_alerta_uso_gib` (padrão 40 GiB), para agir antes de estourar os 50 GiB grátis. Só avisa.
- O script é idempotente: não reinstala o pacote se já existe e só reinicia o agente se o `config.yaml` mudou.
  Falha na instalação não derruba a subida da pilha (o script registra e segue).

### Passo a passo (humano)

1. Em `terraform.tfvars`: `logs_na_nuvem_habilitado = true`, `logs_na_nuvem_chave_apt_impressao` (ver abaixo) e confira `budget_notification_emails`.
2. PR para `main`; o `infra.yml` mostra o `plan`. Leia: a mudança do script reinicia a VM (como no bucket do contexto).
3. Aprove pelo processo atual (`infra.yml`). Não aplique à mão.
4. Na VM: `systemctl status google-cloud-ops-agent` e `free -m`.
5. No console, Logs Explorer: `logName="projects/<projeto>/logs/containers_docker"`. Confirme que `severity`
   aparece nas linhas da aplicação e que `jsonPayload` não traz o campo `log` duplicado.
6. Gere um erro de teste na aplicação e confirme o e-mail do alerta.

### Custos e retenção (ADR 0054)

Meta: ficar dentro do free tier e guardar o mínimo necessário. Conferido em 2026-11-24 na documentação do Google Cloud
([preços](https://cloud.google.com/products/observability/pricing), [free tier](https://docs.cloud.google.com/free/docs/free-cloud-features)):

- Ingestão: os primeiros 50 GiB por projeto por mês são grátis; acima disso US$ 0,50/GiB. Consulta é grátis.
- Retenção: o padrão de 30 dias já está incluído; acima de 30 dias custa US$ 0,01/GiB/mês. Por isso
  `logs_na_nuvem_retencao_dias` vai de 1 a 30 e o padrão é **3 dias** (cobre um fim de semana entre o alerta por e-mail
  e a investigação). Vale **só para o bucket da aplicação**: encurtar o `_Default` apagaria, em todo o projeto, a trilha de
  acesso a dados do KMS, do Secret Manager e do BigQuery, que fica nele e não está no `_Required`. Reduzir o prazo do
  bucket da aplicação apaga o que for mais antigo que o novo prazo.
- Log excluído (a exclusão do projeto e a lista de permissão do agente) não é cobrado.
- Alerta: sem cobrança hoje; o Google informa que passa a cobrar no mínimo a partir de 2027-09-01 (US$ 0,35 por mês por
  referência de métrica). O alerta de uso do mês usa métrica de billing, que fica fora dessa cobrança.
- Métrica de erros baseada em log: a única fonte encontrada (blog antigo) fala em 150 MiB grátis por conta de cobrança,
  e um contador de linhas usa uma fração disso. **Não confirmado em página vigente**: conferir na primeira fatura.
- Trava de uso: o alerta "uso de logs perto do free tier" avisa por e-mail quando os logs ingeridos no mês passam de
  `logs_na_nuvem_alerta_uso_gib` (padrão 40 GiB, folga de 10 GiB sobre o free tier). A métrica é
  `logging.googleapis.com/billing/monthly_bytes_ingested`, atualizada em lotes de hora em hora (segundo a [página de buckets do Cloud Logging](https://docs.cloud.google.com/logging/docs/buckets); não testado
  neste projeto), por isso o alinhamento é de 2 horas. O alerta só avisa: não corta a ingestão.
- Os logs de acesso a dados (KMS: um por Encrypt ou Decrypt de cada coleta; Secret Manager; BigQuery) também entram nos
  50 GiB e não estão na estimativa abaixo; o alerta de uso mede o projeto inteiro e os cobre.
- Pior caso conhecido: `client.erro` (aberto a anônimo) aceita até 120 requisições por minuto de cerca de 6 KB, ou
  perto de 1 GB por dia (cerca de 31 GB por mês) se alguém saturar o limite. Cabe no free tier, mas consome dois terços dele.
- Volume medido em 2026-11-24, pelo humano, na VM: o container `orla-app` escreveu **1.467 bytes em 24 horas**
  (`docker logs --since 24h orla-app 2>&1 | wc -c`), cerca de 44 KB por mês, contra os 50 GiB do free tier. É uma amostra de
  um dia, de um dia útil comum, e inclui linhas que não são do formato da aplicação, então é teto do que sai da VM. A
  conta do free tier fica dominada pelos logs de acesso a dados (KMS, Secret Manager, BigQuery), que não estão nessa
  medida, e pelo pior caso de `client.erro` acima. Depois de ligar, acompanhe a página Logs Storage do console por um mês.
  Para repetir: `sudo docker logs --since 24h orla-app 2>&1 | wc -c` na VM, por IAP.

### Antes de ligar: impressão digital da chave apt

`logs_na_nuvem_chave_apt_impressao` vem preenchida com `35BAA0B33E9EB396F59CA838C0BA5CE6DC6315A3` (assinante "Artifact Registry
Repository Signer", ID `C0BA5CE6DC6315A3`). Vazia, o script recusa instalar o agente sem tocar no apt (registra e segue,
a pilha sobe). O valor é validado pelo Terraform (exatamente 40 hex, sem espaços, ou vazio), e só a chave com essa
impressão é gravada no chaveiro do apt, não o arquivo inteiro.

Proveniência, conferida em 2026-11-24: `packages.cloud.google.com/apt/doc/apt-key.gpg` baixado por TLS tinha uma única
chave (`gpg --show-keys --with-colons`, linha `fpr`), com essa impressão. Duas fontes independentes a citam: a lista
`SEC_KEYS_VALIDPGPKEYS` de um ebuild do Gentoo e o bug 1828775 do Mozilla (`NO_PUBKEY C0BA5CE6DC6315A3`). **Nenhuma é uma
página oficial da Google**, e a conferência não protege contra comprometimento do próprio domínio da Google. Antes de ligar,
o humano pode reconferir na documentação oficial vigente. A documentação oficial de instalação só descreve o script
`add-google-cloud-ops-agent-repo.sh`; o repositório manual com `google-cloud-ops-agent-<codename>-all` e o suporte a
Debian 13 não estão confirmados lá.

### Privacidade

Os logs saem da VM para o Cloud Logging do projeto, legível por quem tem `roles/viewer`. Só a linha da aplicação sai
(ver acima), e o logger redige segredo e e-mail (ADR 0049, decisão 4). Logs de Postgres, Caddy e n8n não saem. Mesmo
assim, revise amostras no Logs Explorer logo após ligar: se o contexto de alguma linha da aplicação trouxer dado de
cliente, ele ficará `logs_na_nuvem_retencao_dias` dias (padrão 3) no bucket `<prefixo>-aplicacao`, e não no `_Default`.
A cópia local continua nos limites atuais (docker 10m x 3, journald 200M/1 mês).

### Memória da VM

O Ops Agent roda dois processos (fluent-bit e o agente de configuração). O consumo não foi medido nesta VM,
que usa swap de 2 GiB com `vm.swappiness=10`. Observe `free -m` e `systemctl status google-cloud-ops-agent`
nas primeiras horas, e o OOM kill em `journalctl -k`.

### Pontos a testar na VM (não verificados)

- Suporte do repositório `google-cloud-ops-agent-trixie-all` para Debian 13: não confirmado. Se o `apt-get update`
  falhar, o script remove a lista e a chave que criou, registra o erro em `/var/log/tria-startup.log` e a pilha sobe.
- A cadeia de processadores (`docker_envelope`, `docker_para_mensagem`, `app_json`, `so_linha_da_app`, `app_severidade`)
  só foi checada contra a documentação (que não lista `field` no `parse_json`; por isso o campo `log` do docker é movido
  para `jsonPayload.message` e reparseado). Não provado: que o primeiro `parse_json` remova `message` antes do
  `modify_fields`, a sintaxe exata do `exclude_logs` (regex `=~`, `NOT (... AND ...)` com campo ausente), o `time_format`
  com nanossegundos e que `map_values` mantenha a severidade quando `level` não casa. Teste obrigatório na VM, antes
  de dar por bom: gere uma linha da aplicação, uma do Caddy com URI contendo um valor fictício e uma de Postgres; só
  a da aplicação pode aparecer no Logs Explorer. Se alguma do Caddy ou do Postgres aparecer, desligue a variável.
- O `include_paths` com glob em `/var/lib/docker/containers` (volume bind do disco de dados) e leitura sem
  permissão extra (o agente roda como root).

### Rollback (a ordem importa)

1. Primeiro, na VM, passo do humano: `sudo systemctl disable --now google-cloud-ops-agent` e
   `sudo apt-get remove -y google-cloud-ops-agent` (opcional: apagar `/etc/apt/sources.list.d/google-cloud-ops-agent.list`
   e `/etc/apt/keyrings/google-cloud-ops-agent.gpg`). O Terraform não remove o agente.
2. Só então `logs_na_nuvem_habilitado = false` e aplicar pelo `infra.yml`: remove a métrica de erros, as duas políticas
   de alerta (erros e uso), a exclusão do projeto que descarta o que não é da aplicação, a exclusão da linha da aplicação,
   o papel `logging.bucketWriter`, o sink e o bucket `<prefixo>-aplicacao`. Os logs que estavam nesse bucket vão junto; sem
   consulta, o bucket é purgado depois de cerca de 7 dias, e religar o pacote logo em seguida pode falhar até o nome do
   bucket ser liberado (comportamento do Cloud Logging, não testado aqui).
3. Se a variável for desligada com o agente ainda vivo, ele continua enviando logs e as exclusões somem do plano: os logs
   de Caddy, Postgres e n8n e também a linha da aplicação (com `userId` em `client.erro`) passam a ser guardados no
   `_Default` (30 dias, legível por `roles/viewer`) até o agente ser parado, o que contradiz os 3 dias de
   `docs/lgpd/retencao.md`. Nesse caso pare o agente na VM imediatamente.
4. A retenção do `_Default` nunca foi alterada por este pacote, então não há o que reverter nela.
