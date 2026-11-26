# 0030 — Company brain: catálogo de metadados por cliente, provedores plugáveis e governança

- Status: aceito
- Data: 2026-11-20
- Relaciona: ADR 0003 (gravação no BigQuery), 0013 (SCD2 e posse), 0015 (modelagem escalável), 0022 (exclusão lógica), 0025 (coleta incremental), 0026 (contexto do cliente), 0027 (armazenamento do contexto)

## Contexto

O cliente tem dados espalhados: conexões e recursos vinculados (Postgres), fatos e dimensões no
BigQuery (com dono pelas `vw_*`), o contexto preenchido no formulário (seções, listas, arquivos) e o
export desse contexto no bucket (`contexto/brain/*`, ADR 0026). O próximo passo do produto são agentes
que respondem sobre o cliente. Um agente precisa, antes de qualquer pergunta, saber **o que existe**,
**o que cada coisa responde**, **como buscar** com custo e filtro certos, **quão fresco e completo** está
e **o que ele não pode ver**. Sem isso o agente adivinha nomes de tabela, varre o dataset e mistura
clientes.

A decisão de produto: o company brain é um **índice com catálogo de metadados** de tudo o que o cliente
tem, mais uma **camada de governança** que diagnostica lacunas e diz o que fazer, servido de forma
organizada para o agente. O export do contexto já construído continua e vira **um provedor** do
catálogo. Agentes não entram aqui: entra o que eles vão consumir.

## Decisão

### 1. Modelo da entrada (`src/modules/brain/domain/entrada.ts`)

Uma entrada por coisa, validada por zod, com `schemaVersion` (hoje 1):

- `urn`: `orla:{orgId}:{clienteId}:{tipo}:{id}`. Estável: nunca reaproveitada nem renomeada. O id é o
  id natural da coisa (uuid da conexão/fonte/arquivo, nome da tabela-base, chave da seção/lista, id da
  capacidade). A URN carrega organização e cliente, então qualquer vazamento entre clientes é detectável
  por string.
- `tipo`: `conexao | fonte | tabela_de_dados | contexto_secao | contexto_lista | arquivo | capacidade`
  são os nativos, mas o tipo **não é enum travado**: o esquema só exige o formato, e o núcleo aceita os
  nativos mais os que os provedores registrados declaram em `tiposDeclarados`.
- `titulo`, `descricao` (pt-BR, uma ou duas frases escritas para um LLM: o que é e o que responde),
  `provedor`, `plataforma`, `referencia` (onde a coisa vive), `esquema` (colunas com tipo, significado,
  unidade, anulável), `grao`, `cobertura` (`desde`, `ate`, `linhas`, `diasComDado`, `diasEsperados`,
  `lacunas`, `diasFaltando`, `fonteDaMedida`, `medidoEm`), `frescor` (`ultimaAtualizacao`, `dadoAte`,
  `esperadoAte`, `cadenciaEsperada`, `status`), `qualidade` (`completude` 0–1, `avisos`), `acesso`,
  `sensibilidade`, `epistemico`, `valorResumido`, `tags`, `relacoes`, `versao` e `hash`.
- `acesso` diz **como** o agente busca: BigQuery (`objeto` = a `vw_*`, `filtros: {cliente_atual_id}`,
  coluna de data/partição, colunas, exemplos de consulta parametrizados com filtro de dono, filtro de
  partição e `LIMIT`, custo máximo por consulta), contexto (caminho no bucket + seção + chaves), arquivo
  (caminho, mime, tamanho), `status` (conexão/fonte: só estado, nunca credencial), `derivado`
  (capacidade), `externo` e `restrito`.
- `hash`: sha256 do conteúdo canônico (JSON com chaves ordenadas, tags e relações ordenadas e
  deduplicadas). Um indexador futuro reindexa só o que mudou.

**Só metadado.** Nunca linha de dado, token, credencial, e-mail da conta nem dado pessoal (listas de
contato, leads). O núcleo descarta, na validação, qualquer entrada cujo título, descrição, resumo ou
acesso case com padrão de e-mail, telefone, CPF, JWT, bearer, token de plataforma ou chave de segredo
(`domain/privacidade.ts`), e o provedor fica `degradado`. Do contexto, só entra resumo de valor de
**opção do catálogo** confirmada (seleção, múltipla, booleano, escala, número, dinheiro); texto livre,
"outro" digitado e itens de lista nunca entram: o agente segue o ponteiro para o export do contexto.

### 2. Provedores plugáveis (`domain/provedor.ts`, `infrastructure/provedores/`)

