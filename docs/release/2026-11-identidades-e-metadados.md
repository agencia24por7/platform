# Release: identidades do pipeline, dataset `tria_dw` e metadados da VM (ADR 0057)

Linear 24K-122, 24K-125, 24K-123 e o CAA do 24K-128. Três camadas aplicadas por caminhos diferentes, nesta ordem.

## Antes de tudo (leitura, humano)

1. `gh api repos/agencia24por7/platform --jq '.id, .owner.id'`: anote os dois ids.
2. `gcloud projects get-iam-policy tria-platform --format=json`: liste quem tem o papel básico de leitor ou de
   editor do projeto. Quem desses usa o `tria_dw` perde o acesso com a camada 2; acrescente a entrada `access` no PR
   antes do merge.
3. `bq show --format=prettyjson tria-platform:tria_dw`: anote os dois `userByEmail` atuais (OWNER e WRITER).
4. Snapshot do disco de dados com menos de 24 h (o pre-flight exige de qualquer forma).

## Camada 0: environment `plano` no GitHub (humano, antes de tudo)

O job `plan` do `infra.yml` passa a usar `environment: plano`, e o GCP só entrega a conta de plano a job nesse
environment. Crie-o **antes** do merge e antes do bootstrap: Settings → Environments → `plano` → *Required reviewers*
→ *Deployment branches and tags*: **No restriction** (o ref de PR é `refs/pull/N/merge`). Comandos de API e de
conferência em `infra/terraform/README.md`, seção "Quem assume cada conta".

**Sem revisor configurado, o environment não protege nada.** O GitHub cria o environment sozinho, sem proteção, na
primeira execução de um job que o referencia; o GCP só confere o nome. Confira com
`gh api repos/agencia24por7/platform/environments/plano --jq '.protection_rules'` que aparece `required_reviewers`.

Quem aprova o `plan` de um PR olha antes o diff do PR, em especial `.github/workflows/`: o `infra.yml` que roda é o
da versão do PR.

Plano e apply têm filas separadas (`infra-plano-<PR>` e `infra-apply`): um plano esperando aprovação não segura o
apply de `main`. Em dois merges seguidos em `main` com Terraform, o apply pendente mais antigo pode ser descartado pelo
mais novo; o deploy do commit descartado falha em "Esperar o Terraform" com `cancelled` e o deploy do commit seguinte
publica o mesmo código (detalhe em `infra/terraform/README.md`, "Lock e concorrência").

**Reversão:** apagar o environment não reabre nada; sem ele, o job `plan` falha na autenticação até o bootstrap
anterior ser reaplicado.

### Aprovação para todo colaborador externo (humano, Settings → Actions → General)

Qualquer job de qualquer workflow de um PR (inclusive de fork) pode declarar `concurrency: { group: infra-apply,
cancel-in-progress: true }` e cancelar o apply de produção; o código não fecha isso. Em *Approval for running fork pull
request workflows from contributors*, marque **Require approval for all external contributors** (hoje:
`first_time_contributors`) e confira:

```sh
gh api repos/agencia24por7/platform/actions/permissions/fork-pr-contributor-approval
```

Esperado: `"approval_policy": "all_external_contributors"`. Reduz o risco para quem não tem escrita no repositório;
quem tem escrita continua podendo cancelar o apply (risco residual aceito, de disponibilidade, não de
confidencialidade).

### Se um apply for cancelado ou interrompido

Procedimento completo em `infra/terraform/README.md`, "Apply cancelado por outro workflow (risco aceito) e
recuperação". Resumo:

1. Identificar: `gh run list --repo agencia24por7/platform --workflow infra.yml --limit 10` com o `apply` em
   `cancelled`; no log, o recurso com `Still creating`/`Still modifying` sem `complete`.
2. Lock: `gs://tria-platform-tfstate/ambiente/producao/default.tflock`. Só com nenhuma execução do `infra.yml` em
   `in_progress` ou `queued`, o humano com ADC roda `terraform -chdir=infra/terraform force-unlock <ID>` (o `ID` vem
   do erro `Error acquiring the state lock`).
3. Recurso fora do state: no plano, um `+ create` de algo que já existe; PR com bloco `import` (padrão de `secrets.tf`).
4. Reexecutar o apply da `main` e, depois, o deploy do mesmo commit.

**Reversão da aprovação:** voltar a opção para `first_time_contributors`; nenhum estado depende dela.

## Camada 1: bootstrap (humano, à mão, com ADC)

Pode ser aplicada antes do merge, a partir do ramo do PR. Roteiro e comandos em
`infra/terraform/README.md`, seção "Bootstrap (humano, com ADC)". Não aplique com `infra.yml` ou `deploy.yml`
rodando.

Depois: a verificação pós-bootstrap do README (comandos de leitura) e um PR que toque `infra/terraform/`, para
ver o job `plan` terminar com a conta nova.

