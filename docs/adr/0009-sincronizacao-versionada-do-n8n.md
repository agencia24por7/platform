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