`ProvedorDeCatalogo` = `{ id, versao, descricao, fase, tiposDeclarados, descobrir(ctx), saude(ctx) }`.
O registro é `infrastructure/provedores/index.ts`: uma fonte nova é **um arquivo e uma linha**. O
contexto de descoberta entrega o inventário do cliente já carregado (uma passada no Postgres), o
contexto (pela porta), o relógio, o dataset e o teto de bytes, e `urn(tipo, id)`. Fases: `primaria`
roda em paralelo; `derivada` (capacidades) roda depois, sobre as primárias.

O núcleo (`application/construirCatalogo.ts`) é defensivo: provedor que lança fica `indisponivel` sem
derrubar o catálogo; entrada fora do esquema, de outro cliente/organização, com URN que não bate com
tipo e id, de tipo não declarado ou com padrão de dado pessoal é descartada e conta em `descartadas`;
URN repetida fica com a primeira; relação para URN inexistente é cortada. Tudo é ordenado por URN, então
a saída é determinística (mesmo inventário em outra ordem = mesmo hash).

Provedores de agora:

- `conexoes`: conexões que têm recurso vinculado ao cliente (plataforma, rótulo, status, expiração) e
  uma entrada por fonte vinculada (conta de anúncio ou recurso), com frescor e cobertura das coletas e
  relação com as tabelas que ela alimenta. Não lê `credential_ref`, `account_email` nem `webhook_token`
  (teste confere o SQL).
- `dados`: **declarativo**. Uma entrada por tabela do registro da coleta
  (`coleta/infrastructure/tabelas`) cuja plataforma o cliente tem vinculada; `fato_ads_diario` vira uma
  entrada só com as duas plataformas. Grão = chave do MERGE; colunas = tipos do registro + colunas da
  view (dono) + validade SCD2. O texto para o LLM vem de `dados/descricoes.ts` (título, descrição, view,
  coluna de data, relacionadas, sensibilidade) e `dados/glossario.ts` (significado, unidade e agregação
  de cada coluna; só colunas aditivas entram no `SUM` do exemplo). `dados.test.ts` falha se uma tabela
  do registro não tiver descrição, se uma coluna não tiver significado, se a view declarada não ler a
  tabela no DDL, se a coluna de data divergir do manifesto ou se uma entidade do manifesto faltar nas
  relacionadas. Conector novo no registro aparece sozinho no catálogo.
- `contexto`: seções e listas do formulário, com completude, marcação epistêmica agregada (fato,
  hipótese, desejo ou misto; fonte; revisão; sugestões pendentes) e ponteiro para `contexto/brain/`.
  Lista com aviso de dado pessoal sai `restrito`.
- `arquivos`: metadados dos anexos (nome higienizado, mime, tamanho, seção, prefixo do sha256), sem
  conteúdo.
- `conhecimento` (ADR 0065 §2): lentes de estratégia, práticas, regras legais e benchmarks lidos de
  `core.knowledge_entries` (tabela global, imutável, carga por migração; última versão ativa por `key`),
  projetados em todo cliente nos tipos `conhecimento_lente|pratica|regra_legal|benchmark`, só jurisdição
  `global` e `br`. Id `{key}-v{version}`. O campo opcional `evidencia` da entrada (categoria, nota A a D, fonte,
  mercado, jurisdição, datas, obrigatória, maturidade, replicada) existe só nelas: o hash das demais não muda
  (teste `domain/evidencia.test.ts`). Entrada vencida aparece marcada (`frescor` parado, tag `vencida`, aviso).
  Sempre conteúdo não confiável; nota A e B é `fato`, C e D é `hipotese`. Falha de leitura deixa o provedor
  `indisponivel`.
- `desempenho` (ADR 0065 §2): resumos de meses fechados lidos de `core.client_brain_performance`, nos tipos
  `desempenho_mensal` (`{platform}-{yyyy-mm}`), `desempenho_campanhas` e `desempenho_recorte`. A medição
  (`MedidorDeDesempenho`, `desempenhoBigQuery.ts`, SQL em `sqlDoDesempenho.ts`) roda no mesmo acionamento de
  `POST /api/v0/brain/cobertura/medir`, como passo isolado: 6 meses fechados de total por plataforma, 10
  maiores campanhas e 8 maiores fatias por recorte nos 3 últimos meses fechados (`periodo` = primeiro mês da
  janela), sempre com filtro de organização e de `cliente_atual_id`. Cliente sem linhas: nenhuma entrada e
  provedor `ok`.
- `capacidades`: derivado, ver 3.

