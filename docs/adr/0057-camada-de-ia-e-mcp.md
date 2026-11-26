---
status: accepted
date: 2026-11-25
---
# ADR-0057: Camada de IA atrás de porta própria, registro único de ferramentas e servidor MCP com credencial de agente

Complementa os ADRs 0005, 0011, 0030, 0032, 0041, 0045, 0049, 0051 e 0056. Cumpre o "próximo passo" do ADR 0030 §6 (identidade por agente). Não supera nenhum. Issue 24K-131. Aceito em 2026-11-25 pelo dono do produto, com a instrução de escolher a opção mais segura em cada decisão aberta.

## Contexto

O produto vai ter agentes em vários módulos (Estratégia, Comitê, execução). Em 2026-11-25 não havia nenhuma chamada a modelo de linguagem, nenhum SDK de IA e nenhum módulo consumidor: o de Estratégia ainda é só o ADR 0056. O Brain já expõe leitura para agentes em `app/api/v0/brain/`, autenticada por `TRIA_WORKER_TOKEN`, que alcança todas as organizações.

Três forças guiam a decisão:

- **Isolamento primeiro.** Nenhuma credencial entregue a um agente pode alcançar mais de uma organização.
- **Sem amarra.** Modelo e fornecedor mudam a cada trimestre; a biblioteca de IA mudou de versão maior três vezes em cerca de 18 meses.
- **Simples de manter.** Uma VM, um processo Node, Postgres. Nada de serviço novo sem necessidade provada.

## Decisão

### 1. Porta própria: nenhum módulo conhece fornecedor

O módulo `src/modules/ia` é o único caminho para modelo de linguagem. Os consumidores chamam `modules().ia` com uma **tarefa**, uma entrada e um esquema zod de saída. Só `src/modules/ia/infrastructure` importa `ai`, `@ai-sdk/*` ou `@modelcontextprotocol/*`; um teste de fronteira (molde de `src/shared/db/fronteiraDoWorker.test.ts`) falha se outro arquivo importar.

O contrato expõe só o que todo fornecedor faz: texto, saída estruturada por esquema e chamada de ferramenta. Recurso exclusivo de um fornecedor (ferramenta hospedada, cache explícito, raciocínio estendido) é otimização interna do adaptador e nunca aparece no contrato.

### 2. Tarefa, classe de capacidade e modelo

- O código nunca tem id de modelo. Cada tarefa declara uma **classe de capacidade** (`raciocinio_forte`, `rapido_e_barato`) e um orçamento (passos, tokens de saída, tempo).
- A organização escolhe fornecedor e modelo por tarefa em `/config`. A lista de modelos vem da API do fornecedor com a chave dela.
- Modelo descontinuado ou sem acesso marca a configuração como inválida. A plataforma não troca de modelo sozinha e não tem troca automática de fornecedor.
- Sem chave conectada a tarefa fica bloqueada, com aviso do que falta. Não existe chave da plataforma.
- Só `admin` ou superior conecta chave e escolhe modelo. A chave é da organização, nunca do cliente.

### 3. Biblioteca: AI SDK 7, sem framework de agente

`ai` 7.x com os pacotes `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/xai` e `@ai-sdk/moonshotai`. Fornecedor novo compatível com OpenAI entra por `@ai-sdk/openai-compatible`. Testar chave e listar modelos usa um cliente HTTP pequeno por fornecedor, porque a biblioteca não lista modelos.

Provado por execução em 2026-11-25 (`ai` 7.0.182, zod 4.6.7, Node do projeto): `generateText` com `Output.object({ schema })` devolve o objeto validado e o uso de tokens; os cinco `create*({ apiKey })` constroem modelo sem variável de ambiente; `MockLanguageModelV4` de `ai/test` serve de fornecedor falso; `npm audit` sem vulnerabilidade.

Provado com fornecedor real em 2026-11-25 (Google, pedido trivial sem dado de cliente): a lista de modelos vem da API com a chave (`GET /v1beta/models`, cabeçalho `x-goog-api-key`); saída estruturada por esquema e laço com uma ferramenta funcionam pelo mesmo contrato. **Chave inválida no Google responde 400, não 401**: o testador de chave tem mapeamento de erro por fornecedor e nunca assume 401.

