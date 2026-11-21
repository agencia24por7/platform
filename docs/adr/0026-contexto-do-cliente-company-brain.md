# 0026 — Contexto do cliente ("company brain")

- Status: aceito
- Data: 2026-11-20
- Relaciona: ADR 0001 (acesso e RLS), 0010 (LGPD), 0022 (exclusão lógica de cliente)

## Contexto

A agência precisa de um mapa de contexto por cliente (empresa, produtos, personas,
concorrência, marca, presença digital, performance, comercial, comunidade,
objetivos, restrições — seções A a K do briefing), preenchido aos poucos pela
equipe e pelo próprio cliente, com status epistêmico e fonte em cada informação.
No passo seguinte esse conteúdo vira contexto servido a agentes. Este ADR fixa a
base: modelo, segurança do formulário público, armazenamento e a exportação
derivada ("brain"). UI, indexação para agentes e pré-preenchimento por IA ficam
para depois.

## Decisão

### 1. Fonte da verdade: Postgres

Os dados estruturados ficam no Postgres (migração 0060), não em arquivos:

- `core.client_context_entries` — valor escalar por `(client_id, field_key)`,
  `jsonb`, com `epistemic`, `source`, `review`, `shareable` e `version`.
- `core.client_context_items` — item de lista (redes, produtos, personas,
  concorrentes, marcas, campanhas, depoimentos, datas…), id estável, `position`.
- `core.client_context_revisions` — histórico só de acréscimo (antes/depois,
  autor, link), escrito pelo gatilho `core.contexto_apos_mudanca`
  (`SECURITY DEFINER`); o app só tem `SELECT`.
- `core.client_context_files` — metadados dos arquivos; conteúdo no bucket.
- `core.client_context_links` — links públicos (hash do token).
- `core.client_context_brain` — estado da exportação (pendente, hash, erro).

Por quê: RLS com a mesma regra de "cliente visível" de toda tabela de cliente
(`organization_id`, recorte e `EXISTS` em `core.clients`, ADR 0022), trava
otimista por `version`, consultas de completude, rascunho/sugestão (`review`),
auditoria e histórico transacional. Arquivo não dá nada disso sem reinventar um
banco. Todas as tabelas têm `ON DELETE CASCADE` a partir de `core.clients`: o
expurgo (`core.expurgar_cliente`) leva o contexto junto sem ser alterado.

O catálogo de campos é código (`src/modules/clients/domain/contexto/catalogo.ts`,
`VERSAO_DO_CATALOGO`), não tabela: tipos, limites, nível
(`essencial`/`aprofundar`), visibilidade ao cliente e esquema dos itens mudam
com revisão de código e testes. `key` é snake_case e **nunca é renomeada**
(é a chave no banco e no brain); campo novo é aditivo, campo removido deixa de
ser exibido mas o dado fica. O banco valida só o formato das chaves, para não
amarrar uma migração a cada campo novo.

### 2. Status epistêmico, fonte e revisão

Cada valor e cada item carregam `epistemic` (`fato | hipotese | desejo`),
`source` (`cliente | equipe | pesquisa | ia`) e `review`
(`confirmado | sugerido`). Sugestão de IA entra sempre como `sugerido` +
`hipotese`, só em campo vazio, e não conta na completude nem entra no brain até
um humano confirmar (`confirmarSugestao`). O gancho é `aplicarSugestoes` e o
tipo `SugestorDeContexto`; a chamada à IA não existe ainda.

### 3. Armazenamento de arquivos: um bucket, um prefixo por cliente

Um único bucket (`infra/terraform/contexto.tf`, ADR 0027), com prefixo por
organização e cliente:

```
orgs/{orgId}/clientes/{clientId}/contexto/brain/...        (exportação derivada)
orgs/{orgId}/clientes/{clientId}/arquivos/{fileId}-{nome}  (uploads)
```