**Contexto sem bloquear o PR do contexto.** O contexto entra por uma porta pequena,
`CarregadorDeContexto` (`domain/contexto.ts`), cujo formato é o subconjunto estrutural do
`ContextoCompleto` do serviço de contexto (ADR 0026). Antes do serviço de contexto entrar, o composition passava
`CARREGADOR_DE_CONTEXTO_INDISPONIVEL`: os provedores `contexto` e `arquivos` respondem `indisponivel`, as
capacidades que pedem contexto saem `indisponivel` com o motivo, e o resto funciona. Sem carregador (testes, outro ambiente) segue igual. **Ligado**
desde a integração com o serviço de contexto: em `src/composition.ts`,
`brain: criarBrain(audit, contexto)` (o adaptador `carregadorDoServicoDeContexto` aceita qualquer objeto
com `carregar(escopo) → Result<ContextoParaCatalogo>`). Falha ao carregar o contexto vira `null`,
nunca erro do catálogo.

### 3. Governança (`domain/diagnostico.ts`, `domain/capacidades.ts`, `dados/capacidades.ts`)

Funções puras, testadas com fixture rico:

- **Conectores**: cada plataforma do mapa de fontes vira `conectado`, `precisa_reautorizar` (conexão
  `reauth_pending`, `revoked` ou `degraded`), `conexao_sem_vinculo` (a organização tem a conexão, o
  cliente não tem recurso), `nao_conectado` ou `fora_da_coleta`, com as capacidades que ela desbloqueia.
- **Frescor** por fonte e tabela: `esperadoAte = hoje (São Paulo) − atrasoDias` do mapa de fontes;
  `fresco` com até 1 dia de folga (a incremental roda uma vez por dia), `atrasado` até 7, `parado`
  depois; também cai para `atrasado`/`parado` se a última coleta concluída tem mais de 48 h/7 dias;
  `desconhecido` sem coleta.
- **Cobertura e lacunas**: união das janelas `success` (incremental/completa, 400 dias) entre a primeira
  data e o esperado; dias faltando e até 20 intervalos. Falhas recentes (14 dias) por `error_code`,
  parciais, avisos e faltantes de `qualidade_resumo`.
- **Contexto**: completude por seção (essenciais faltando), sugestões pendentes, hipótese em campo
  essencial e **marcação divergente**: itens de uma lista com o mesmo título (normalizado) marcados com
  marcas epistêmicas diferentes. A descrição da divergência não leva o título (pode ser nome).
- **Ações** ordenadas por impacto: reautorizar (100), coleta parada (80), vincular recurso (70+),
  conectar plataforma que desbloqueia capacidades (50+), coleta atrasada (55), recuperar lacuna (40+),
  preencher essenciais (35+), divergência (33), confirmar sugestões (30).
- **Capacidades** são **dados**, não código: `{ id, titulo, descricao, perguntas, requisitos, tags }`,
  com requisitos `tabela_com_dado` (alguma das tabelas com dado nos últimos N dias), `plataforma_vinculada`,
  `contexto_secao` (completude mínima) e `algum` (ou). Resultado `disponivel | parcial | indisponivel`
  com `evidencias` (URNs) e `faltando`. Capacidade nova = uma entrada em `dados/capacidades.ts`;
  `validarDefinicoes` (teste) recusa tabela desconhecida, id repetido ou limiar fora de (0, 1].

### 4. Cobertura medida: barata por padrão, exata uma vez por dia

Padrão: derivada de `automation.coletas` (`fonteDaMedida: 'coletas'`), sem custo. Exata: a tabela
`gov_cobertura_cliente` no BigQuery (`scripts/bq/29_brain.sql`), preenchida por
`POST /api/v0/brain/cobertura/medir` (workflow `plataforma/brain-cobertura-diaria`): por cliente ativo
com fonte vinculada e medido há mais de 20 h, **uma** consulta `UNION ALL` sobre as `vw_*` das
plataformas dele, filtrada por `cliente_atual_id` e pela coluna de partição (400 dias), com
`maximumBytesBilled`, e MERGE pela chave (organização, cliente, tabela). A mesma medida é copiada em
`core.client_brain_coverage` (Postgres), que é o que o catálogo lê: montar o catálogo nunca consulta o
BigQuery. A medida vale 36 h; depois disso o catálogo volta para as coletas.

`gov_cobertura_cliente` tem `client_id` (não `cliente_id`) de propósito: é o nome que o expurgo usa para
descobrir as tabelas a apagar por cliente (`INFORMATION_SCHEMA`, como `gov_paridade` e `qc_execucoes`).
Ela não entra no manifesto de fatos (não tem chave de fonte) e entrou em `OPERACIONAIS` do
`bq:verificar`. Cliente excluído some das `vw_*` e não é medido.