**Moonshot e xAI ficam desligados por padrão** (ADR 0058 §7). Só aparecem quando listados em `IA_FORNECEDORES_HABILITADOS`. Ligá-lo é decisão do humano, depois do aceite legal sobre transferência internacional de dados (LGPD).

### 4. Registro único de ferramentas

Uma ferramenta é declarada uma vez, no módulo dono do dado: nome, descrição fixa, esquema zod de entrada, classe (`leitura`, `reversivel_dentro_do_teto`, `irreversivel_ou_gasto_novo`, as do ADR 0056 §6) e um executor que recebe o **escopo do agente**. O mesmo registro alimenta o agente interno e o servidor MCP, então os dois nunca divergem.

- A v1 só registra ferramentas de classe `leitura`. O registro recusa as outras classes até existir o caminho do ADR 0056 §6.
- Descrição de ferramenta é texto fixo do repositório, nunca montado com dado de cliente.
- Primeira ferramenta: `brain_consultar_catalogo`, que devolve a mesma página de `GET /api/v0/brain/clientes/{id}/catalogo`, com a mesma política de uso (`negado` omitido, `restrito` só metadados). O contexto do cliente entra na **visão do cliente** (`montarNaOrganizacao` com o papel leitor, ADR 0062): a credencial de agente sai da plataforma para um cliente MCP de terceiro, então não recebe nota interna, hipótese nem valor não compartilhável. As rotas do worker continuam na visão da equipe. Abrir a visão da equipe a um agente pede decisão nova, com escopo próprio na credencial.

### 5. Credencial de agente por organização

O servidor MCP **nunca aceita `TRIA_WORKER_TOKEN`**. Cada agente tem credencial própria:

- Pertence a uma organização. Escopo: lista de clientes (ou todos da organização) e ferramentas permitidas. A política de uso do Brain (`negado` omitido, `restrito` só metadados) vale igual para toda credencial; teto de sensibilidade por credencial fica para quando houver um segundo perfil de agente.
- O segredo tem 32 bytes aleatórios, prefixo próprio `orla_ag_` e aparece uma vez, na criação, na resposta da ação do formulário, nunca em URL. O banco guarda só o SHA-256 (`core.agent_credentials.token_hash`); a busca é pelo hash, então não há comparação de segredo em claro.
- Validade obrigatória, com teto de 90 dias imposto por `CHECK` no banco. Revogável a qualquer momento. Só `admin` ou superior cria e revoga, em `/config/agentes`. No máximo 20 credenciais ativas por organização. O app só tem `UPDATE` na coluna `revoked_at`, com política que exige o valor preenchido (revogar não tem volta), `INSERT` só nas colunas de conteúdo (não escolhe `id`, `created_at` nem `last_used_at`, então não fabrica validade longa) e não tem `DELETE`. O teto é contado e inserido na mesma transação, sob trava por organização.
- A resolução sem sessão é a função `core.agente_resolver(p_token_hash)`, `SECURITY DEFINER`, na categoria "prova de segredo" do ADR 0045 (molde de `core.contexto_link_abrir`), incluída na allowlist `tests/apoio/funcoesDefinerDoApp.mjs`. Credencial revogada, vencida ou de organização arquivada não resolve.
- Depois de resolvida a credencial, a ferramenta roda como entrada pública (`comoPublico`) com `withTenant` na organização da credencial, nunca com o papel do worker: a RLS isola por organização. A lista de clientes da credencial é conferida no código (`brainService.catalogoDoAgente`), antes de tocar o banco, e o cliente precisa estar vivo naquela organização; um id de outra organização na lista não abre nada. Cliente fora do escopo, excluído ou inexistente responde igual, como não encontrado.
- A auditoria registra o agente como ator (`actorType: 'agent'`, `actorId` = id da credencial) e só contagens, nunca conteúdo.

OAuth 2.1 para clientes MCP externos fica fora da v1; entra por ADR novo quando houver cliente externo.

### 6. Servidor MCP

`@modelcontextprotocol/server` 2.x em `app/api/mcp/route.ts`, com `createMcpHandler(factory).fetch(request, { authInfo })`.