**Não** um bucket por cliente: criar bucket tem limite de taxa e é operação de
infraestrutura (Terraform, IAM, ciclo de vida, alertas) por cliente novo;
cotas de projeto e o custo operacional crescem linearmente; e o isolamento por
IAM de bucket não ajudaria, porque quem acessa é sempre a conta de serviço do
app. Prefixos escalam sem limite prático (o GCS não tem diretórios; listagem e
exclusão por prefixo são nativas). O isolamento por cliente é do app: os
caminhos só são montados por `prefixoDoCliente` (exige uuids), o
`CHECK client_context_files_no_prefixo` recusa metadado fora do prefixo do
próprio cliente, e expurgar é `deletePrefix(orgs/{org}/clientes/{cliente}/)`,
inclusive versões antigas quando o bucket tiver versionamento.

Revisitar quando: um cliente exigir chave própria (CMEK por cliente) ou
residência de dados diferente; o volume passar de dezenas de TB ou de milhões de
objetos por cliente; ou surgir acesso direto do cliente ao bucket (aí bucket ou
pasta gerenciada com IAM próprio).

Uma porta só para os serviços: `PortaDoArmazenamento`
(`src/modules/clients/application/portaDoArmazenamento.ts`; `put`, `get`,
`list`, `delete`, `deletePrefix`, `saudavel`, `configurado`, todas com
`Result`). O cliente GCS do ADR 0027 (`src/shared/storage`, que lança
`ArmazenamentoIndisponivelError`/`CaminhoInvalidoError`) é traduzido por um
adaptador fino (`infrastructure/armazenamentoAdaptado.ts`: exceção → `Result`,
paginação da listagem resolvida ali). Escolhemos traduzir na borda em vez de
espalhar `try/catch` pelos casos de uso: o serviço segue o padrão `Result` do
resto do app e o cliente GCS continua testado sozinho. `composition.ts` monta
`adaptarArmazenamento(criarArmazenamentoDeContexto(env()))`: GCS quando
`CONTEXT_BUCKET` existe, nulo caso contrário. Sem bucket o texto do contexto
funciona; anexos ficam indisponíveis, nada é agendado e o estado do brain diz
`situacao: 'desativado'`.

### 4. Política de arquivos

Fonte única: `src/shared/storage/politicaDeArquivos.ts` (ADR 0027: detecção
pelos bytes iniciais, `nomeSeguro`, cabeçalhos de download). O domínio
(`domain/contexto/arquivos.ts`, `avaliarAnexo`) só acrescenta a categoria que o
campo do catálogo aceita (`imagem`, `documento`, `planilha`, `video`, `fonte`).

- Aceitos: PNG, JPEG, WEBP, GIF, PDF, DOCX, TXT, CSV, XLSX, vídeo MP4/MOV
  (depoimentos, criativos) e fontes TTF/OTF/WOFF2 (marca).
- Recusados: SVG e HTML (executam script no navegador se servidos inline),
  executáveis e **ZIP**: o pacote pode conter qualquer coisa (executável, html,
  bomba de descompressão) que a checagem por bytes iniciais não enxerga, e
  nenhum indexador do brain lê o conteúdo. Pasta grande vai como link
  (`links_de_midia`). Isso reverte o zip que o ADR 0027 previa.
- O tipo vem dos bytes; extensão e tipo declarado só confirmam.
- 25 MB por arquivo; 500 MB por cliente (cota conferida sob trava por cliente
  no caminho público).
- O nome gravado é saneado (`nomeSeguro`); o id vem antes, então dois uploads
  com o mesmo nome nunca colidem.

### 5. Company brain: exportação derivada, texto primeiro

Depois de cada mudança (gatilho marca `requested_at`; o serviço agenda com
espera de 5 s por cliente, assíncrono), `publicarBrain` monta e grava em
`.../contexto/brain/`:

| Arquivo | Conteúdo |
|---|---|
| `perfil.md` | composto legível por humano e LLM: `##` por seção A–K, `###` por lista, `####` por item com `id`; cada linha traz `_(Fato · fonte: cliente)_` |
| `perfil.json` | o mesmo, tipado (`campos` e `listas` por seção) |
| `produtos.jsonl`, `personas.jsonl`, `concorrentes.jsonl`, `redes.jsonl`, `campanhas.jsonl` (+ `diferenciais`, `marcas-admiradas`, `canais-pagos`, `depoimentos`, `datas-chave`) | uma linha por item, `id` estável |
| `anexos.json` | metadados dos arquivos (sem conteúdo) |
| `manifest.json` | `schemaVersion`, `catalogoVersao`, `clientId`, `generatedAt`, `contentHash`, contagens, completude, sha256 de cada arquivo |

Só entra dado `confirmado`. O construtor (`construirBrain`) é puro e
determinístico: ordem estável, JSON com chaves ordenadas, e o `contentHash`
ignora `generatedAt`. Se o hash e a versão do esquema não mudaram, nada é
gravado (idempotente). Cada arquivo tem 3 tentativas com recuo; o
`manifest.json` vai por último, então manifest novo significa conjunto
completo. Falha fica em `client_context_brain.last_error` + `attempts`, no
evento `client.context.brain_failed` e no estado devolvido por `carregar`.
Disparo em três camadas:

1. **Na hora**: todo salvar/alterar/remover bem-sucedido agenda
   `publicarBrain` em memória, com espera de 5 s por cliente (rajada de
   autosave vira uma publicação), sem bloquear a resposta.
2. **Varredura**: `POST /api/v0/contexto/publicar-pendentes` (`workerRoute`,
   corpo `{ limite }`) chama `publicarPendentes`, que usa
   `core.contexto_brains_pendentes` (mudou depois da última tentativa, ou falhou
   e venceu o recuo crescente). O workflow
   `n8n/workflows/plataforma/contexto-brain-diario.json` chama a rota de hora em
   hora; cobre reinício do processo e falha do bucket.
3. **Reconstrução total**: `POST /api/v0/contexto/reconstruir`
   (`{ organizationId, clientId? }` ou `{ todos: true }`) regrava ignorando o
   hash; `scripts/contexto-reconstruir-brain.mjs --org --cliente | --todos`
   (token do Secret Manager, ou `--local`). Usar depois de mudar o formato do
   brain ou de restaurar o bucket.

Pensado para um indexador futuro (ex.: Vertex AI Search sobre o prefixo
`orgs/*/clientes/*/contexto/brain/`): ingere por prefixo, reindexa quando o
`contentHash` do manifest muda, e pedaços naturais são as seções do markdown e
as linhas do JSONL, sempre com id estável.

### 6. Formulário público por link

- Token de 256 bits (`randomBytes(32)`, base64url), mostrado **uma vez** na
  criação; o banco guarda só `sha256(token)` (`CHECK` de 64 hex). Vazamento do
  banco não permite montar a URL.
- Padrão de 30 dias, de 1 a 90; revogável; regenerar = revogar + criar com o
  mesmo recorte (novo token). Excluir o cliente revoga os links (gatilho em
  `core.clients`); restaurar não os revive.
- Escopo: um cliente e um subconjunto de seções. Sem sessão: tudo passa por
  funções `SECURITY DEFINER` com `search_path` fixo e `EXECUTE` só para o papel
  do app (`core.contexto_link_*`), e `core.contexto_link_valido` decide num
  lugar só (hash conhecido, não revogado, não vencido, cliente não excluído).
- O cliente vê só campos com `visivelAoCliente` no catálogo (o app manda a
  lista, o banco ainda limita às seções do link) e só valores visíveis
  (`shareable` marcado pela equipe e não hipótese nem sugestão, ou escritos por
  ele). Notas internas (`notas_internas_*`), hipóteses e outras seções nunca
  saem. Revisões não são expostas.