**Reversão:** aplicar o bootstrap do commit anterior (`git switch --detach <commit-anterior>`, o mesmo `plan` e
`apply`, com `-var github_repository=agencia24por7/platform` no lugar dos dois ids). Volta `roles/viewer`, a escrita
em `*.tflock`, o vínculo por nome de repositório e por `environment` sem ramo. O `environment: plano` do `infra.yml`
não atrapalha o bootstrap antigo (ele não confere environment para o plano). Se o problema for só um papel faltando no plano, prefira
acrescentar o papel a reverter.

## Camada 2: Terraform da raiz (`infra.yml` no merge em `main`)

Muda: `google_bigquery_dataset.dw` (acesso explícito), `removed` do `iam_member` da VM, CAA (se a zona é gerida) e
o `startup-script` da VM (metadado atualizado no lugar; o efeito vem no próximo boot).

Confira no plano do PR o que o README lista em "Dataset `tria_dw`" antes de aprovar. Depois do `apply`:
`bq show --format=prettyjson tria-platform:tria_dw` e a próxima coleta gravando.

Se o `apply` falhar ao criar o CAA com "already exists", há CAA criado à mão no mesmo nome: importe-o ou apague-o no
provedor antes de repetir.

**Reversão:** PR que reverte `bigquery.tf` e `dns.tf`. Atenção: sem o `access` no código, o Terraform não
devolve `projectReaders`/`projectWriters` sozinho (o campo fica computado). Para voltar ao estado anterior, o PR de
reversão declara as mesmas entradas que existiam (anotadas no passo 3 de "Antes de tudo") e recoloca o
`google_bigquery_dataset_iam_member.vm_editor` com um bloco `import` (`id = "projects/tria-platform/datasets/tria_dw roles/bigquery.dataEditor serviceAccount:<vm>"`).

## Camada 2b: criar a versão do segredo de borda ANTES do deploy (humano, ADR 0060)

O `infra.yml` cria só o recurso `tria-producao-proxy-secret` (sem versão). O valor é o que o Caddy envia ao app em
`X-Orla-Borda` para provar que o `x-forwarded-for` veio dele. Sem versão, o pre-flight do deploy barra
(`TRIA_PROXY_SECRET` é obrigatória em produção) e, se passasse, todo visitante dividiria o mesmo balde do limitador.
Faça depois do `apply` da `main` terminar (o recurso precisa existir) e antes de o pre-flight do deploy rodar; se o
deploy já falhou no pre-flight por isso, crie a versão e repita o `deploy.yml` do mesmo commit.

1. Criar a versão, por pipe, sem eco e sem gravar o valor em arquivo:

   ```sh
   openssl rand -hex 32 | gcloud secrets versions add tria-producao-proxy-secret --data-file=- --project=tria-platform
   ```

2. Verificar sem imprimir o valor:

   ```sh
   gcloud secrets versions list tria-producao-proxy-secret --project=tria-platform --filter='state=ENABLED' --format='value(name)' | wc -l
   gcloud secrets versions access latest --secret=tria-producao-proxy-secret --project=tria-platform | wc -c
   ```

   Esperado: ao menos 1 versão habilitada e 65 caracteres (64 hexadecimais mais a quebra de linha do `wc`).
   Depois do deploy, o `completar-env.sh` grava `TRIA_PROXY_SECRET` no `.env` da VM, e o log do app não pode trazer
   `proxy.segredo_de_borda_ausente`.
3. Rotação: criar nova versão e fazer um deploy (o `completar-env.sh` lê o Secret Manager `latest` primeiro e só usa o
   valor antigo do `.env` se o Secret Manager não responder, com aviso sem valor no log do deploy); app e Caddy sobem
   juntos, então não há janela com valores diferentes além do tempo de `compose up`. Nessa janela o IP cai no balde desconhecido
   (conservador), sem abrir o limite.

**Reversão:** desabilitar a versão (`gcloud secrets versions disable <n> --secret=tria-producao-proxy-secret`) não muda a
VM em execução; no próximo deploy o `completar-env.sh` não acha versão habilitada e cai no valor que já está no `.env`
(o da versão desabilitada). Para invalidar de fato um segredo vazado, crie a versão nova antes de desabilitar a antiga e
faça o deploy. Sem versão nenhuma, apague a linha `TRIA_PROXY_SECRET` do `.env` da VM antes: o app volta ao IP
desconhecido em produção (todos num balde só, com aviso limitado no log) e o pre-flight barra o próximo deploy; para voltar ao código anterior, reverter o PR (o Caddy anterior não envia o cabeçalho e o app
anterior ignora o segredo).

## Camada 3: deploy (`deploy.yml` no mesmo merge)

1. "Enviar configuração da pilha" leva `rede-transicao.sh`, `metadados-bloquear.sh` e `metadados-verificar.sh`.
2. "Redes da pilha e bloqueio de metadados": no primeiro deploy a `orla_interna` existe sem `internal`, então o
   script faz `compose down` (volumes intactos), instala o bloqueio e o drop-in do Docker e religa a versão atual.
   **Parada de toda a pilha por alguns segundos a um minuto**; execuções agendadas do n8n nessa janela não voltam.
   Nos deploys seguintes ele só reinstala o bloqueio.