Provado por execução em 2026-11-25 (versão 2.4.0): o handler recebe `Request` e devolve `Response` do padrão web, sem adaptador; a fábrica roda por requisição e recebe a identidade já validada, então cada resposta só enxerga o escopo de quem chamou; entrada fora do esquema volta como erro de ferramenta sem executar; `GET` responde 405; o mesmo handler atende a spec 2026-07-28 e clientes da geração 2025 sem sessão.

A rota só existe com `IA_MCP_HABILITADO=true`; o padrão é desligada e responde 404. Ligada, nesta ordem: recusa `Origin` de navegador diferente da origem do app, recusa corpo declarado acima de 64 KiB, aplica limite de taxa por endereço de origem (domínio `ip` do limitador; o endereço vem de `enderecoDoCliente`, que só aceita o `x-forwarded-for` com a prova do proxy, e sem prova todos dividem o balde `desconhecida`), exige `Authorization: Bearer`, resolve a credencial, aplica limite de taxa por credencial (`IA_MCP_CHAMADAS_POR_MINUTO`, padrão 60; domínio `ia` do limitador, que só recebe chave depois de autenticação: credencial de agente validada pelo banco ou organização da sessão, teto de 10.000 baldes; o limite por origem é de 120 por minuto, então um valor acima de 120 só tem efeito para credenciais usadas de endereços diferentes, e credenciais atrás do mesmo endereço de saída dividem os 120), lê o corpo com teto e só aceita **uma mensagem JSON-RPC por pedido, de um método da lista** (`initialize`, `notifications/initialized`, `ping`, `server/discover`, `tools/list`, `tools/call`). Lote é recusado com 400: o transporte aceitaria até 100 mensagens num pedido só, o que furaria o limite por credencial. `subscriptions/listen` fica fora da lista, porque abre fluxo longo que sobreviveria à revogação. Só então entrega ao handler. Falha de autenticação responde 401 igual para credencial ausente, inventada, revogada ou do worker. `Host` não é validado: a defesa contra DNS rebinding é para servidor sem autenticação, e aqui toda chamada exige o segredo de 256 bits.

A rota entra em `ROTAS_ABERTAS` do `proxy.ts` e na lista de entradas públicas de `src/shared/db/fronteiraDoWorker.test.ts`, porque autentica por credencial e não por sessão. Exceção de ferramenta vira falha genérica; a mensagem original não volta ao agente.

Provado com o cliente oficial (`@modelcontextprotocol/client` 2.x) contra o app de teste: conecta, lista a ferramenta e lê o catálogo. O cliente negociou a geração 2025-11-25 pelo caminho sem sessão; o caminho 2026-07-28 do mesmo handler não foi exercitado por cliente real.

### 7. Execução, tetos e custo

- Chamada ao modelo acontece fora de transação de banco, com tempo máximo e `maxRetries` baixo.
- Toda execução grava uma linha de uso (organização, tarefa, modelo, tokens, latência, resultado, `requestId`). O teto diário por organização e por tarefa lê essa tabela; o limitador em memória serve só para rajada.
- Tetos padrão conservadores, mudados só por `owner`. Botão de desligar a IA por organização.
- Execução longa usa tabela de execuções em Postgres acionada por rota de worker (molde de `publicar-pendentes`), idempotente. Sem motor de workflow.

### 8. Dado a terceiro e injeção de instrução

- Conteúdo do Brain e saída de ferramenta são **dado não confiável**: entram no pedido como dado delimitado, nunca como instrução. A saída do modelo é validada por esquema e nunca executada.
- A política de uso do Brain e `textoSeguro` filtram antes de montar o pedido. Sem dado pessoal.
- O agente da v1 não tem ferramenta de escrita nem canal de saída para fora. Dado privado, conteúdo não confiável e canal de saída não ficam juntos na mesma execução.
- Log e tabela de uso nunca guardam texto de pedido ou de resposta. A chave do fornecedor nunca aparece em log, erro, URL ou auditoria.
- Aceite de termos de fornecedor e contrato com o cliente são do humano.

### 9. Economia de tokens sem perder qualidade

- Ferramenta devolve página pequena por padrão (10 entradas no MCP), com cursor e filtros, e o `catalogHash` para o agente não reler o que não mudou.
- Saída sempre estruturada, com esquema enxuto e teto de tokens de saída por tarefa.
- A classe `rapido_e_barato` é o padrão; `raciocinio_forte` só na tarefa que prova precisar.
- Instrução de sistema fixa e curta por tarefa, com a parte estável primeiro, para o cache do fornecedor funcionar como otimização do adaptador.
- Orçamento de passos por execução de agente.

