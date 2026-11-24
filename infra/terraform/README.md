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