- Escrita pelo link grava `source = cliente`, `shareable = true`,
  `review = confirmado`. Autosave idempotente pela versão: o cliente manda a
  versão que leu (0 se não via valor); valor interno que ele não via é
  substituído e o anterior fica na revisão. Ele só remove item que ele mesmo
  criou.
- Limite de taxa em memória por credencial (120/min) e por IP (300/min). Num
  deploy com várias réplicas o limite é por réplica; aceitável para o volume
  atual, revisitar com Redis/Cloud Armor.
- Todo acesso é auditado (`client.context.link_opened`, `link_saved`,
  `link_file_attached`, `link_submitted`) com `actor_type = invite`, sem IP e
  sem valor no metadata — só seção, chave e resultado.

Relação com o convite de integração: um link pode ir sozinho ou amarrado a um
convite (`client_context_links.connection_invite_id`, no máximo um vivo por
convite). `core.contexto_link_pelo_convite(token do convite)` devolve o hash do
link amarrado (só circula no servidor), e o serviço aceita
`{ tipo: 'convite', token }` como credencial. A página do convite (próximo
passo de UI) mostra as duas tarefas: conectar contas e preencher o contexto.
O vínculo fica na tabela nova para não mexer em `connection_invites`.

### 7. LGPD

Contexto é dado de negócio, mas depoimentos, fotos, vídeos e anexos podem ter
dado pessoal. Retenção segue o cliente: exclusão lógica esconde (RLS) e revoga
links; o expurgo apaga as linhas por cascata e o serviço
`expurgarArmazenamento` apaga o prefixo do cliente no bucket. Personas são
arquétipos: catálogo traz `avisoDeDadoPessoal` em personas e depoimentos, e o
depoimento tem "quem aparece autorizou o uso?". Registro e retenção em
`docs/lgpd/` atualizados.

### Fora deste passo

- Indexação para agentes (RAG/vetor) e completude por agente.
- Chamada de IA para pré-preenchimento (só o gancho `sugerido`).
- Ligar o expurgo do bucket ao `scripts/titular.mjs` (outra frente está
  alterando o script). Ponto exato: em `expurgarCliente`, **depois** de
  `core.expurgar_cliente` confirmar, apagar
  `orgs/{org}/clientes/{cliente}/` com todas as versões. Pelo app é
  `modules().contexto.expurgarArmazenamento({ organizationId, clientId })`
  (`deletePrefix` da porta); do script, sem o app, é `deletePrefix` de
  `src/shared/storage` ou `gcloud storage rm -r --all-versions`. A organização
  precisa ser lida antes do expurgo, porque depois a linha do cliente não
  existe mais. Até lá, o expurgo apaga o Postgres e deixa os objetos.
- UI da página do cliente e do formulário público.

## Consequências

- Um campo novo é uma linha no catálogo; não precisa de migração.
- O cliente nunca vê o trabalho interno da equipe; em troca, a equipe precisa
  marcar como compartilhável o que quer que o cliente revise.
- O brain é cópia derivada: pode ser apagado e regenerado a qualquer momento a
  partir do Postgres.

## Como desfazer

O deploy aplica migrações automaticamente e só para frente. Para recuar:
remover o serviço `contexto` de `composition.ts` (nada mais depende dele) e,
se preciso, uma migração nova que faça `DROP` das tabelas
`core.client_context_*`, das funções `core.contexto_*` e do gatilho
`clients_revoga_links_de_contexto`. O prefixo `.../contexto/` do bucket pode
ser apagado sem efeito no resto.

## Adendo (2026-11-20)

Revisado pela ADR 0033 (revisão adversarial de contexto, brain e privacidade): reserva de cota antes do bucket, ordem de validação do envio, expurgo e despublicação do bucket, carência do YouTube, posse legada com renomeações, pimenta dedicada da Meta, limite de leitura por cliente e listas pessoais fora do perfil. Onde houver divergência, vale a 0033.
