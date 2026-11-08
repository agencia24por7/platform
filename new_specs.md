# tria — AI-Native AdTech Platform

> Visão de produto. Combina a gestão operacional multi-conta do Optmyzr com a capacidade de
> análise e otimização por IA do Albert.ai — e vai além dos dois.

A proposta é criar uma nova categoria de produto: uma **AI-Native AdTech Platform**, pensada
para agências e operações que gerenciam várias contas de mídia paga.

A distinção fundamental:

- **Optmyzr** resolve a escala operacional: administrar muitas contas, campanhas, orçamentos,
  regras, alertas, auditorias e relatórios.
- **Albert** resolve parte da escala intelectual e operacional: analisar desempenho
  continuamente, encontrar oportunidades e executar otimizações dentro de objetivos e limites.
- **Nossa plataforma** deve unir os dois: uma central multi-conta com um agente de IA que
  entende cada negócio, planeja, opera, monitora e otimiza suas campanhas.

Não queremos construir apenas um dashboard com um chatbot acoplado. O produto deve ter uma
camada de gestão robusta e uma camada de inteligência que realmente consiga agir sobre as
contas, com controle, rastreabilidade e autonomia configurável.

---

## Índice

| # | Seção | |
| --- | --- | --- |
| 1 | Engenharia reversa: o que aprender com cada produto | Optmyzr, Albert e o espaço que ocupamos |
| 2 | Arquitetura funcional: seis módulos | Command Center → Governance |
| 3 | O coração do produto: portfólios e contas | Hierarquia, MCC, cross-account |
| 4 | **Modelo de acesso: usuários, members e escopos** | N:N usuário ↔ conta |
| 5 | O agente de IA | Sete agentes especializados |
| 6 | **Campanhas de marketing e o Kanban de agentes** | A iniciativa acima das campanhas de plataforma |
| 7 | Ciclo operacional | Planejar → implementar → monitorar → otimizar |
| 8 | Interface | Área da agência, do agente e do cliente |
| 9 | Arquitetura técnica | Serviços, schemas, integrações |
| 10 | **Conexão de contas e credenciais** | Como as contas entram, no padrão do mercado |
| 11 | **Camada de dados e evidência** | O que torna a plataforma data-driven |
| 12 | **Execução segura e limites operacionais** | Idempotência, kill switch, quota, custo |
| 13 | Diferencial competitivo | Por que escolher esta ferramenta |
| 14 | Roadmap de desenvolvimento | Seis fases |
| 15 | Decisões de produto a fechar | Dez decisões com recomendação |
| 16 | Visão final | |

---

## 1. Engenharia reversa: o que aprender com cada produto

### A. Optmyzr — o sistema operacional de gestão de mídia paga

