# 0009 — Sincronização versionada dos workflows do n8n

- Status: aceito
- Data: 2026-11-20
- Issue: 24K-111

## Contexto

Os workflows vivem em `n8n/workflows/`, mas chegavam à instância de produção
por importação manual ou chamadas avulsas à API. Nada garantia que o que roda
é o que está no repositório, e uma mudança num modelo de coletor ou executor
não chegava às cópias já criadas por conexão.

Duas dificuldades impedem "empurrar o JSON":

- **Vínculos são da instância.** Credenciais, IDs de sub-workflow e o
  `webhookId` existem só no n8n de cada ambiente. No repositório há marcadores
  (`a-definir-pelo-provisioner`) ou IDs de produção.
- **O n8n normaliza o que recebe.** Ele remove parâmetros com valor padrão
  (`httpMethod: GET`) e acrescenta outros (`version`, `leftValue`). Comparar
  conteúdo acusa diferença para sempre.

## Decisão

`npm run n8n:sincronizar` (`scripts/n8n-sincronizar.mjs`, lógica em
`src/shared/n8n/sincronizacao.ts`):

- **Simula por padrão.** Só grava com `--aplicar`.
- **Repositório manda na lógica, instância manda nos vínculos.** Nós,
  parâmetros e ligações vêm do arquivo. Credencial, sub-workflow literal,
  `id` e `webhookId` de cada nó vêm do workflow implantado. Um nó novo herda a
  credencial do mesmo tipo já vinculada. Marcador que sobrar vira `bloqueado`
  e o workflow não é tocado.
- **Versão por nota de origem.** Cada workflow sincronizado recebe a nota
  "Origem no repositório" com o arquivo e o hash do modelo. A comparação é de
  hash: exata e idempotente. A nota também avisa quem abrir o editor que a
  alteração deve ir para o arquivo.
- **Só atualiza, não cria.** Workflow de plataforma ausente na instância
  aparece como `não implantado`. Implantar a primeira vez é decisão
  deliberada: `coleta-metricas.json` é o caminho v0, usado só no ambiente
  local, e não deve aparecer em produção sozinho.
- **Cópias por conexão.** Com `--conexoes <arquivo.json>` (lista de
  `{platform, coletorRef, executorRef}`), as cópias de coletor e executor
  recebem o modelo atual, mantendo o nome e a credencial da conexão. Elas são
  republicadas sempre, porque sub-workflow precisa estar publicado.

Uso em produção (VM ligada):

```bash
./scripts/tunel.sh n8n          # outro terminal; n8n em localhost:15678
gcloud compute ssh tria-producao-vm --zone us-central1-a --tunnel-through-iap --command \
  "sudo docker exec orla-postgres psql -U postgres -d tria -tAc \"select coalesce(json_agg(json_build_object('platform',platform,'coletorRef',coletor_ref,'executorRef',executor_ref)),'[]') from integrations.connections where status='active'\"" > conexoes.json
export N8N_API_URL=http://localhost:15678
export N8N_API_KEY="$(gcloud secrets versions access latest --secret=tria-producao-n8n-api-key --project tria-platform)"
npm run n8n:sincronizar -- --conexoes conexoes.json            # simulação
npm run n8n:sincronizar -- --conexoes conexoes.json --aplicar  # grava
```

## Consequências

- Primeira aplicação em produção (2026-11-20): 19 workflows atualizados, só
  com a nota de origem. Uma simulação anterior, comparando conteúdo, mostrou
  que a lógica já batia. A simulação seguinte deu 19 "igual". Backup prévio
  dos 19 via API; o webhook da Meta e as tarefas de conta seguiram respondendo.
- Cópia criada pelo app (autorização nova) nasce sem a nota e aparece como
  `atualizaria` na próxima simulação. Aplicar é seguro.
- Edição feita direto no editor do n8n não muda o hash e não é detectada. A
  regra é: o arquivo é a fonte; a nota no próprio workflow lembra disso.
- `tunnel_commands` do Terraform apontava para túneis IAP nas portas 5678 e
  5432 do host, que os contêineres não publicam. Agora aponta para
  `scripts/tunel.sh`, que encaminha por SSH até o IP do contêiner.

## Adendo (2026-11-20): o que é da plataforma

- Todo workflow da orla leva a tag **`platform`** no n8n: aplicada na criação (coletores e executores
  provisionados pelo app) e garantida pela sincronização.
- Fluxos feitos para clientes ou para a agência por fora da plataforma ficam em `n8n/workflows/clientes/` e
  `n8n/workflows/agencia/`. A sincronização **não os lê nem os altera**, e a plataforma nunca os usa.
  As tags `credaz` e `plataforma` (em português) são desses fluxos, não da orla.
- Correção de rumo: antes deste adendo a sincronização incluía esses fluxos e chegou a acrescentar neles a nota
  de origem e a desligar o salvamento de execuções (rodada de LGPD). Isso foi feito pela plataforma em fluxos
  que não são dela; reverter ou manter é decisão de quem os opera.

## Adendo (2026-11-20): vínculo por identificador, não por nome nem por tag

- Coletores e executores por conexão: pelo ID do workflow gravado na conexão (`coletor_ref`, `executor_ref`).
- Workflows da plataforma: pelo **arquivo de origem gravado na nota** do próprio workflow. Renomear no editor não
  quebra o vínculo. O nome serve só para **adotar** um workflow que ainda não tem nota; dois candidatos com o
  mesmo arquivo ou o mesmo nome param a sincronização em vez de escolher um.