3. Pre-flight, migrações e troca de versão como sempre.
4. "Smoke pós-deploy (metadados da VM só para o app)": reprova o deploy se o n8n ou o proxy alcançarem
   `169.254.169.254`, se o app não alcançar, ou se o n8n perder DNS.

Conferência manual opcional na VM (IAP): `sudo iptables -S ORLA-METADADOS`, `sudo iptables -S DOCKER-USER`,
`systemctl cat docker | grep orla-metadados`, `sudo docker network inspect orla_interna -f '{{.Internal}}'`.

Conferência manual do timer de vigia (na VM, depois do primeiro deploy e depois de reiniciar a VM):
`systemctl list-timers orla-metadados-vigiar.timer` (deve aparecer com próxima execução),
`sudo journalctl -u orla-metadados-vigiar --since "-1h"` (sem linha com `orla-metadados-bloqueio-ausente` em
condições normais), `sudo iptables -S DOCKER-USER | sed -n 2p` (a primeira regra deve ser `-A DOCKER-USER -j ORLA-METADADOS`)
e `sudo /usr/local/sbin/orla-metadados-bloquear vigiar; echo $?` (0 e sem saída). Uma linha com o marcador significa que
o bloqueio faltou: `resultado":"reinstalado"` foi corrigido pelo timer (investigue por que o boot falhou),
`"persistente"` ainda está aberto e o n8n alcança os metadados; reaplique à mão e investigue. Há alerta por e-mail para esse
marcador (ADR 0057, decisão 4): a linha também vai a `/var/log/orla/metadados-bloqueio.log`, que o Ops Agent envia ao
Cloud Logging com o `logName` `metadados_bloqueio`.

Confirmar que a linha chega ao Cloud Logging (uma vez, depois do primeiro deploy com o Ops Agent atualizado):
`sudo systemctl status google-cloud-ops-agent` (ativo, sem erro de config) e, na VM, grave uma linha de teste que a métrica
ignora: `echo '{"severity":"error","marker":"orla-metadados-bloqueio-ausente","resultado":"teste","message":"teste do envio de log"}' | sudo tee -a /var/log/orla/metadados-bloqueio.log`.
No Logs Explorer (projeto, escopo padrão) filtre `logName="projects/<projeto>/logs/metadados_bloqueio"` e espere
até 2 minutos: a linha deve aparecer com `jsonPayload.resultado="teste"` e severidade ERROR. Se o `logName` for outro,
ajuste o filtro da métrica e a documentação do alerta em `observabilidade.tf` (a premissa de que o `logName` é o id do receptor
vem do `containers_docker` e não está explícita na documentação do Ops Agent). A linha de teste não conta na métrica
`bloqueio-de-metadados` (só `reinstalado` e `persistente` contam), então não há falso alarme; não derrube o bloqueio real para
testar o alerta. O disparo do alerta em si só se observa quando houver ocorrência real; confira que a política existe
e está ligada ao canal de notificação (`terraform plan` sem diferença e a política listada em Monitoring, Alerting).
Depois do teste, esvazie o arquivo: `sudo truncate -s 0 /var/log/orla/metadados-bloqueio.log`.

Se o passo 2 falhar no meio, o deploy para antes do pre-flight. Rodar o deploy de novo retoma: com a rede já
recriada e a pilha parada, o script religa a versão do `.env`.

**Reversão das regras (sem tocar nas redes):** na VM, `sudo rm /etc/systemd/system/docker.service.d/orla-metadados.conf`,
`sudo systemctl disable --now orla-metadados-vigiar.timer`, `sudo rm /etc/systemd/system/orla-metadados-vigiar.{service,timer}`,
`sudo systemctl daemon-reload`, `sudo iptables -D DOCKER-USER -j ORLA-METADADOS`, `sudo iptables -F ORLA-METADADOS`,
`sudo iptables -X ORLA-METADADOS` (idem com `ip6tables`). O app segue funcionando, porque as redes novas não dependem
das regras; só o bloqueio some. O próximo deploy reinstala, então reverta também o código.

**Reversão das redes:** PR que volta o compose ao estado anterior **mantendo** `rede-transicao.sh` com
`INTERNA_DESEJADA=false` e o passo no `deploy.yml`; o deploy recria a rede uma vez no sentido inverso. Reverter o
PR inteiro (sem o passo de transição) deixa o `compose up -d postgres` do pre-flight diante de uma rede divergente e
para a pilha; nesse caso, antes do deploy, na VM: `cd /opt/tria && sudo docker compose -f docker-compose.prod.yml down`.

## Fora do código (humano)

- CAA no apex do domínio, se desejado, e CAA nos nomes do app e do n8n caso `DNS_ZONE_NAME` esteja vazio: no provedor de
  DNS, `0 issue "letsencrypt.org"`, `0 issue "sectigo.com"`, `0 issuewild ";"`.
- Se o `plan` falhar em `google_billing_budget`: `roles/billing.viewer` para `tria-terraform-plan` na conta de
  faturamento, por quem administra o faturamento.
- VM desligada ao fim (`scripts/vm-desligar.sh`).