### 10. Gate e Comitê

O Gate continua determinístico, em código, como no ADR 0056 §5. Passo de IA no Gate e personas do Comitê não fazem parte desta camada; ficam para a issue 24K-116.

### 11. O que esta entrega cobre e o que fica para a próxima

Entregue e testado: registro de ferramentas, ferramenta `brain_consultar_catalogo`, credencial de agente (banco, serviço, tela), servidor MCP, porta de modelo com o adaptador do AI SDK, executor único (`modules().ia.executor`) com orçamento, delimitação de dado, registro de uso e ferramentas de leitura no laço, e a suíte de contrato `scripts/ia-contrato.ts`.

A chave do fornecedor, o modelo por tarefa em `/config/ia`, a tabela de uso com teto diário e o botão de desligar vieram na entrega seguinte e estão no ADR 0058, que também corrige o caminho previsto aqui: a chave não entra como plataforma de conexão, e sim em tabela própria selada com a cifra do cofre e coberta pela mesma varredura de recifragem. Fila de execução longa continua fora.

## Etapas

B1 registro e ferramenta do Brain · B2 credencial de agente · B3 servidor MCP · A1 porta e fornecedor falso · A2 conexão de fornecedor · A3 configuração por tarefa · A4 ponto único de execução, uso e tetos · C1 agente interno com ferramentas de leitura. Um PR por etapa; todo PR passa por `security-reviewer` e teste de integração com isolamento entre organizações.

## Alternativas consideradas

- **Aceitar o token do worker no MCP.** Rejeitado: um token alcançaria todas as organizações.
- **Mastra ou LangGraph.** Rejeitado: trazem estado, memória e fluxo próprios, que conflitam com RLS, auditoria e com o plano como dado versionado (ADR 0056).
- **Gateway de modelos (LiteLLM, OpenRouter, AI Gateway).** Rejeitado na v1: mais um serviço e mais um terceiro vendo o dado. A porta permite acrescentar depois como fornecedor compatível com OpenAI.
- **Motor de workflow (Temporal, Inngest, Workflow DevKit).** Rejeitado na v1: a fila em Postgres já resolve.
- **`mcp-handler`.** Rejeitado: exige `@vercel/otel` como par e o SDK oficial já atende rota do Next.
- **Adaptador escrito à mão por fornecedor.** Rejeitado: cinco implementações de saída estruturada e de ferramenta para manter.

## Consequências

- Acrescentar fornecedor é um pacote, uma linha de registro e passar na suíte de contrato, que roda à mão com chave real, fora do CI.
- Acrescentar ferramenta é uma entrada no registro e um teste; ela aparece no agente interno e no MCP ao mesmo tempo.
- A camada nasce sem consumidor real. As provas da v1 são o botão "Testar modelo" e a ferramenta do Brain chamada por um cliente MCP.
- O limitador em memória vale enquanto houver um processo só; mais de uma instância exige limitador compartilhado.

## Não verificado

- Lista de modelos, código de erro de chave inválida e saída estruturada de Anthropic, OpenAI, xAI e Moonshot com chave real (só o Google foi provado). Nome e id do modelo Kimi. A suíte `scripts/ia-contrato.ts` existe para isso.
- Mudanças de autorização da spec MCP 2026-07-28 (SEP-2352), lidas só em resumo. Não afetam a v1, que não usa OAuth.
- O caminho 2026-07-28 do handler com cliente real.
- O prefixo `orla_ag_` ainda não está nos padrões da varredura de segredo (`.claude/hooks/lib/politicas.mjs`). O agente não edita a própria guarda; o padrão `/\borla_ag_[A-Za-z0-9_-]{43}\b/` entra por PR do humano, com teste em `tests/ambiente-economia-seguranca.test.mjs`.
- Em produção `/api/mcp` passa pelo Caddy como qualquer rota do app e responde 404 enquanto `IA_MCP_HABILITADO` não for passado ao contêiner; ligar é mudança de `infra/` feita pelo humano.
