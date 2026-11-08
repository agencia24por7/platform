# tria — protótipo navegável

Protótipo em HTML/CSS/JS puro da plataforma descrita em [`new_specs.md`](new_specs.md).
Sem build, sem dependências.

```bash
python3 -m http.server 4321
# http://localhost:4321/index.html
```

## O que este protótipo demonstra

1. **Campanha de marketing como entidade** — a iniciativa acima das campanhas de plataforma,
   com Kanban cujas colunas são os próprios agentes.
2. **Acesso N:N via `members`** — um usuário gerencia N contas, uma conta é gerenciada por N
   usuários. Trocar o perfil no topo muda o que a tela inteira enxerga. Concessão na rede ou
   na carteira desce para o que está abaixo.
3. **Camada de dados** — conversão declarada × confirmada, divergência por cliente, baseline
   na linguagem do diagnóstico, qualidade medida do agente.
4. **Conexão no padrão do mercado** — grant ≠ conta: uma autorização descobre N contas. Duas
   organizações no mock (`agency` e `advertiser`), e em ambas **o developer token é da
   organização, nunca da tria**.

## Telas

**Agência**

| Rota | Tela |
| --- | --- |
| `#/login` | Entrada |
| `#/dashboard` | Command Center — KPIs, fluxo do Kanban, portfólios, saúde do dado |
| `#/portfolios` · `#/portfolios/:id` | Carteiras, hierarquia e benchmark interno |
| `#/clients` · `#/clients/:id/{visao,iniciativas,campanhas,investimento,contexto,acessos}` | Carteira e ambiente do cliente (a aba **acessos** mostra a resolução de `members`) |
| `#/accounts` · `#/accounts/:id/{visao,campanhas,auditoria,conexao}` | Contas de anúncio, MCC/Business Manager, auditoria com nota |
| `#/accounts/bulk` | Operações em massa com pré-visualização |
| `#/connections/:id` | **Gerenciamento de conexões do cliente** — tokens, escopos, erro, link de autorização |
| `#/onboarding` · `#/onboarding/:id` | **Onboarding em 6 passos** (dados, portfólio/modelo, conexões, contas, contexto, agente) |
| `#/marketing/_/{kanban,lista,pipeline}` | **Kanban de campanhas de marketing** |
| `#/marketing/:id/{fluxo,campanhas,resultado,briefing}` | Detalhe da iniciativa |
| `#/campaigns` | Campanhas de plataforma |
| `#/investments` | Verba planejada × realizada e fee |
| `#/performance/_/{cross,anomalias,oportunidades,dados,auditorias}` | Performance Intelligence + pergunta cross-account |
| `#/agent` | Agente IA — os 7 agentes, fila e aprendizados |
| `#/agent/:id/{conversar,pesquisa,estrategia,otimizacoes,execucoes,aprendizados,configuracoes}` | Agente por cliente |
| `#/approvals` · `#/automations` · `#/reports` · `#/audit` | Governança |
| `#/settings/_/{organizacao,membros,papeis,agente,integracoes,infra}` | Configurações — **organização** mostra MCC, developer token e pré-requisitos; **membros** mostra cada linha de `members` |

**Cliente final** — `#/portal` e `#/portal/{campaigns,investments,performance,reports,agent}`

## O Kanban

As 9 colunas são as etapas do pipeline, e cada uma é um agente (ou um portão humano):

```
[H] Briefing → [A] AI Orchestrator → [A] Market Research → [A] Strategy →
[H] Aprovação → [A] Campaign Agent → [A] Policy & Execution →
[A] Performance Agent → [A] Portfolio Intelligence
```

O card mostra cliente, plataformas, nº de contas, campanhas filhas, verba, meta, tempo na
coluna contra o SLA e a **ação pendente** — agêntica (com indicador de atividade), manual
(com botão e responsável) ou bloqueio (com motivo). Botões de ação manual movem o card de
verdade e gravam um `pipeline_event`.

Filtros combináveis: cliente, conta, portfólio, plataforma, gestor e origem (agente × manual).
Dois agrupamentos: **por agente** (Kanban) e **por cliente** (raias). A visão padrão é o
escopo do `member` logado.

## Dois eixos de agrupamento