Referência principal: gestão multi-conta, otimização e automação controlada.
Fonte: [site oficial e produtos](https://www.optmyzr.com/products/)

Não é um painel que reúne métricas. É uma caixa de ferramentas para o profissional de mídia
operar contas de publicidade em escala.

O que precisamos reproduzir funcionalmente:

| Capacidade | O que significa na prática |
| --- | --- |
| Multi-account management | Conectar e administrar muitas contas em um só ambiente |
| Account portfolio | Agrupar contas por cliente, carteira, equipe ou operação |
| Cross-account reporting | Comparar e consolidar resultados de várias contas |
| Monitoring | Identificar problemas, desvios e oportunidades |
| Audits | Avaliar estrutura, configurações e saúde das contas |
| Budget management | Acompanhar ritmo de gasto e redistribuir orçamento |
| Bulk operations | Aplicar mudanças em várias campanhas ou contas |
| Rule Engine | Criar regras de otimização programadas |
| One-click optimization | Revisar e aplicar alterações sem navegar em cada plataforma |
| Alerts | Alertar quando métricas ou orçamentos saem dos limites |

A documentação mostra um ponto importante: o Optmyzr trabalha com contas conectadas
individualmente **ou** por estruturas de gerenciamento, como MCC do Google Ads, e oferece
recursos em nível de conta e de portfólio.

> **Lição arquitetural:** nossa plataforma precisa ter uma entidade chamada `Portfolio`, não
> apenas uma lista de clientes. Uma agência pode ter dezenas de clientes, cada um com diversas
> contas, plataformas, marcas e unidades de negócio.

### B. Albert.ai — o motor de otimização autônoma

Referência principal: otimização contínua, alocação e execução orientadas por objetivos.
Fonte: [site oficial](https://www.albert.ai/)

Proposta diferente: conectar-se às plataformas de mídia e executar otimizações continuamente,
decidindo em função dos objetivos definidos e dos limites autorizados.

O que precisamos aprender com ele:

| Capacidade | O que significa na prática |
| --- | --- |
| Goal-based optimization | Otimizar em função de objetivos de negócio |
| Budget allocation | Redistribuir investimento conforme desempenho |
| Bid optimization | Ajustar lances e estratégias de lance |
| Audience optimization | Identificar públicos com melhor desempenho |
| Creative optimization | Comparar e otimizar ativos criativos existentes |
| Placement optimization | Avaliar onde os anúncios estão performando |
| Continuous testing | Testar combinações e aprender com os resultados |
| Autonomous execution | Executar ajustes sem depender de aprovação para cada ação |
| Guardrails | Respeitar limites e regras definidos pelo operador |

Detalhe relevante: a documentação pública do Albert afirma que ele **não** substitui a
definição estratégica do cliente nem a produção dos criativos. O cliente fornece objetivos,
escopo, estratégia e materiais; o sistema trabalha na otimização computacional, execução e
alocação.

> **Lição de produto:** não confundir IA que *conversa* sobre campanhas com IA que *opera*
> campanhas. Nosso agente precisa de acesso a dados, ferramentas de análise, capacidade de
> propor ações e uma camada segura de execução.

### C. O espaço que podemos ocupar

| | Gestão multi-conta | Operação por IA |
| --- | --- | --- |
| **Optmyzr** | Controle, organização, escala, auditoria e operação | — |
| **Albert** | — | Análise contínua, decisões, testes e otimização autônoma |
| **Nossa AdTech** | Multi-Account Management | + AI Marketing Operations |

Uma plataforma que gerencia carteiras inteiras de mídia paga e usa agentes de IA para
entender o negócio, pesquisar o mercado, criar estratégias, operar campanhas e melhorar os
resultados.

Recomendação: não tentar competir com cada funcionalidade dos dois produtos logo no início.
Construir a fundação multi-conta e o motor de inteligência como partes do mesmo sistema.

---

## 2. Arquitetura funcional: seis módulos

O que importa é entender quais operações um gestor de tráfego realiza diariamente e
transformar isso em uma experiência integrada.

| # | Módulo | Responsabilidade |
| --- | --- | --- |
| 01 | **Command Center** | Visão geral de toda a operação: clientes, contas, plataformas, investimentos, resultados, alertas e saúde das integrações |
| 02 | **Account Management** | Gestão de múltiplas contas, carteiras, clientes, campanhas, estruturas, orçamentos e operações em massa |
| 03 | **Performance Intelligence** | Análise de resultados, comparações, diagnósticos, auditorias, anomalias, tendências e oportunidades |
| 04 | **AI Agent** | Inteligência que conhece o negócio, pesquisa o mercado, cria estratégias, analisa campanhas e decide o que fazer |
| 05 | **Campaign Operations** | Execução de alterações nas plataformas, criação e edição de campanhas, testes, orçamento, públicos e criativos |
| 06 | **Automation & Governance** | Regras, aprovações, limites de autonomia, histórico de alterações, auditoria e execução segura — aplicadas a **qualquer ator**, humano ou agente (seção 12.5) |

Esses módulos não são seis produtos separados. Compartilham os mesmos dados, contas,
permissões e mecanismos de execução.

---

## 3. O coração do produto: portfólios e contas

Primeira parte que precisa ser muito bem feita. Sem isso não há equivalente funcional ao
Optmyzr.

### Hierarquia de organização

```
Agência / Organização            toda a operação da empresa
└── Portfolio / Carteira         eixo da agência — ex.: "Clientes de e-commerce"
    ├── Cliente A
    │   ├── Meta Ads      → conta de anúncios 1, conta 2...
    │   └── Google Ads    → conta de anúncios 1, conta 2...
    └── Cliente B (rede)         eixo do cliente — parent_client_id
        ├── Filial 1      → contas próprias
        ├── Filial 2      → contas próprias
        └── ...
```

### Dois eixos, não um

Há duas formas legítimas de agrupar, e elas **não são a mesma coisa**:

| Eixo | Entidade | De quem é | Serve para |
| --- | --- | --- | --- |
| **Carteira** | `portfolios` | Da agência | Escopo de acesso por equipe, benchmark entre operações comparáveis e consolidação interna |
| **Hierarquia** | `clients.parent_client_id` | Do cliente | Rede → filial, holding → marca. É a estrutura do negócio do cliente, não da operação |

Uma filial pertence ao mesmo tempo à *rede do cliente* e à *carteira de um gestor*. Com um
campo só, um dos dois se perde — por isso são dois.

> O portfólio é opcional. Com três clientes ele só adiciona um clique; a partir de dez, ou
> quando gestores diferentes cuidam de recortes diferentes, ele passa a pagar o próprio custo.

Uma conta de anúncios pode estar relacionada a uma empresa, mas **não devemos assumir que
cliente, conta e portfólio são a mesma coisa**.

Precisamos permitir:

- Um cliente com várias contas de anúncios.
- Um cliente com Meta e Google.
- Uma carteira com vários clientes.
- **Um cliente que é uma rede, com N filiais abaixo dele** — cada filial com verba, meta,
  contas e acesso próprios, e a rede consolidando tudo.
- Uma conta conectada por estrutura de acesso compartilhada.
- Diferentes gestores com acesso a diferentes carteiras.
- Visões consolidadas e individuais.

> **Detalhe técnico:** no Google Ads, a estrutura MCC é uma hierarquia de contas
> administradoras e contas anunciantes. A API permite percorrer essa hierarquia e identificar
> contas acessíveis, inclusive por acesso herdado. Não implementar isso como uma simples
> conexão de um ID de conta.

### O que o Command Center precisa permitir

| Tela | Função |
| --- | --- |
| Todas as contas | Visualizar todas as contas conectadas |
| Portfólios | Agrupar e comparar carteiras |
| Clientes | Visualizar a operação de cada cliente |
| Plataformas | Filtrar Meta, Google e outras integrações |
| Campanhas | Consultar campanhas de várias contas |
| Orçamentos | Acompanhar investimentos e limites |
| Alertas | Identificar problemas e oportunidades |
| Auditorias | Verificar a saúde das contas |
| Operações em massa | Aplicar ações em várias contas |

### Recurso obrigatório: visão cross-account

Com 30 clientes, estas perguntas não se respondem abrindo 30 contas:

- Quais contas estão com CPL acima da meta?
- Quais campanhas gastaram sem gerar conversões?
- Quais clientes estão aumentando o investimento?
- Quais contas têm problemas de entrega?
- Quais campanhas apresentam sinais de fadiga?
- Onde há oportunidade de aumentar o orçamento?

Deve funcionar tanto por filtros tradicionais quanto por linguagem natural.

---

## 4. Modelo de acesso: usuários, members e escopos

Uma decisão estrutural: **um usuário não pertence a uma conta**. Um usuário é uma identidade
global que pode gerenciar várias contas, de vários clientes, em várias carteiras — e, no
limite, em mais de uma agência. Modelar isso como `user.client_id` quebra na primeira semana
de operação real.

### Referências de mercado

| Produto | Como resolve | O que levamos |
| --- | --- | --- |
| **Google Ads MCC** | Hierarquia de contas administradoras × anunciantes; acesso herdado desce na árvore | Acesso pode ser herdado de um nó superior, não só concedido na folha |
| **Meta Business Manager** | Separa *pessoas* de *ativos*; cada pessoa recebe atribuição por ativo, com papel por ativo | Atribuição por recurso em `members`, não papel global único |
| **Google Analytics 4** | Papéis em conta e em propriedade, com herança e restrição de dados | Papel por nível + possibilidade de restringir campos sensíveis |
| **Optmyzr / Supermetrics** | Assentos por usuário com acesso por conta selecionada | Seat ≠ acesso: cobrar por pessoa, autorizar por recurso |
| **SaaS B2B (padrão org/membership)** | `organizations` + `memberships` + convites + papéis | Uma pessoa em várias organizações, com papel distinto em cada |

### As quatro camadas de acesso

Elas são independentes e não devem ser confundidas:

1. **Identidade** — quem a pessoa é. Login Google (Auth.js). Um registro por pessoa, para
   sempre, independente de quantas agências ou clientes ela acesse.
2. **Associação** — de qual organização ela faz parte, e com qual papel base. É a linha de
   `members` com `scope_type = organization`.
3. **Autorização por escopo** — a que ela tem acesso dentro daquela organização: a
   organização inteira, carteiras, clientes ou contas específicas. São as demais linhas de
   `members`.
4. **Credencial técnica** — o token que autoriza a *plataforma* a falar com a conta de
   anúncios. Vive em `integrations`, não tem relação com pessoa nenhuma.

> Revogar o login de alguém não derruba a conexão das contas. Revogar uma conta de anúncios
> não tira o acesso de ninguém à plataforma. São eventos diferentes, com auditoria separada.

### A relação é N:N

Um usuário gerencia **N contas**. Uma conta é gerenciada por **N usuários**. Quem sustenta
essa relação é a tabela **`members`** — ela é a tabela de junção, não um campo dentro de
`users` nem dentro de `ad_accounts`.

```
users  1 ──< members >── N  ad_accounts / clients / portfolios / organization
```

Cada linha de `members` é uma concessão: *esta pessoa, neste recurso, com este papel*. Uma
pessoa com acesso a 12 contas tem 12 linhas — ou uma linha só, se o acesso vier de um
escopo acima (carteira ou organização), porque **o acesso desce na hierarquia**, como no MCC
do Google e no Business Manager do Meta.

### Tabelas

```
core.organizations
  id · name · slug · plan · status · created_at
  A agência. Raiz do isolamento multi-tenant.

core.users
  id · email · name · avatar_url · auth_provider · last_login_at · status
  Identidade global. NÃO tem client_id, NÃO tem account_id, NÃO tem organization_id.
  Uma pessoa = um registro, para sempre, mesmo acessando várias agências.

core.members                        ← a tabela N:N que gerencia tudo
  id
  organization_id  → organizations          tenant dono da concessão
  user_id          → users                  quem recebe o acesso
  scope_type       organization | portfolio | client | ad_account
  scope_id         id do recurso concedido  (null quando scope_type = organization)
  role             owner | admin | manager | analyst | client | partner
  status           invited | active | suspended | revoked
  seat_type        full | light | client_portal
  granted_by → users · granted_at · expires_at · revoked_at
  UNIQUE (user_id, scope_type, scope_id)
  INDEX  (organization_id, user_id) · (scope_type, scope_id)

  Uma linha com scope_type='organization'  → acesso a toda a agência
  Várias linhas com scope_type='ad_account' → o N:N usuário ↔ conta, explícito
  Linha com scope_type='portfolio'          → alcança clientes e contas daquela carteira

core.invitations
  id · organization_id · email · role · scopes[] · token · expires_at
  accepted_by → users · status
  O convite existe antes do usuário. Aceitar cria users (se necessário) + members.

core.roles / core.role_permissions
  Catálogo de papéis e permissões nomeadas (client.create, approval.decide,
  agent.autonomy.change, report.export, cost.view...). Papel é um conjunto de
  permissões, não um ENUM espalhado pelo código.

core.access_audit
  id · organization_id · actor_type (user|agent|system) · actor_id
  action (member.invite | member.grant | member.revoke | member.role_change)
  target_user_id · scope_type · scope_id · before · after · ip · at
```

> `integrations.ad_account_access` continua existindo e **não se confunde com `members`**:
> ela guarda a credencial técnica (token, MCC, Business Manager) que autoriza a *plataforma*
> a falar com a conta. `members` guarda quem, entre as *pessoas*, pode mexer nela.

### Resolução de permissão

A permissão efetiva de uma pessoa sobre um recurso é calculada assim:

1. A pessoa precisa ter ao menos uma linha **ativa** em `members` na organização dona do
   recurso. Sem isso, nada — nem leitura.
2. Junta-se a **união** de todas as linhas que alcançam o recurso, direta ou por herança:
   `organization` alcança tudo; `portfolio` alcança os clientes da carteira e as contas
   desses clientes; `client` alcança aquele cliente, **suas filiais** e as contas de todos
   eles; `ad_account` alcança só ela.
3. Havendo mais de um caminho, vence o **escopo mais específico**. Uma linha em `ad_account`
   com papel `analyst` restringe aquela conta mesmo que a pessoa seja `manager` na carteira.
4. `expires_at` vencido, `revoked_at` preenchido ou `status` diferente de `active` não
   concede nada. Linha expirada não é apagada: vira histórico auditável.

> Exemplo real: Rafael tem uma linha `portfolio = E-commerce` com papel `manager` — isso lhe
> dá as 5 clientes e as 11 contas da carteira de uma vez. E uma linha
> `ad_account = Meta Odonto Prime | Principal` com papel `analyst`, de outra carteira. Ele
> opera 11 contas e apenas lê a décima segunda. Doze acessos, duas linhas.

### Papéis

| Papel | Escopo típico | O que faz |
| --- | --- | --- |
| `owner` | Organização | Tudo, inclusive faturamento, exclusão de dados e transferência da agência |
| `admin` | Organização | Gerencia clientes, carteiras, conexões, membros e autonomia do agente |
| `manager` | Carteiras ou clientes atribuídos | Opera campanhas e aprova ações dentro do limite |
| `analyst` | Carteiras ou clientes atribuídos | Lê dados e gera relatórios. Não aprova, não executa |
| `client` | O próprio cliente | Vê só o próprio ambiente, sem custo interno, fee ou comparação |
| `partner` | Escopo temporário com `expires_at` | Freelancer ou agência parceira com acesso datado |

### Regras que o modelo precisa sustentar

- Um gestor com várias carteiras e um analista com uma só.
- Um cliente com mais de um usuário (dono, analista de marketing, financeiro).
- Uma pessoa que é `manager` em uma agência e `client` em outra, com o mesmo login.
- Um consultor com leitura em várias agências: uma linha por organização, cada uma concedida
  e revogada de forma independente. **Ele troca de contexto, nunca vê uma visão somada entre
  agências** — isso seria vazamento entre clientes concorrentes.
- Uma pessoa do lado do cliente com acesso a mais de um negócio: uma linha por negócio, e o
  portal oferece a troca.
- Um gerente regional com acesso à rede inteira: **uma linha no cliente-pai**, que alcança as
  filiais sem precisar de uma linha por unidade.
- Freelancer com acesso a duas contas por 60 dias, expirando sozinho.
- Uma conta compartilhada entre dois gestores e um analista — N usuários na mesma conta.
- Desligamento: suspender as linhas de `members` daquele `user_id` corta tudo de uma vez.
- O **agente** é um principal próprio (`actor_type = agent`), não usa a credencial de uma
  pessoa. O que ele pode fazer vem do nível de autonomia do cliente, não de um papel humano.

### Isolamento

### Sessão

A sessão carrega `user_id`, `organization_id` e o `member_id` corrente. Quando a pessoa tem
vínculo em mais de uma organização, a interface oferece o **seletor de organização** — e tudo
que a tela mostra passa a ser daquele contexto. Não existe visão que atravesse organizações.

Toda tabela com dado de cliente carrega `organization_id` e `client_id`. O isolamento é
aplicado por **Row Level Security no PostgreSQL**, com a sessão carregando o
`member_id` corrente — e não apenas por filtro na aplicação. Um bug de query não pode virar
vazamento entre clientes nem entre agências.

## 5. O agente de IA: não um chatbot, um operador de mídia

Aqui está o diferencial mais importante. Não um agente único fazendo tudo de forma
desorganizada, mas um **sistema de agentes especializados** que compartilham contexto e
trabalham em conjunto.

| Agente | Responsabilidade |
| --- | --- |
| **AI Orchestrator** | Coordena os agentes, entende o pedido e distribui o trabalho |
| **Market Research Agent** | Mercado, concorrentes, público e oportunidades |
| **Strategy Agent** | Planejamento, funis, canais e orçamento |
| **Performance Agent** | Diagnósticos, métricas, tendências e testes |
| **Campaign Agent** | Criação, edição e otimização de campanhas |
| **Portfolio Intelligence Agent** | Analisa várias contas simultaneamente e identifica padrões entre clientes e carteiras, respeitando o isolamento dos dados |
| **Policy & Execution Engine** | Valida permissões, limites e aprovações, e executa as ações permitidas |

### O que cada agente faz

**1. Market Research Agent** — recebe o contexto de um cliente e pesquisa concorrentes,
posicionamento e ofertas, produtos e serviços, público e comportamento de compra, tendências
do setor, oportunidades de comunicação, palavras-chave e intenções de busca.

> O resultado não deve ser apenas um texto. Deve alimentar a base de conhecimento do cliente,
> com fontes, datas e classificação entre fatos, estimativas e hipóteses.

**2. Strategy Agent** — transforma a pesquisa em um plano de mídia: objetivos de negócio,
estratégia de aquisição, funil de marketing, distribuição de orçamento, canais recomendados,
estrutura de campanhas, segmentação, briefings criativos, KPIs e metas.

**3. Performance Agent** — analisa continuamente CPL, CPA e ROAS; CTR, CPC, CPM e frequência;
conversões e taxa de conversão; ritmo de investimento; desempenho por campanha, conjunto,
anúncio e público; e mudanças relevantes em relação ao histórico.

> O mais importante: precisa explicar **o que aconteceu, por que provavelmente aconteceu e
> qual ação recomenda**.

**4. Campaign Agent** — transforma recomendações em ações: ajustar orçamento, alterar lances e
metas, pausar ou ativar campanhas, criar campanhas e conjuntos, atualizar anúncios e
configurações, organizar testes, ajustar segmentação, palavras-chave e posicionamentos.

> As ações devem ser realizadas por integrações oficiais, não por automações frágeis de
> navegador.

**5. Portfolio Intelligence Agent** — analisa toda a carteira da agência e responde perguntas
como:

> "Tenho 20 clientes de geração de leads. Quais apresentam o maior potencial de crescimento
> neste mês?"

> "Compare o desempenho das campanhas de e-commerce de todos os clientes e encontre padrões
> que possam ser aproveitados."

Pode identificar padrões agregados, mas **não deve expor informações confidenciais de um
cliente a outro**.

### 5.6. Perfil de contexto: três camadas, não uma

O Market Research Agent produz conhecimento de mercado; falta a camada mais simples — o
contexto estrutural do próprio negócio, que deveria ser formulário assistido, não pesquisa
nem prosa livre. Referência observada funcionando (Optmyzr Sidekick, nov/2026): três perfis
independentes, cada um alimentando o agente de um jeito diferente.

| Camada | Pergunta que responde | Alimenta |
| --- | --- | --- |
| **Perfil da organização** | Quem é a agência: site, nome, indústria, idiomas que atende, tom de voz institucional | Tom e idioma de toda resposta do agente, em qualquer conta |
| **Perfil da conta** | Quem é o cliente daquela conta: site da marca, como a conta é segmentada (marca × não-marca, região, funil...), termos que descrevem a marca, **termos que nunca devem ser associados a ela**, termos dos concorrentes | Recomendações de copy, exclusão de termos negativos, checagem de brand safety |
| **Perfil da pessoa** | Quem está perguntando: papel (gestor, dono de agência, freelancer...), nível de experiência com mídia paga, formato preferido de resposta (tabela, gráfico, bullet, resumo) | Como a mesma resposta é apresentada — não o que ela diz |

- **Preenchimento assistido, não manual.** Um botão "gerar perfil a partir do site" faz o
  agente ler o site da agência ou do cliente e pré-preencher indústria, tom e descrição livre
  do negócio. A pessoa revisa e ajusta — não começa do zero.
- **Termos proibidos** (que não devem ser associados à marca) alimentam diretamente o
  guardrail de "palavras bloqueadas no copy" da seção 12.5 — o perfil de contexto e a política
  de execução compartilham o mesmo dado, em vez de cadastrados duas vezes.
- **A personalização por pessoa não muda o dado, muda a entrega.** Dois gestores da mesma
  conta podem fazer a mesma pergunta e receber a mesma informação em formatos diferentes —
  um em tabela densa, outro em resumo de três linhas — porque o perfil de cada um registra
  essa preferência junto com o nível de experiência.

---

## 6. Campanhas de marketing e o Kanban de agentes

### 6.1. A entidade que falta no mercado

Optmyzr e Albert trabalham na *campanha de plataforma*: uma campanha do Meta, uma do Google.
Falta a camada de negócio acima delas — a **campanha de marketing**: a iniciativa que o
cliente entende e contrata.

"Black Friday 2026" não é uma campanha do Meta. É uma iniciativa com objetivo, verba,
período e hipóteses, que se materializa em cinco campanhas do Meta e três do Google,
distribuídas em quatro contas de anúncio.

```
ads.marketing_campaigns          ← a iniciativa (entidade de negócio)
  └── ads.campaigns              ← campanhas de plataforma (Meta, Google), em N contas
        └── ads.ad_sets
              └── ads.ads
```

```
ads.marketing_campaigns
  id · organization_id · client_id · portfolio_id
  name                 "Black Friday 2026"
  objective            vendas | leads | reconhecimento | retenção
  model                leads | ecommerce              herdado do cliente
  origin               agent | manual                 quem criou a iniciativa
  brief                objetivo de negócio em texto, dado por pessoa ou pelo agente
  budget_total · budget_allocated · period_start · period_end
  scope_type      client | client_tree | portfolio
  scope_id        cliente, raiz da rede ou carteira alcançada
  platforms[]          meta, google
  ad_account_ids[]     contas onde ela será materializada  (N contas)
  stage_id             → agent.pipeline_stages            coluna atual do Kanban
  stage_since          entrou nesta coluna quando
  status               em_fluxo | aguardando_humano | bloqueada | no_ar | encerrada
  blocked_reason
  owner_user_id        responsável humano
  target_kpis          { roas: 4.0 } ou { cpl: 95, volume: 120 }
  created_by (user|agent) · created_at
```

A campanha de marketing é o objeto que o Kanban movimenta. As campanhas de plataforma são
consequência dela — criadas pelo Campaign Agent ou vinculadas manualmente, se já existirem.

**A iniciativa nem sempre é de um cliente só.** Uma rede com vinte filiais faz "Fim de ano"
uma vez, não vinte: `scope_type = client_tree` faz a iniciativa alcançar o cliente-raiz e
todas as filiais abaixo dele, materializando-se nas contas de todas. O card do Kanban mostra
o alcance, e o resultado consolida a rede inteira sem perder a leitura por unidade.

| `scope_type` | Alcance | Quando usar |
| --- | --- | --- |
| `client` | Um cliente | O caso comum |
| `client_tree` | O cliente e todas as filiais | Campanha de rede, holding ou franquia |
| `portfolio` | Todos os clientes de uma carteira | Ação transversal da agência |

### 6.2. O pipeline é feito dos próprios agentes

Cada iniciativa percorre sempre o mesmo caminho. **As colunas do Kanban são exatamente os
agentes do sistema**, mais os portões humanos onde a decisão não é da máquina.

| # | Coluna | Tipo | O que acontece ali | Saída que move o card |
| --- | --- | --- | --- | --- |
| 1 | **Briefing** | Humano | Objetivo de negócio, verba e período. Pode ser preenchido por pessoa ou gerado pelo agente a partir de um pedido em linguagem natural | Briefing aceito |
| 2 | **AI Orchestrator** | Agente | Lê o briefing, consulta o contexto do cliente, decide quais agentes acionar e em que ordem | Plano de trabalho distribuído |
| 3 | **Market Research Agent** | Agente | Concorrentes, ofertas, público, tendências, palavras-chave — com fonte e classificação | Pesquisa concluída |
| 4 | **Strategy Agent** | Agente | Plano de mídia: estrutura, canais, distribuição de verba, segmentação, briefing criativo, KPIs e hipóteses | Plano pronto para aprovação |
| 5 | **Aprovação** | Humano | Gestor aprova, pede ajuste ou recusa. Verba e metas são confirmadas aqui | Plano aprovado |
| 6 | **Campaign Agent** | Agente | Monta as campanhas, conjuntos, públicos, palavras-chave e anúncios nas contas escolhidas | Estrutura montada, pendente de publicação |
| 7 | **Policy & Execution** | Agente | Valida limites, permissões e orçamento; publica pelas APIs oficiais via n8n; verifica o que foi aplicado | Publicada e verificada |
| 8 | **Performance Agent** | Agente | A iniciativa está no ar. Monitoramento contínuo, diagnóstico, anomalia e recomendação de otimização | Período encerrado |
| 9 | **Portfolio Intelligence** | Agente | Fecha o ciclo: mede o resultado contra o KPI, registra o aprendizado e compara com operações semelhantes da carteira | Aprendizado registrado, iniciativa arquivada |

```
agent.pipeline_stages
  id · position · name · kind (human|agent) · agent_id · sla_hours · description

agent.pipeline_events                  histórico de cada movimentação
  id · marketing_campaign_id
  from_stage_id · to_stage_id
  actor_type (user|agent|system) · actor_id
  at · duration_seconds · note · artifact_id
```

O card nunca "pula" de coluna sem evento: toda transição grava quem moveu, quando e o que
foi produzido. É a mesma trilha de auditoria da seção 10, aplicada ao fluxo.

### 6.3. Nasce do zero pelo agente ou pela mão

**`origin = agent`** — o gestor descreve o resultado que quer e o Orchestrator cria a
iniciativa inteira:

> "Preciso de 120 matrículas para a turma de março, com R$ 40 mil, priorizando a região
> metropolitana."

O card aparece já na coluna *AI Orchestrator*, com briefing preenchido e os agentes
seguintes enfileirados.

**`origin = manual`** — o gestor cria o briefing na mão e escolhe de onde o fluxo começa.
Pode pular a pesquisa, pode trazer um plano pronto, pode apenas vincular campanhas que já
existem nas contas e entrar direto em *Performance Agent*.

Nos dois casos o card percorre o mesmo pipeline e produz o mesmo histórico.

### 6.4. Ações manuais e agênticas no mesmo fluxo

Cada card carrega uma **ação pendente**, e ela tem dono explícito:

| Tipo | Exemplos | Como aparece no card |
| --- | --- | --- |
| **Agêntica** | Pesquisa rodando · montando campanhas · publicando · aguardando dado | Indicador de atividade e tempo decorrido. Não há botão: o sistema avança sozinho |
| **Manual** | Aprovar plano · enviar criativos · revisar copy · autorizar aumento de verba · corrigir conexão | Botão de ação direta no card, com o nome de quem precisa agir |
| **Bloqueio** | Conta com token expirado · contexto abaixo de 60% · verba não confirmada · dado inconsistente | Card destacado, com o motivo e o caminho para destravar |

Uma coluna de agente com card parado há mais tempo que o `sla_hours` acende alerta — é como
se descobre que o fluxo travou sem ninguém perceber.

### 6.5. Ver tudo ou filtrar

A visão padrão é o **escopo do `member`** (seção 4): quem gerencia 12 contas vê as
iniciativas das 12, de uma vez, no mesmo quadro.

Filtros combináveis:

- **Cliente** — uma operação específica
- **Conta de anúncios** — útil quando um cliente tem várias contas e só uma importa agora
- **Portfólio** — a carteira inteira
- **Plataforma** — só Meta, só Google
- **Gestor responsável** — minhas iniciativas × as da equipe
- **Origem** — criadas pelo agente × criadas na mão
- **Status** — em fluxo, aguardando humano, bloqueadas, no ar

E dois agrupamentos: **por agente** (o Kanban em si, padrão) e **por cliente** (raias, para
quem quer ver a operação de cada conta na horizontal).

### 6.6. O que o card mostra

```
┌────────────────────────────────────────────┐
│ ▎Black Friday 2026            ● Aguardando │
│  Loja Flora · E-commerce                   │
│  ●Meta ●Google · 3 contas · 8 campanhas    │
│  R$ 48.000 · 01/11 a 30/11                 │
│  Meta: ROAS ≥ 4,2                          │
│  ⏱ 1d 4h nesta coluna  (SLA 24h) ⚠         │
│  ⚑ Aprovar plano de mídia · Rafael         │
└────────────────────────────────────────────┘
```

Clicar abre a iniciativa: linha do tempo do pipeline, artefatos produzidos em cada etapa
(pesquisa, plano, estrutura montada), campanhas de plataforma vinculadas com métrica
consolidada, ações pendentes e o resultado medido contra o KPI.

### 6.7. Por que isso importa

Sem essa camada, a plataforma responde "a campanha X do Meta está com CPA alto". Com ela,
responde **"a iniciativa de Black Friday da Loja Flora está entregando 62% da meta de receita,
com três campanhas no Meta acima do CPA alvo e duas do Google abaixo"** — que é a pergunta
que o cliente realmente faz, e é a unidade pela qual a agência cobra e presta contas.

### 6.8. Blueprints: o playbook que a agência repete, não a iniciativa que ela executa uma vez

O Kanban (6.2) resolve o fluxo de **uma** iniciativa específica. Falta a camada de cima: o
**playbook reutilizável** que a agência aplica sempre que repete um tipo de trabalho —
onboarding de conta nova, auditoria trimestral, lançamento de data sazonal. Referência
observada (Optmyzr "Account Blueprints", nov/2026): pronto, customizado, ou gerado por IA a
partir de um objetivo em texto, com tarefas atribuídas a pessoas e papéis próprios
(`User Roles` — ver abaixo, não se confunde com os papéis de acesso da seção 4).

- **Blueprint ≠ iniciativa.** O blueprint é o molde; a iniciativa (6.1) é a instância.
  "Auditoria trimestral de conta" é um blueprint; aplicá-lo à conta do Cliente X em novembro
  de 2026 é a execução dele.
- Um blueprint pode gerar **tarefas humanas** (revisar feed de produto, validar criativo),
  **estágios do pipeline de agentes** (acionar o Performance Agent), ou os dois ao mesmo
  tempo.
- Biblioteca com três origens: pré-construído pela plataforma, customizado pela agência, ou
  gerado por IA a partir de uma frase de objetivo — a mesma lógica de `origin = agent|manual`
  da seção 6.3, aplicada ao nível de processo, não de iniciativa.
- `agent.blueprints` · `agent.blueprint_tasks` — tarefas com dono, prazo e papel, distintas de
  `pipeline_events` (que é histórico de transição de agente, não checklist humano).

### 6.9. Produção de criativo e aprovação externa — o Kanban que falta antes do Kanban

O Kanban da seção 6.2 começa no Briefing e termina na conta de anúncios publicada. Mas antes
do briefing existe produção de criativo — copy, imagem, vídeo — com gente de fora da agência
no meio: o designer freelancer, o cliente que precisa aprovar. Referência observada (mLabs
"Workflow", nov/2026): um Kanban próprio para isso, com três diferenças importantes em
relação ao nosso pipeline de agentes.

- **Papel de tarefa ≠ papel de acesso.** Quem cria (redator, designer) e quem aprova (gestor
  interno, cliente) são atribuídos **por demanda**, não pela role fixa de `members` (seção 4).
  A mesma pessoa pode criar em uma demanda e aprovar em outra; o papel vive na tarefa, não só
  na conta.
- **Aprovação sem login.** Quem aprova recebe um **link de aprovação por e-mail ou WhatsApp**
  e decide sem precisar entrar na plataforma nem ter uma conta de `members` — crítico para o
  cliente final, que não deveria precisar de credencial pra aprovar um post ou um criativo.
- **Histórico de conversa substitui e-mail.** Pedidos de ajuste, comentários e aprovações
  ficam na própria demanda — não se perde em thread de e-mail nem grupo de WhatsApp paralelo.

Esse Kanban de produção alimenta o Kanban de campanhas (6.2): a saída de "criativo aprovado"
é o insumo que o Campaign Agent materializa em anúncio. São dois pipelines com donos e
estágios diferentes, não um só.

---

## 7. Ciclo operacional: planejar, implementar, monitorar e otimizar

O agente precisa funcionar como um ciclo contínuo, não como uma ferramenta que só responde
quando alguém pergunta.

| Etapa | O que faz | Saída |
| --- | --- | --- |
| **1. Planejar** | Entende o negócio, pesquisa o mercado, analisa os dados e cria o plano de mídia | Estratégia, orçamento, estrutura e hipóteses |
| **2. Implementar** | Transforma o plano em alterações concretas nas plataformas, com validação e aprovação | Campanhas e configurações publicadas |
| **3. Monitorar** | Acompanha campanhas, resultados, orçamento, problemas e mudanças relevantes | Diagnósticos e alertas contextualizados |
| **4. Otimizar** | Recomenda, testa e executa melhorias, respeitando os limites definidos | Ações, resultados e novos aprendizados |

O ciclo recomeça com os novos dados.

Cada alteração precisa ser registrada para medir seu impacto e evitar que o agente repita
decisões que já se mostraram ruins.

### Três níveis de autonomia

Não entregar autonomia total desde o primeiro dia.

| Nível | Comportamento |
| --- | --- |
| **Consultivo** | Analisa e recomenda, sem executar |
| **Assistido** | Executa ações previamente autorizadas e pede aprovação para as demais |
| **Autônomo** | Opera dentro de limites definidos pela agência |

Exemplo de configuração:

- Pode aumentar orçamento em até 10% por dia.
- Não pode ultrapassar R$ 500 de investimento diário.
- Pode pausar anúncios com regras específicas.
- Não pode alterar campanhas estratégicas sem aprovação.
- Não pode criar campanhas sem autorização.
- Deve parar quando detectar inconsistência de dados.

> **Proteção contra decisões precipitadas:** o agente deve considerar volume de conversões,
> janela de atribuição, fase de aprendizado e ciclo de compra antes de sugerir pausas ou
> alterações.

---

## 8. Interface

Experiência em dois níveis: agência e cliente.

### Área da agência — menu principal

1. Dashboard Global
2. Portfólios
3. Clientes
4. Contas de Anúncios
5. Campanhas de Marketing (Kanban de agentes)
6. Campanhas de plataforma
7. Investimentos
8. Performance
9. Agente IA
10. Automações
11. Relatórios
12. Configurações

> **Relatórios como entregável de cliente, não só tela interna.** Além do relatório sob
> demanda, a agência precisa de dois formatos prontos: **recorrente** (mensal, com ou sem
> dado de conversão, enviado automaticamente) e **anual** (executivo × detalhado, com
> variante para e-commerce) — o material que justifica renovação de contrato numa reunião de
> fechamento de ano. Todo relatório exportável carrega **logo e cores da agência**, não da
> tria: quem recebe é o cliente da agência, e a marca que ele reconhece é a dela.

### Área do Agente IA

- **Visão geral** — o que está acontecendo na operação.
- **Conversar** — perguntar sobre clientes, campanhas e mercado.
- **Pesquisa** — pesquisas e inteligência competitiva.
- **Estratégia** — planos de mídia e recomendações.
- **Otimizações** — ações sugeridas e aprovadas.
- **Execuções** — o que o agente alterou.
- **Aprendizados** — resultados dos testes e alterações anteriores.
- **Configurações** — autonomia, limites e permissões.

### Área do cliente

O cliente visualiza somente suas próprias informações:

- Home
- Campanhas
- Investimentos
- Performance
- Relatórios

O cliente também pode ter acesso ao agente, mas com permissões limitadas e sem acesso à
operação interna da agência.

---

## 9. Arquitetura técnica

Decisões preservadas: Next.js, TypeScript, Google Login, PostgreSQL próprio, n8n e
infraestrutura no Google Cloud — sem Supabase.

A arquitetura evolui para separar claramente aplicação, inteligência e execução.

```
Frontend — Next.js
  dashboard, gestão multi-conta, agente IA, relatórios e aprovações
        │
Backend / API — TypeScript
  autenticação, permissões, regras de negócio, integrações e dados
        ├── Agent Service
        │     contexto, pesquisa, raciocínio, estratégia, análise e propostas
        └── Data & Integration Service
              Meta Ads, Google Ads, métricas, sincronização e normalização
        │
Execution & Automation — n8n
  filas, sincronizações, execução de ações autorizadas e monitoramento
        │
Meta Marketing API   ·   Google Ads API
        │
PostgreSQL
  dados operacionais, métricas, contexto, memória, ações e histórico
```

### Banco de dados

| Schema | Responsabilidade |
| --- | --- |
| `core` | Organizações, usuários, **members**, papéis, clientes (com hierarquia rede → filial) e portfólios |
| `integrations` | **connections**, connection_accounts, ad_accounts, ad_account_access, credential_audit, sync_logs |
| `ads` | **Campanhas de marketing (iniciativas)**, campanhas de plataforma, conjuntos, anúncios e orçamentos |
| `metrics` | Métricas históricas, conversões, reconciliação, baselines e restatements |
| `agent` | Contexto, memória, pesquisas, estratégias e recomendações |
| `automation` | Execuções, filas, alertas e resultados |

Entidades específicas para gestão multi-conta:

- `portfolios`
- `portfolio_clients`
- `members` — junção N:N entre usuários e recursos (ver seção 4)
- `marketing_campaigns` — a iniciativa que agrupa campanhas de N plataformas (ver seção 6)
- `pipeline_stages` · `pipeline_events` — o Kanban de agentes e seu histórico
- `ad_accounts`
- `ad_account_access`
- `account_groups`
- `account_snapshots`
- `bulk_operations`
- `account_audits`

> `ad_accounts` precisa ser uma entidade **independente** de `clients`, porque uma conta
> externa pode ter relações de acesso e gerenciamento diferentes da estrutura comercial da
> agência.

**Segurança.** Manter o banco interno do n8n separado do banco da plataforma. O n8n terá
usuário próprio, com leitura de views específicas e escrita limitada ao schema `automation`.
As alterações em campanhas passam pelo backend, pelo mecanismo de políticas e pelas
integrações oficiais. **O agente nunca terá acesso irrestrito ao SQL.**

### Integrações

Prioridade inicial:

1. Meta Ads
2. Google Ads
3. Google Analytics 4
4. Google Tag Manager
5. Google Merchant Center
6. Integrações de CRM e vendas, posteriormente

> É importante separar a autorização do usuário para **entrar na plataforma** da autorização
> para **acessar contas de publicidade**. São credenciais e permissões diferentes.

> **Lacuna de escopo identificada (nov/2026):** Optmyzr já opera Rule Engine, relatórios e
> auditoria sobre **Microsoft Ads (Bing)** e **Amazon Ads**, além de Meta e Google. Se o
> público-alvo é "agências que gerenciam várias contas" (decisão 15.1), essas duas plataformas
> não são feature-parity cosmético: Amazon Ads é onde vive a agência de e-commerce, Microsoft
> Ads é onde vive o lead B2B de CPC mais baixo. Vale decidir explicitamente se entram no
> roadmap (fase 2 ou 3) ou ficam fora por escolha, não por esquecimento — ver decisão 15.13.

### Exposição via MCP: a plataforma dentro da IA do cliente, não só a IA dentro da plataforma

Todo o desenho até aqui assume que o cliente entra na tria para falar com o agente. Referência
observada (mLabs "MCP", nov/2026): a plataforma **também** se expõe como servidor MCP, para
que o gestor converse com a própria conta de dentro do ChatGPT, Claude, Gemini ou qualquer
outro assistente que já usa no dia a dia — "agende o carrossel de terça" ou "o que está
aguardando minha aprovação?" sem abrir a ferramenta.

- O servidor MCP expõe as mesmas operações estruturadas do Agent Service (seção 9) —
  consultar métricas, listar aprovações pendentes, propor uma ação — nunca SQL direto nem a
  credencial da conta de anúncios (seção 10.7 continua valendo integralmente).
- Toda ação proposta por fora passa pelo mesmo Policy & Execution Engine e pela mesma
  Change Request (seção 12.5) que uma ação pedida de dentro da plataforma. O canal de entrada
  muda; o controle, não.
- Isso não substitui o agente próprio (seção 5) — é um segundo ponto de entrada pro mesmo
  sistema de permissões e políticas, pensado para quem já vive dentro de um assistente de IA
  e não quer trocar de aba pra cada pergunta operacional.

---

## 10. Conexão de contas e credenciais

A plataforma liga contas do jeito que as ferramentas de mercado ligam: **a tria é um
aplicativo registrado** no Google e na Meta, o cliente autoriza pelos canais oficiais, e
nenhuma credencial avulsa circula. Nada de senha do cliente, nada de token pessoal de
alguém da equipe, nada de automação de navegador.

### 10.1. O developer token deixou de existir

> **Revisão de novembro de 2026.** A decisão anterior — "o developer token é sempre da
> organização, nunca da tria" — **não é mais aplicável**: o Google
> [encerrou os developer tokens em 9 de setembro de 2026](https://developers.google.com/google-ads/api/docs/get-started/dev-token).
> O acesso passou a ser gerido **por projeto do Google Cloud**, e o token enviado no cabeçalho
> é ignorado pelos servidores da API.

O que mudou na prática:

| Antes | Agora |
| --- | --- |
| Token emitido dentro de uma conta administradora (MCC) | Acesso concedido ao projeto Cloud que habilita a API |
| Cada organização precisava do próprio MCC para operar | **Nenhum MCC é exigido para acessar a API** |
| Quota amarrada ao token da organização | Quota amarrada ao projeto — o da tria |
| Níveis Test · Basic · Standard | Test · Explorer · Basic · **Standard (ilimitado)** |

Como o acesso é do projeto, ele é necessariamente da plataforma. A preocupação que motivava
a regra antiga — concentração de quota e de risco — se resolve por outros meios:

1. **Quota deixa de ser escassa no nível Standard**, que não tem teto diário de operações.
   Até lá, Basic entrega 15.000 operações por dia.
2. **Contabilidade por organização.** O consumo é medido e limitado por organização dentro da
   plataforma, para que uma operação não consuma a fatia das outras.
3. **Projeto próprio como opção empresarial.** Quem exigir isolamento formal pode trazer o
   próprio projeto Cloud e o próprio cliente OAuth. É atrito alto e fica como exceção, não
   como padrão.

O que **continua** sendo da organização: as contas de anúncio, a autorização que as alcança e
o direito de revogá-la a qualquer momento.

### 10.2. Dois tipos de organização, zero pré-requisito

| Tipo | Quem é | O que precisa antes de conectar |
| --- | --- | --- |
| `agency` | Opera contas de clientes | Nada. O acesso de parceiro é concedido pelo cliente durante o fluxo |
| `advertiser` | Opera as contas da própria empresa — de uma operação a um time inteiro, com várias marcas | Nada |

Nenhum dos dois precisa de MCC, de developer token ou de Business Manager para começar. O
onboarding é: clicar em conectar, autorizar na própria plataforma, escolher as contas.

**O que a tria registra não é um token: é um aplicativo.**

| A tria tem | A organização tem |
| --- | --- |
| Projeto Cloud com acesso à Google Ads API e app OAuth verificado | As contas de anúncio |
| App na Meta com Business Verification e App Review | A autorização que as alcança |
| Cofre que guarda o segredo de cada autorização | O direito de revogar a qualquer momento |

### 10.3. Os caminhos de ligação

**Google Ads**

| Caminho | Quando usar | Como funciona |
| --- | --- | --- |
| **OAuth do titular** | Sempre — é o caminho padrão | O titular autoriza com a conta Google dele, concedendo o escopo `.../auth/adwords`. A tria chama `ListAccessibleCustomers`, que devolve as contas de **acesso direto**, e percorre cada uma com `customer_client` para descobrir a árvore abaixo |
| **Convite de acesso** | Conta que ainda não está sob a administradora da organização | A organização convida a conta do cliente para o próprio MCC. Aceito o convite, ela aparece na descoberta sem nova autorização |

> `ListAccessibleCustomers` é uma das poucas chamadas que não exige `customer_id` e **ignora**
> o cabeçalho `login-customer-id`. Para as demais chamadas dentro de uma hierarquia, o
> `login-customer-id` identifica a administradora pela qual se opera.

**Meta Ads**

| Caminho | Quando usar | Como funciona |
| --- | --- | --- |
| **Facebook Login for Business** | Sempre — é o caminho padrão | O titular autoriza pelo fluxo oficial e a tria recebe um **token de usuário do sistema de integração**, que por padrão **não expira** e carrega o id do negócio do cliente. Não depende de ninguém reautenticar |
| **Parceria entre Business Managers** | Agência que já opera o BM do cliente | O cliente concede acesso de parceiro e atribui os ativos. A descoberta enxerga o que a agência enxerga |

> No Login for Business as permissões vêm de uma **configuração** criada no painel do app, e o
> parâmetro `config_id` **substitui** o `scope`, que não deve ser enviado. É por isso que a
> URL de autorização do Meta na tria não carrega escopo.

> Em nenhum caminho a tria pede a senha do cliente, usa token pessoal de operador ou
> automatiza navegador. Token pessoal morre quando a pessoa sai da empresa — é por isso que
> o padrão é usuário do sistema.

### 10.4. Fluxo de conexão, em cinco passos

Vale para qualquer plataforma e qualquer tipo de organização:

1. **Autorizar** — o titular passa pelo consentimento oficial. A tria recebe um *grant*,
   não uma conta.
2. **Descobrir** — a tria percorre a hierarquia e lista tudo que aquele grant alcança: no
   Google, a árvore do MCC; na Meta, os ativos do Business Manager.
3. **Selecionar** — a pessoa escolhe quais contas entram na plataforma e em qual cliente e
   grupo cada uma fica. Contas sem gasto aparecem marcadas, mas não entram por padrão.
4. **Validar** — existência, moeda, fuso, permissão de leitura de métricas, permissão de
   gestão e validade longa do token. Falha em qualquer item bloqueia a conclusão e registra
   o motivo.
5. **Monitorar** — a partir daí a conexão tem saúde própria: validade do token, última
   sincronização, erros de permissão e mudanças na hierarquia.

> **Um grant rende N contas.** `connections` e `ad_accounts` são tabelas diferentes
> justamente por isso: uma autorização descobre dezenas de contas, e cada conta pode ter o
> próprio destino dentro da plataforma.

### 10.5. Escopos pedidos

O pedido é o mínimo necessário para operar de verdade — e não mais que isso.

| Plataforma | Escopo | Para quê |
| --- | --- | --- |
| Google | `adwords` | Ler métricas e **gerenciar** campanhas, orçamentos, públicos e palavras-chave |
| Google | `datamanager` | Público semelhante e conversão offline (closed-loop da seção 10) |
| Google | `analytics.readonly` | GA4 como fonte confirmada de conversão |
| Google | `content` | Merchant Center — saúde do feed para Shopping e PMax |
| Meta | `ads_read` | Ler campanhas, conjuntos, anúncios e insights |
| Meta | `ads_management` | Criar e alterar campanhas, orçamentos e criativos |
| Meta | `business_management` | Enxergar os ativos do Business Manager e a estrutura |
| Meta | `leads_retrieval` | Puxar os leads dos formulários — sem isso o closed-loop não fecha |

Nunca são pedidos escopos de faturamento, de cobrança ou de leitura de dados pessoais além
do necessário para as audiências autorizadas pelo cliente.

> **GA4 e GTM não usam o mesmo consentimento.** Dependem de uma conta de serviço adicionada
> à propriedade pelo próprio cliente. É um passo extra e explícito no onboarding, com o
> e-mail da conta de serviço exibido para copiar.

### 10.6. Ciclo de vida da credencial

| Estado | O que significa | O que a plataforma faz |
| --- | --- | --- |
| `active` | Token válido, sincronizando | Opera normalmente |
| `expiring` | Vence em menos de 30 dias | Avisa o responsável e tenta renovar sozinha |
| `degraded` | Perdeu permissão em parte dos ativos | Mantém o que funciona, marca o resto e abre pendência |
| `revoked` | Cliente revogou ou token morreu | Suspende sincronização e **congela as iniciativas daquelas contas no Kanban**, com o motivo no card |
| `reauth_pending` | Link de reautorização enviado | Mostra prazo e lembretes enviados |

A renovação roda como job, não como reação ao erro. Quando a reautorização depende do
cliente, a plataforma gera um link de autorização com validade, envia e acompanha o status —
o cliente autoriza sem precisar ver a operação interna da agência.

A hierarquia é **ressincronizada periodicamente**: conta nova no MCC aparece como sugestão,
conta removida pelo cliente é marcada como perdida em vez de sumir silenciosamente.

### 10.7. Armazenamento e auditoria

- Segredo vive no **Secret Manager** do provedor de nuvem. No PostgreSQL ficam apenas a
  referência, os metadados (escopos concedidos, validade, quem autorizou, quando) e o estado.
- Chave por organização, de modo que um vazamento de uma não alcance as outras.
- Todo uso de credencial é auditável: qual conexão, qual conta, qual operação, qual ação do
  agente ou pessoa originou.
- O agente **nunca** recebe a credencial. Ele produz ação estruturada; quem assina a chamada
  é o serviço de execução.

### 10.8. Modelo de dados

```
integrations.connections                  a autorização, não a conta
  id · organization_id · platform (google|meta)
  grant_type      mcc | oauth_user | bm_partner | system_user
  owner           organization | platform        de quem é o app/token usado
  external_id     id do MCC, do Business Manager ou do usuário
  scopes[]        escopos efetivamente concedidos
  secret_ref      ponteiro para o Secret Manager — nunca o segredo
  status          active | expiring | degraded | revoked | reauth_pending
  expires_at · last_refreshed_at · authorized_by → users · authorized_at

integrations.connection_accounts          o que cada grant descobriu
  connection_id · external_account_id · discovered_at
  state           discovered | linked | ignored | lost
  ad_account_id → ads.ad_accounts          quando foi efetivamente ligada

integrations.credential_audit
  connection_id · used_by (service|agent|user) · operation · at · result
```

`organizations` ganha `type (agency | advertiser)`, `manager_account_id`,
`business_manager_id`, `developer_token_ref` e `developer_token_level` — preenchidos para
**toda** organização, não só para agências.

### 10.9. Sequenciamento, sem atalho

As aprovações externas têm prazo e não dependem de código:

Tudo que depende de aprovação é **da tria, uma vez só**. Nenhum pré-requisito recai sobre o
cliente.

| Pré-requisito | Prazo e critério |
| --- | --- |
| Projeto Cloud com a Google Ads API habilitada | Imediato — concede nível **Test** |
| Subir para **Explorer** | Revisão automática na maioria dos casos · 2.880 operações/dia em produção |
| Subir para **Basic** | Exige verificação de marca · 15.000 operações/dia |
| Subir para **Standard** | Auditoria manual, cerca de 10 dias úteis · sem teto diário |
| Verificação do app OAuth do Google | O escopo `.../auth/adwords` é **restrito**: sem a verificação, a tela de consentimento fica em modo de teste e o refresh token **expira em 7 dias** |
| App da Meta com Business Verification | Pré-requisito do App Review |
| **Advanced Access** no Meta para `ads_read` e `ads_management` | Obrigatório para gerenciar contas de **outros** negócios — exatamente o nosso caso. O Standard Access, concedido automaticamente, não cobre isso |
| Configuração do Login for Business | Define as permissões e gera o `config_id` |

> Dois limites do Google que o desenho precisa respeitar: o consentimento em modo de teste
> derruba o refresh token em 7 dias, e há um teto de **100 refresh tokens por conta Google por
> cliente OAuth** — autorizar repetidamente invalida o mais antigo.

Enquanto as aprovações correm, o desenvolvimento segue com conta de teste e com o caminho
de MCC de uma agência piloto — que já funciona antes de qualquer verificação pública, porque
não envolve consentimento de terceiros.

---

## 11. Camada de dados e evidência

Esta é a camada que separa "plataforma com IA" de **AdTech data-driven**. Sem ela, o agente
analisa números que não são verdade e aprende com ruído.

### 11.1. Fonte da verdade da conversão

Meta reporta 100 compras, Google reporta 80, o e-commerce faturou 120. Somar dá 180 e está
errado — as plataformas se auto-atribuem e se sobrepõem.

A plataforma trabalha com dois números, sempre visíveis lado a lado:

| Número | Origem | Para que serve |
| --- | --- | --- |
| **Declarado** | Pixel/tag da própria plataforma (Meta, Google) | Otimizar dentro de um canal, onde o algoritmo da plataforma decide |
| **Confirmado** | GA4, CRM, ERP ou e-commerce | Decidir entre canais, medir resultado real e falar com o cliente |

Regras:

- Nenhuma recomendação de **realocação entre plataformas** pode usar número declarado.
- A reconciliação roda diariamente e registra o desvio por canal
  (`metrics.reconciliation`). Desvio acima do limite configurado vira alerta e **suspende**
  recomendações de orçamento daquele cliente.
- O modelo de atribuição é configurável por cliente (último clique, data-driven, janela
  própria) e fica gravado junto da métrica, não implícito no código.

### 11.2. Granularidade e dado que muda depois

Métrica de mídia **não é imutável**. Conversão com janela de 7 dias continua chegando dias
depois; as plataformas reprocessam e reafirmam números antigos.

- Granularidade mínima armazenada: conta → campanha → conjunto → anúncio, mais termo de
  pesquisa e público, por **dia**.
- **Rejanela obrigatória:** toda sincronização reimporta os últimos 28 dias, não apenas o dia
  anterior.
- Toda linha de métrica tem chave natural idempotente
  (`account_id + entity_id + date + metric_version`) — reimportar nunca duplica.
- `metrics.restatements` guarda a mudança: valor anterior, valor novo, quando mudou. Se a
  base de uma decisão mudou, a avaliação daquele aprendizado é **recalculada**.
- Fuso e moeda são da conta, não do servidor. Comparação cross-account normaliza os dois.

### 11.3. Baseline antes de anomalia

"CPL subiu 48% em 7 dias" contra os 7 dias anteriores dispara em toda segunda-feira, todo
feriado e toda virada de mês. Alerta falso em duas semanas faz o gestor desligar o sistema.

- Cada métrica relevante tem **baseline sazonal** (dia da semana, semana do mês, feriado) com
  banda de confiança.
- Só vira anomalia o que sai da banda **e** tem volume mínimo.
- O diagnóstico decompõe a variação: CPA subiu por CPM, por CTR, por taxa de conversão ou por
  ticket médio? Sem essa decomposição, a "causa provável" é chute.

### 11.4. Significância antes de conclusão

"Teste contínuo" sem estatística é ruído com nome bonito. Pausar um criativo com 40 cliques
não significa nada.

- Todo teste declara antes: métrica, efeito mínimo detectável, amostra necessária e duração
  mínima.
- Nenhuma recomendação de pausa ou corte é emitida abaixo do volume mínimo de conversões do
  cliente — o agente responde "ainda não há dado suficiente", que é uma resposta válida.
- Fase de aprendizado da campanha e ciclo de compra do negócio entram na conta.

### 11.5. Incrementalidade

ROAS 8x em remarketing de carrinho é, em boa parte, venda que aconteceria sem anúncio. Uma IA
que maximiza ROAS declarado converge para marca e remarketing e **mata o crescimento do
cliente em três meses**.

- Campanhas são classificadas entre **aquisição** e **colheita** (marca, remarketing,
  catálogo quente). As metas são diferentes.
- Suporte a **geo holdout**: desligar praças selecionadas por um período e medir a diferença.
- O resultado de incrementalidade entra como fator na realocação de orçamento. É o item que
  Optmyzr não tem e que Albert promete sem mostrar.

### 11.6. Closed-loop: o lead que fecha

Para cliente de geração de leads, CPL sem status do lead é métrica enganosa — a campanha mais
barata costuma trazer o lead que não fecha.

- Ingestão de status do lead vindo do CRM: `lead → qualificado → oportunidade → venda`, com
  valor.
- Métricas derivadas: custo por lead qualificado, custo por venda, receita por canal e taxa de
  aproveitamento por campanha.
- Envio de conversão offline de volta às plataformas (Enhanced Conversions, Conversions API),
  para que o algoritmo otimize pelo que importa.

> Por isso o CRM **sobe** na fila de integrações: o diferencial declarado é "IA que entende a
> finalidade comercial", e sem closed-loop esse diferencial não se sustenta.

### 11.7. Avaliação do próprio agente

O documento diz que a autonomia Assistida é liberada "depois de validar a qualidade das
recomendações". Isso precisa de número, não de impressão.

Painel de qualidade do agente, por cliente e consolidado:

| Métrica | O que mede |
| --- | --- |
| Taxa de aprovação | % de recomendações aceitas pelo gestor |
| Taxa de acerto | % de ações executadas com resultado positivo na verificação |
| Tempo até impacto | Quanto demora para o efeito aparecer |
| Precisão de pesquisa | % de afirmações com fonte válida e verificável |
| Reversões | % de ações revertidas |
| Custo por recomendação aceita | Tokens e chamadas de API por recomendação útil |

**Regra de promoção de autonomia:** o nível só sobe quando essas métricas passam de um limiar
definido, com volume mínimo de casos. Autonomia não se concede por confiança — se concede por
histórico medido.

### 11.8. Contexto versionado

Toda decisão guarda o **snapshot** dos dados que a sustentaram: período, métricas, baseline e
versão do contexto do cliente. Se o dado for reafirmado depois (9.2), dá para saber se a
decisão foi boa com a informação disponível na hora — e se continuaria boa hoje.

### 11.9. Criativo por elemento

O Albert se limita a comparar ativos existentes. É pouco: no Meta, a maior parte da variação
de performance está no criativo.

- Biblioteca de criativos com desempenho por **elemento**: gancho, formato, oferta, duração,
  prova social, call to action.
- Fadiga medida por frequência **e** por queda de CTR contra o próprio baseline do criativo.
- Briefing gerado a partir do que comprovadamente funciona naquela conta e no vertical.

Não é preciso gerar arte. Basta estruturar o que funciona.

### 11.10. Benchmark interno com privacidade

"Identifica padrões sem expor dados confidenciais" é intenção. O mecanismo é:

- Benchmark só é exibido com **mínimo de 5 contas** no recorte (k-anonymity).
- Nunca exibir valor que permita derivar a conta de origem (sem mínimo, máximo ou outlier
  identificável).
- O Portfolio Intelligence Agent recebe o recorte agregado, nunca as linhas brutas de outro
  cliente.
- O dado agregado da carteira ao longo do tempo é o **ativo proprietário** da plataforma:
  benchmark por vertical, por ticket e por região. É o que nenhum concorrente consegue copiar.

---

## 12. Execução segura e limites operacionais

### 12.1. Idempotência e reversão

- Toda ação carrega **chave de idempotência**. Retry de API não pode aumentar o orçamento duas
  vezes.
- Antes de executar, grava-se o **snapshot do estado anterior** do recurso — é isso que torna
  a reversão real, e não uma promessa.
- Toda ação tem reversão definida. Se não tiver, exige aprovação, qualquer que seja o nível de
  autonomia.
- Após executar, o `execution-verifier` relê o recurso na plataforma e confirma. Divergência
  abre incidente.

### 12.2. Kill switch

Botão de parada global, por agência e por cliente: congela toda execução automática
imediatamente, mantendo análise e recomendação funcionando. Disparado por pessoa ou
automaticamente quando houver inconsistência de dados, falha de sincronização ou taxa de erro
de API acima do limite.

### 12.3. Quota e rate limit

Com dezenas de contas, os limites do Google Ads e do Meta são **restrição de arquitetura**,
não detalhe de implementação. As filas do n8n são dimensionadas por janela de quota, com
prioridade: execução de ação aprovada > sincronização incremental > backfill histórico.
Falha por quota não é erro: é reagendamento.

### 12.4. Custo da inteligência

Teto de consumo por organização e por cliente, com observabilidade de custo por recomendação
aceita (9.7). Estourar o teto degrada o serviço de forma previsível — reduz frequência de
análise e desliga pesquisa externa — em vez de gerar fatura surpresa.

### 12.5. Guardrails configuráveis por categoria

Kill switch (12.2) e autonomia por nível (seção 7) são a intenção; falta o mecanismo que a
torna real — um catálogo de limites que **qualquer alteração precisa respeitar antes de ser
aplicada na conta**, venha ela de pessoa ou de agente. Referência observada funcionando
(Optmyzr "Change Requests" / "Policy Settings", nov/2026).

- **Toda alteração passa pela política, não só a do agente.** Uma edição manual de um
  analista júnior é avaliada pelas mesmas regras que uma ação do Campaign Agent — o funil de
  aprovação olha para `actor_type = user|agent|system`, não decide com base em quem é o ator.
  O módulo Automation & Governance (seção 2) aplica isso de ponta a ponta.
- **Categorias de guardrail**, cada uma com valor, enforcement e escopo:

| Categoria | Exemplos de regra |
| --- | --- |
| Orçamento | Variação máxima por edição (% ou valor absoluto); teto e piso diário; variação máxima acumulada por dia |
| Lance | Valor máximo e mínimo de lance; variação máxima por edição |
| Metas (tCPA/tROAS) | Teto e piso de CPA/ROAS alvo; variação máxima por edição |
| Palavras-chave | Termos bloqueados; tipos de correspondência permitidos; domínio de destino permitido; limite de inclusões por dia |
| Anúncios e criativos | Palavras bloqueadas no texto (alimentado pelo perfil de contexto, seção 5.6); idioma obrigatório; proibição de remover o último anúncio ativo de um grupo |
| Conta como um todo | Limiar de operação em massa; aviso em remoção permanente; limite de mudanças por dia |

- **Enforcement tem dois níveis**: `block` (impede a execução) e `warning` (executa, mas
  registra e notifica). Cada regra liga/desliga de forma independente, e pode ter **override
  por conta ou por carteira** quando o padrão da organização não se aplica a um cliente
  específico — o mesmo princípio de escopo mais específico vencendo da seção 4.
- **A regra nasce em linguagem natural, mas roda determinística.** A pessoa descreve o limite
  em texto — "nunca subir orçamento mais que 30% de uma vez no Google Ads" — e o sistema
  **compila essa frase uma única vez, no momento de salvar**, em uma checagem estruturada. É
  a checagem compilada que roda em cada execução — nunca o texto original, nunca uma chamada
  de LLM em tempo real no caminho crítico. Isso elimina custo, latência e não-determinismo
  exatamente onde eles seriam mais perigosos: decidindo se uma ação entra ou não na conta do
  cliente.
- Toda violação de política — bloqueada ou só avisada — vira evento auditável, ligando a
  ação ao ator, à regra e ao recurso (mesma trilha de `access_audit` da seção 4 e de
  `pipeline_events` da seção 6.2).

```
automation.policies
  id · organization_id · category (budget|bid|target|keyword|ad|account_wide)
  rule_key · value · enforcement (block|warning) · status (enabled|disabled)
  scope_type (organization|portfolio|client|ad_account) · scope_id
  source (structured|nl_compiled) · nl_prompt · compiled_check
  created_by → users · created_at · updated_at

automation.policy_violations
  id · policy_id · actor_type (user|agent|system) · actor_id
  resource_type · resource_id · action_payload
  enforcement_applied (blocked|warned) · at
```

## 13. Diferencial competitivo

Não queremos terminar com uma cópia funcional dos dois produtos. Precisa existir uma razão
para um gestor de tráfego preferir nossa ferramenta.

| Diferencial | Por que importa |
| --- | --- |
| IA com contexto de negócio | Não otimiza somente CTR e CPC; entende a finalidade comercial |
| Inteligência de mercado | Pesquisa antes de sugerir uma campanha |
| Multi-account AI | Identifica oportunidades em toda a carteira |
| Estratégia + execução | Vai da recomendação até a alteração na conta |
| Memória de otimizações | Aprende com o histórico de decisões e resultados |
| Controle de autonomia | A agência escolhe o quanto a IA pode operar, com um catálogo de guardrails editável por categoria (12.5), não só um dial genérico |
| Visão unificada | Consolida plataformas, clientes e investimentos |
| Benchmark interno | Identifica padrões entre operações comparáveis sem expor dados confidenciais (k-anonymity, seção 9.10) |
| **Incrementalidade** | Mede o resultado que só existe por causa do anúncio, em vez de otimizar ROAS auto-declarado (9.5) |
| **Closed-loop com CRM** | Otimiza por lead que fecha e por receita real, não por volume de lead (9.6) |
| **Autonomia que se prova** | O nível sobe por histórico medido de acerto, não por confiança (9.7) |
| **MCP nativo** | O gestor opera a conta de dentro do ChatGPT, Claude ou Gemini que já usa, sem trocar de aba — mesmo controle de política, segundo canal de entrada (9) |
| **Benchmark público como aquisição** | O dado agregado da carteira (9.10) não é só inteligência interna — vira relatório de mercado gratuito que atrai gestor novo, como a mLabs faz com o mLabs Índice |

Exemplo do comportamento desejado:

> O agente identifica que três clientes de e-commerce apresentam aumento de CPA. Investiga as
> campanhas, verifica se o aumento veio de CPM, CPC, conversão ou ticket médio, compara com o
> histórico, identifica causas prováveis e apresenta ações **diferentes para cada negócio**.
> Se houver autorização, executa as alterações e mede o resultado.

Isso é muito mais valioso do que um chatbot que responde "seu CPA aumentou 20%".

---

## 14. Roadmap de desenvolvimento

Construir em fases, com a arquitetura preparada desde o começo para o produto completo.

| Fase | Tema | Entregas |
| --- | --- | --- |
| **1** | Fundação | Autenticação Google · agência, usuários e permissões · **`members` N:N e Row Level Security** · clientes e portfólios · PostgreSQL · estrutura multi-tenant · interface base |
| **2** | Multi-account management | **Tipos de organização (agency/advertiser) · conexões por grant com descoberta de hierarquia** · importação de contas · hierarquia de contas · dashboard global · campanhas e métricas · filtros e comparações · orçamentos e alertas · **granularidade e rejanela de 28 dias · idempotência de ingestão · reconciliação declarado × confirmado** |
| **3** | Intelligence | Contexto dos clientes · histórico de campanhas · pesquisa de mercado · auditorias automatizadas · análises de desempenho · comparação cross-account · **baseline sazonal · ingestão de status do lead (CRM) · k-anonymity no benchmark** |
| **4** | AI Agent | Agent Orchestrator · agentes especializados · memória persistente · estratégias e planos de mídia · diagnósticos · recomendações estruturadas · **painel de qualidade do agente · contexto versionado por decisão** |
| **5** | Campaign Operations | Propostas de alteração · aprovações · integração de escrita nas APIs · execução pelo n8n · verificação do resultado · auditoria de ações · **chave de idempotência · snapshot e reversão real · kill switch** |
| **6** | Autonomous AdTech | Otimizações automáticas · testes contínuos · regras adaptativas · alocação de orçamento · aprendizado com resultados · gestão autônoma dentro de limites · **experimentação com significância · geo holdout e incrementalidade** |

> O desenho do agente não deve ser adiado até a fase 4: o banco, as APIs e a arquitetura devem
> estar preparados para ele desde a primeira fase. O que vamos adiar é a **autonomia de
> execução**, não a inteligência arquitetural.

---

## 15. Decisões de produto a fechar

| # | Decisão | Recomendação | Alternativas |
| --- | --- | --- | --- |
| 1 | Para quem construir primeiro | **Agências de marketing** — várias contas e clientes | Times internos de marketing · ambos desde o início |
| 2 | Plataformas no primeiro produto | **Meta Ads + Google Ads** | Só Meta · só Google · Meta, Google, TikTok e LinkedIn desde o início |
| 2b | Onde o segredo da autorização vive | **No cofre do n8n, cifrado** — a aplicação guarda só a referência | Coluna cifrada no Postgres · segredo em memória da aplicação |
| 3 | Como a IA deve operar inicialmente | **Recomenda e aguarda aprovação** | Executa automaticamente ações de baixo risco · autonomia ampla desde o início |
| 4 | Mercado a atender primeiro | **Leads e e-commerce** | Só geração de leads · só e-commerce |
| 5 | Fonte da verdade da conversão | **Confirmado (GA4/CRM) decide entre canais; declarado otimiza dentro do canal** | Só declarado · só confirmado |
| 6 | Instalação | **Multi-tenant desde o início** — uma base, várias agências | Instância por agência · uso interno apenas |
| 7 | Cobrança | **Por assento (`seat_type`) + faixa de verba sob gestão** | Por conta conectada · por volume de ação do agente · por marca/conta gerenciada, sem limite de usuário (modelo mLabs — simples de vender, mas desalinha preço de custo de IA por pessoa) |
| 8 | Prioridade do CRM | **Subir para a fase 3** — sustenta o diferencial de contexto comercial | Manter como "posteriormente" |
| 9 | ~~Developer token do Google~~ | **Decisão revogada em nov/2026** — o Google encerrou os developer tokens; o acesso é do projeto Cloud da tria. Isolamento passa a ser por contabilidade de quota por organização | Projeto Cloud próprio por organização, como exceção empresarial |
| 10 | Anunciante direto | **Loga com a conta Google normal e conecta direto** — sem MCC, sem token, sem pré-requisito | Exigir estrutura antes de conectar |
| 11 | Rede e filial | **`parent_client_id` no cliente** — a filial é cliente, a rede é o pai. Carteira e hierarquia ficam em eixos separados | Usar portfólio como rede · filial como grupo de contas |
| 12 | Pessoa em várias organizações | **Seletor de contexto**, sem visão somada entre organizações | Visão consolidada cross-agência |
| 13 | Amazon Ads e Microsoft Ads | **Avaliar para a fase 3**, como extensão do Rule Engine/guardrails (12.5) — não bloqueante pro MVP Meta+Google | Ficar só em Meta+Google indefinidamente · entrar desde a fase 2 |

Próximo passo após fechar: criar o PRD.

---

## 16. Visão final

Vamos cobrir os dois mundos:

- **Do Optmyzr:** administrar uma operação inteira, com múltiplos clientes, contas, campanhas,
  métricas, regras e ações em escala.
- **Do Albert:** uma inteligência que analisa, decide, testa, redistribui recursos e executa
  otimizações continuamente.
- **Nossa vantagem:** acrescentar contexto de negócio, pesquisa de mercado e planejamento
  estratégico integrado à operação.

O produto que estamos desenhando é uma **plataforma de operação de mídia paga orientada por
IA**, não apenas uma ferramenta de PPC.

E uma quarta coisa, que não vem de nenhum dos dois: **o dado agregado da carteira ao longo do
tempo**. Benchmark por vertical, por ticket e por região, construído com privacidade
(seção 9.10), é o ativo que nenhum concorrente consegue copiar e que melhora sozinho a cada
cliente novo.

> **Observação importante:** o plano técnico é viável, mas APIs de publicidade, aprovações de
> acesso, quotas, revisão de aplicativos e custos de modelos de IA serão dependências reais.
> Construir por etapas e validar cada integração antes de prometer autonomia.

> **Princípio que sustenta o resto:** a plataforma só é *data-driven* se o número que o agente
> usa for defensável. Fonte da verdade, baseline, significância e incrementalidade (seção 9)
> não são refinamento de fase 6 — são a condição para que qualquer recomendação valha alguma
> coisa.
