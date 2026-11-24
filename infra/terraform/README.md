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
com `roles/viewer`.

## Logs na nuvem (opt-in) (ADR 0049, decisão 6)

Desligado por padrão no Terraform (`logs_na_nuvem_habilitado = false`); em produção é ligado pela variável do GitHub
`LOGS_NA_NUVEM_HABILITADO` (ADR 0051), que o `infra.yml` repassa ao `plan` e ao `apply`. Com a variável em `false` o `plan`
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

### Custos

- Verificado (Google Cloud Observability): ingestão de log US$ 0,50/GiB, primeiros 50 GiB por projeto por mês
  grátis; retenção além de 30 dias US$ 0,01/GiB/mês; consulta grátis.
- Não verificado, conferir na tabela vigente antes de ligar: preço da métrica baseada em log e da política de alerta
  (as fontes consultadas divergem). Não há estimativa nesta documentação.
- O volume real não foi medido. Meça o tamanho dos logs docker na VM antes de ligar, para comparar com os 50 GiB.

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
cliente, ele ficará 30 dias no `_Default`. A cópia na nuvem usa a retenção do bucket `_Default` (30 dias); esta
mudança não altera a retenção. A cópia local continua nos limites atuais (docker 10m x 3, journald 200M/1 mês).

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
2. Só então `logs_na_nuvem_habilitado = false` e aplicar pelo `infra.yml`: remove a métrica, a política e a exclusão do projeto.
3. Se a variável for desligada com o agente ainda vivo, ele continua enviando logs e a exclusão que descarta os
   containers fora da aplicação some do plano: os logs de Caddy, Postgres e n8n passam a ser guardados no `_Default`
   (30 dias, legível por `roles/viewer`) até o agente ser parado. Nesse caso pare o agente na VM imediatamente.
4. Os logs já enviados ficam no `_Default` até vencerem os 30 dias.