| Eixo | Entidade | De quem é | Serve para |
| --- | --- | --- | --- |
| **Carteira** | `portfolios` | Da agência | Escopo por equipe, benchmark e consolidação interna |
| **Hierarquia** | `clients.parent_client_id` | Do cliente | Rede → filial. A filial tem verba, meta, contas e acesso próprios |

Uma filial pertence à rede *e* à carteira de um gestor ao mesmo tempo — por isso são campos
separados. O portfólio é opcional (o anunciante direto no mock não usa).

## Perfis para testar

| Usuário | Papel | Enxerga |
| --- | --- | --- |
| Bruno Abreu | owner | 10 clientes · 22 contas · 16 iniciativas |
| Rafael Lima | manager | 6 clientes · 14 contas · 11 iniciativas (portfólio + 1 cliente + 1 conta de outra carteira como analista) |
| Juliana Reis | manager | 4 clientes · 7 contas · 6 iniciativas |
| Letícia Nunes | partner | 2 contas, acesso expirando em 40 dias |
| Ana Prado | client | só o portal da Loja Flora |
| Paulo Serra | owner (`advertiser`) | organização própria: 2 negócios, 3 contas, MCC e token próprios |
| Sandra Bastos | client | 2 unidades da rede — o portal oferece o seletor de negócio |
| Helena Vasques | client | acesso na rede-mãe: alcança as 6 filiais sem uma linha por unidade |
| Vitor Caldas | analyst em 2 orgs | consultor — troca de organização no topo, sem visão somada entre elas |

## Estrutura

```
index.html
assets/css/tokens.css      design tokens (branco + verde e azul escuros)
assets/css/app.css         componentes, Kanban, raias, pipeline
src/core/                  rng · format · icons · charts · ui · store · router · shell
src/data/seed.js           DB por schema: core · integrations · ads · metrics · agent · automation
src/data/repo.js           camada de consulta, incluindo resolução de escopo por members
src/modules/
  command-center/          dashboard · portfolios
  accounts/                clients · accounts · connections · onboarding
  operations/              marketing (Kanban) · campaigns · investments
  performance/             performance
  agent/                   agent
  governance/              approvals · automations · audit · reports · settings
  client-area/             portal
  auth/                    login
src/app.js                 render + delegação de eventos + modais
```

## Reaproveitamento na construção real

- **`tokens.css`** vira o `theme` do Tailwind quase 1:1.
- **`seed.js`** é o contrato de dados: `DB.core.members`, `DB.ads.marketingCampaigns`,
  `DB.agent.pipelineStages/pipelineEvents`, `DB.metrics.reconciliation` etc. seguem os nomes
  dos schemas da spec — serve como seed do banco e fixture de teste.
- **`repo.js`** é a camada de agregação e **a resolução de permissão**: `scope(userId)`,
  `roleOn(userId, scopeType, scopeId)`, `board(filters)`, `totals/series/delta`, `kpiSet`.
  Vira `lib/` com as mesmas assinaturas, trocando filtro em memória por SQL + RLS.
- **`modules/*`** definem a composição de cada rota — é a especificação visual das páginas.

## Dados do mock

Determinístico (seed `20261107`), referência 07/11/2026:
**2 organizações** (agência e anunciante direto) · 12 usuários · **19 linhas de `members`**
nos 4 escopos · 3 carteiras · **19 clientes, incluindo uma rede com 6 filiais**
(`parent_client_id`) · **6 autorizações** nos 4 caminhos de grant · **35 contas** ·
**19 campanhas de marketing**, uma delas de rede inteira (`scope_type = client_tree`)
distribuídas nas 9 etapas · 57 campanhas de plataforma · **5.130 linhas de métrica diária**
com conversão declarada e confirmada · 76 eventos de pipeline · 22 auditorias de conta ·
7 agentes · 6 recomendações · 4 planos de mídia · 5 aprendizados · 10 execuções de n8n.

Sinais plantados de propósito: 4 campanhas com gasto e zero conversão, 14 limitadas por
orçamento, 2 contas com token expirado, 1 onboarding parado no passo 3, 1 iniciativa
bloqueada por contexto em 38%, 3 cards fora do SLA no briefing e 2 na aprovação.

Aprovar, recusar ou mover um card altera o estado em memória e reflete nas outras telas —
recarregar volta ao estado inicial.