### 5. Publicação: sob demanda + foto determinística no bucket

O catálogo é montado sob demanda (6 consultas fixas de inventário ao Postgres numa transação de tenant, mais a do conhecimento global em paralelo e o
registro estático; teste confere a contagem com centenas de fontes) e publicado pela mesma porta de
armazenamento do contexto (ADR 0027, `criarArmazenamentoDeContexto`; sem bucket configurado a
publicação devolve `sem_armazenamento` e nada falha):

```
orgs/{org}/clientes/{cliente}/brain/catalogo.json      índice máquina (entradas já filtradas pela política)
orgs/{org}/clientes/{cliente}/brain/catalogo.md        entrada humana/LLM estilo llms.txt, por tipo, com URN,
                                                       resumo do diagnóstico, capacidades e lacunas
orgs/{org}/clientes/{cliente}/brain/capacidades.json
orgs/{org}/clientes/{cliente}/brain/diagnostico.json
orgs/{org}/clientes/{cliente}/brain/entradas/{tipo}--{id}.json
orgs/{org}/clientes/{cliente}/brain/manifest.json      schemaVersion, generatedAt, catalogHash, hash por entrada,
                                                       contagens, provedores e versões, status, ponteiro para contexto/brain/
```

O `catalogHash` cobre entradas (URN + hash), capacidades e diagnóstico, nunca o `generatedAt`. Publica
só se o hash mudou (idempotente); o manifesto é escrito por último (quem lê o manifesto vê um conjunto
completo); entradas que saíram do catálogo são apagadas. O export `contexto/brain/` não é tocado: o
manifesto aponta para ele.

Estado em `core.client_brain_catalog_state` (migração 0100, RLS no molde das tabelas que pendem do
cliente, `ON DELETE CASCADE` de `core.clients`): pendente, motivo, último hash, quando publicou, última
tentativa, último erro, tentativas. Gatilho: a varredura `POST /api/v0/brain/publicar-pendentes`
(workflow `plataforma/brain-catalogo-publicar`, de hora em hora) publica clientes sem publicação, com
pedido pendente, com coleta concluída depois da última publicação ou publicados há mais de 20 h, com
recuo exponencial depois de falha (5 min a 12 h). A porta de evento é `brain.marcarPendente(cliente,
motivo)` (só marca; a varredura publica): o PR do contexto chama essa porta quando o contexto muda, em
vez de duplicar o gatilho. A medição de cobertura já marca pendente. Cliente excluído com catálogo
publicado tem o prefixo `brain/` apagado e o estado fechado (`core.brain_marcar_despublicado`).

### 6. API para agentes (`app/api/v0/brain/`)

- `GET /api/v0/brain/clientes/{clienteId}/catalogo?tipo&tag&provedor&plataforma&sensibilidade&q&limite&cursor`
- `GET /api/v0/brain/clientes/{clienteId}/entradas/{urn}` (URN codificada na URL)
- `GET /api/v0/brain/clientes/{clienteId}/capacidades`
- `GET /api/v0/brain/clientes/{clienteId}/diagnostico`
- `GET /api/v0/brain/clientes/{clienteId}/manifest`
- `POST /api/v0/brain/publicar-pendentes` e `POST /api/v0/brain/cobertura/medir` (worker)

Autenticação de worker (`workerQueryRoute`, o mesmo `TRIA_WORKER_TOKEN`), limite próprio de 60 leituras
por minuto por credencial, contratos zod em `src/shared/config/contracts.ts`. A organização sai do
cliente por `core.brain_resolver_cliente` (SECURITY DEFINER, molde de `resolve_coleta_fonte`); cliente
inexistente, excluído ou de organização arquivada responde 404; entrada de URN de outro cliente
responde 404. Respostas têm `schemaVersion` e `ETag`; `If-None-Match` igual responde 304. Paginação por
cursor (URN da última entrada, base64url), ordem estável por URN. Política de uso: `negado` é omitido
(e as relações para ele cortadas), `restrito` sai só com metadados (`acesso: restrito`, sem
`valorResumido`). Cada leitura grava `brain.consulta` na auditoria só com contagens (rota, devolvidas,
total, omitidas, restritas), nunca o conteúdo.

**Identidade por agente (próximo passo).** Hoje quem chama é o worker, com acesso a toda organização.
Quando os agentes existirem, cada um terá credencial própria com escopo (organização, clientes, níveis de
sensibilidade e tipos permitidos); a política passa a receber esse escopo em vez de usar só
`usoPorAgente`, e a auditoria registra o agente em `actorId`. O contrato das respostas não muda.

## Como adicionar