- Tags são só identificação visual: nenhum código seleciona ou filtra workflows por tag.

## Adendo (ADR 0032, 2026-11-20): só workflows da plataforma, sem cópia por conexão

- Não existe mais cópia por conexão: `--conexoes` foi removido (o script recusa a opção e aponta para a ADR 0032).
  Os coletores (`n8n/workflows/coletores/`) e executores (`n8n/workflows/executores/`) viraram workflows da
  plataforma, genéricos por plataforma (`ORLA · {Plataforma} · coletor|executor`), sincronizados como os demais.
- Ordem de implantação: alertas da plataforma, genéricos, `coleta · backfill · janela`, demais. Quem chama um
  genérico (orquestrador, janela do backfill, tarefas de conta) declara o alvo como `origem:<arquivo>` dentro da
  expressão do `workflowId`; `resolverSubWorkflows` troca pelo id implantado com aquela nota de origem, no mesmo
  molde de `resolverFluxoDeErro`. Genérico ainda não implantado bloqueia quem o chama (rode de novo com `--criar`).
- Workflows por conexão do modelo antigo (`Coletor · ORLA · coletor · …`, `Executor · ORLA · tarefas · …`) são
  ignorados pela sincronização e removidos na limpeza de 2026-11-21 (script removido junto da 0123, ADR 0035).
- O item "Coletores e executores por conexão: pelo ID do workflow gravado na conexão" do adendo anterior não vale
  mais: `coletor_ref`/`executor_ref` estão zerados desde o corte (0121) e saíram com a migração 0123 (ADR 0035).

## Adendo (2026-11-24): fluxos de clientes e da agência aplicados no deploy

- Decisão de quem opera esses fluxos: o arquivo em `n8n/workflows/clientes/` e `n8n/workflows/agencia/` é a fonte, e
  ninguém edita esses fluxos pelo editor do n8n. Mudou o arquivo, abre PR; o merge na `main` aplica.
- Quem aplica é `scripts/n8n-aplicar-clientes.mjs`, separado da sincronização da plataforma (que continua sem ler
  essas pastas). O deploy copia as duas pastas e o script para `/opt/tria/n8n-clientes` e roda o script num
  `node:22-alpine` na rede `orla_interna`, contra `http://n8n:5678`, com a `N8N_API_KEY` do `.env` da VM.
- Vínculo pelo **nome exato** do workflow (esses fluxos não têm nota de origem). Nome ausente: o arquivo é ignorado
  com aviso, sem criar nada. Nome repetido ou credencial de exemplo (`a-definir…`): erro, o arquivo não é aplicado e
  o passo do deploy falha.
- Substituído pelo ADR 0053: o vínculo passa a ser pelo id, no manifesto `n8n/clientes-manifesto.json`
  (ver `docs/n8n-clientes-manifesto.md`); arquivo fora do manifesto é erro.
- Só atualiza o que difere (nós, conexões e configuração aceita pela API pública; posição e id dos nós não contam).
  Workflow ativo é reativado. `webhookId` gerado pelo n8n em nó que não é gatilho de webhook é preservado.
- A nota "Gerado pelo repositório" que a sincronização antiga deixou nesses fluxos sai na primeira aplicação: ela
  mandava rodar `npm run n8n:sincronizar`, o que não vale para eles.
- Simulação manual, sem gravar: `scripts/tunel.sh n8n` e
  `N8N_API_URL=http://localhost:15678 N8N_API_KEY=… node scripts/n8n-aplicar-clientes.mjs n8n/workflows`.

## Adendo (2026-11-28): sincronização da plataforma por script, sem chave na linha de comando

- A guarda do ambiente (ADR 0069 §2) nega ler o segredo direto no comando, o que travava o `export N8N_API_KEY=…`
  descrito acima. O caminho passa a ser `scripts/n8n-sincronizar-producao.sh`, que o ADR 0069 §1 prevê: script do
  projeto que lê o segredo sem eco.
- O script não tem alvo padrão (ADR 0028): exige `--projeto` e `--vm`, imprime o alvo e, sem `--aplicar`, só simula.
  Abre o túnel IAP, lê `<vm sem -vm>-n8n-api-key` para dentro do processo, passa a chave só ao `n8n:sincronizar` e
  fecha o túnel ao sair.
- O túnel escuta só em `127.0.0.1`, com `ExitOnForwardFailure`; o script recusa se a porta 15678 já estiver em uso
  (`lsof`), para a chave não ir a outro processo, e derruba o grupo de processos do túnel ao sair.
- `--ativar <id>` roda `scripts/n8n-ativar.mjs`, que aplica a mesma regra da sincronização (`avaliarAlvo`): recusa
  com código 3, sem mostrar nome nem credenciais, o que tiver `credaz`/`agencia` (ADR 0053) ou não tiver a tag
  `platform` nem nota de origem; com `--aplicar`, ativa só esse workflow.
- Continua manual: o deploy não sincroniza os fluxos da plataforma. Levar isso ao `deploy.yml` fica para decisão
  própria (raio de impacto em todo merge, ordem depois do smoke, política de ativação).
- Uso: `scripts/n8n-sincronizar-producao.sh --projeto tria-platform --vm tria-producao-vm --criar --aplicar`, duas
  vezes. Provas: `tests/scripts-sem-alvo-padrao.test.mjs` (sem alvo, opção inválida, sem chamar o gcloud) e
  `tests/n8n-ativar.test.mjs` (recusa de terceiros sem mostrar conteúdo e a chave nunca na saída).