- **Uma tabela ou conector do BigQuery**: o roteiro do `scripts/bq/README.md` (registro, DDL, manifesto)
  e, para o catálogo, a descrição em `dados/descricoes.ts` e o significado das colunas novas em
  `dados/glossario.ts`. Nada no núcleo nem nos provedores muda.
- **Uma pergunta nova que os dados respondem**: uma entrada em `dados/capacidades.ts`.
- **Um tipo novo de contexto** (seção ou lista no catálogo do formulário): sai sozinho pelo provedor de
  contexto.
- **Conhecimento global novo** (lente, prática, regra legal, benchmark): `INSERT` em
  `core.knowledge_entries` por migração (versão nova é linha nova); regra legal só é `obrigatoria` com
  `verificado_em` preenchido. Nada no código muda.
- **Uma fonte que não está no registro** (planilha, CRM próprio, outro sistema): um arquivo em
  `infrastructure/provedores/` implementando `ProvedorDeCatalogo` com os `tiposDeclarados` novos e uma
  linha em `provedores/index.ts`. O `contrato.test.ts` roda a mesma bateria em todo provedor
  registrado (esquema, URN do próprio cliente, tipo declarado, URNs únicas, determinismo, sem dado
  pessoal) e `provedores/exemplo.ts` mostra o mínimo.

## Alternativas consideradas

- **Catálogo só no bucket, gerado por job**: barato de servir, mas sempre atrasado e sem filtro de
  política por chamador. Ficou o sob demanda (rápido, só Postgres) com a foto no bucket para quem lê
  arquivo.
- **Medir cobertura no BigQuery a cada leitura**: exato, mas custo e latência por chamada de agente.
  Ficou o padrão por coletas e a medida diária copiada no Postgres.
- **Enum fechado de tipos**: simples, mas cada fonte nova mexeria no núcleo. Ficou formato validado e
  tipos declarados pelos provedores.
- **Descrição de coluna por tabela**: ~1.000 textos repetidos. Ficou glossário por nome de coluna com
  sobrescrita por tabela, conferido por teste.
- **Embutir valores do contexto**: útil para o agente, mas viola o "só metadado" e espalha dado pessoal.
  Ficou ponteiro para o export do contexto, com resumo só de opções do catálogo.
- **Ler o serviço de contexto direto**: acopla ao PR que ainda não entrou. Ficou a porta estrutural.

## Consequências e riscos

- O catálogo depende do formato do `ContextoCompleto` (ADR 0026) por estrutura; se o serviço mudar o
  formato, o adaptador é o único lugar a ajustar.
- `fresco/atrasado/parado` assume a incremental diária; fonte com cadência própria precisa de
  `cadenciaEsperada` no mapa de fontes.
- A cobertura por coletas mede janelas pedidas e concluídas, não linhas: um dia sem dado na plataforma
  conta como coberto. A medida do BigQuery corrige uma vez por dia.
- O expurgo do cliente apaga as linhas do Postgres em cascata e `gov_cobertura_cliente` por
  `client_id`; o prefixo `brain/` cai junto com o prefixo do cliente no bucket ou pela varredura
  (cliente excluído).
- As cinco funções `core.brain_*` (SECURITY DEFINER, atravessam inquilinos) dão `EXECUTE` só ao
  `orla_worker` (ADR 0028): as rotas `/api/v0/brain/*` passam pelo `workerRoute`/`workerQueryRoute` e
  usam o pool do worker; as tabelas novas ficam no papel do app, que o worker herda.
- As leituras usam `workerQueryRoute` (fronteira do worker) e a camada `rotaDeLeitura` só acrescenta
  parâmetros de caminho e o `ETag`/304 por fora.

## Rollback

Desligar os dois workflows `plataforma/brain-*` para a publicação e a medição. As rotas novas são
somente leitura e podem ficar. Para desfazer de vez: remover as rotas e o módulo, `DROP FUNCTION` das
cinco `core.brain_*`, `DROP TABLE core.client_brain_catalog_state, core.client_brain_coverage`, `DROP
TABLE gov_cobertura_cliente` no BigQuery e apagar `orgs/*/clientes/*/brain/` do bucket. Nada disso
toca as tabelas de coleta, o contexto ou o export `contexto/brain/`.

## Adendo (2026-11-20)

Revisado pela ADR 0033 (revisão adversarial de contexto, brain e privacidade): reserva de cota antes do bucket, ordem de validação do envio, expurgo e despublicação do bucket, carência do YouTube, posse legada com renomeações, pimenta dedicada da Meta, limite de leitura por cliente e listas pessoais fora do perfil. Onde houver divergência, vale a 0033.
