---
status: proposed
date: 2026-11-24
---
# ADR-0056: Strategy Plan é um registro versionado que lê o Brain por ponteiro e muda por revisão proposta

Complementa os ADRs 0001, 0005, 0008, 0026, 0030, 0041, 0043 a 0046, 0049, 0051 e 0053. Não supera nenhum. Issue 24K-116. Status `proposed` até o dono do produto aceitar; a numeração 0056 é a seguinte a 0055 em `dev` e deve ser conferida de novo antes do merge.

## Contexto
O diagrama do produto tem Brain, Strategy Plan, Comitê, Gate, Execução e Strategy Metrics. Em código existem Brain (ADR 0026, 0030, 0050), regras, limites e decisões imutáveis (ADR 0051), auditoria (ADR 0049) e a fila de tarefas de conta com executor por conexão (ADR 0005). Não existem plano, Comitê, Gate, registro de experimento nem agente de produto em execução.

A pesquisa de 2026-11 (Silvio Meira, Kotler, Ritson, Sharp, Porter, Rumelt, Mintzberg, Helmer, e práticas de ads em EUA, China, Ásia, Brasil, Europa e Oriente Médio) deixou três fatos que moldam a decisão:
1. Quase toda evidência publicada sobre ads vem de quem vende ads. Os estudos sólidos são poucos (Gordon et al. 2019; Lewis e Rao 2015; Blake et al. 2015; custo do ATT). Plano sem nota de evidência vira teatro de planejamento.
2. Plataformas, canais e modelos de IA mudam em meses. As lentes de estratégia mudam em décadas. Misturar as duas no código envelhece o produto.
3. O diagrama não fecha o laço: falta a seta de Strategy Metrics de volta ao Strategy Plan, e o Comitê está ambíguo.

## Decisão

### 1. O plano é dado, não código
Um plano é um registro versionado, agnóstico ao cliente, com estas seções (tipadas, validadas por esquema versionado, `schema_version` no registro):
- **Intenção:** aspiração, horizonte, nível de ousadia, retorno esperado e outros inputs declarados por pessoa (cada um com autor e data).
- **Diagnóstico** (Rumelt/Ritson): situação, obstáculo crítico, tipo de categoria, maturidade de dados e de comunidade do cliente.
- **Política:** a abordagem escolhida e **`nao_faremos[]`** (Porter), cada item com teste de violação avaliável.
- **Hipóteses**, o objeto central: afirmação, premissas, evidência a favor e contra (cada uma por ponteiro, §3), métrica, limiar, data de checagem, gatilho de revisão, status.
- **Apostas:** ações coerentes com a política, cada uma ligada a hipóteses, a metas e a classe de ação (§6), com orçamento mínimo viável do teste.
- **Árvore de metas:** da meta de negócio até a meta de canal, com previsto e janela de medição.
- **Cadência e gatilhos:** calendário e condições de revisão (desvio de métrica, evidência vencida, mudança material no Brain, decisão ou regra nova).
- **Deliberada × realizada** (Mintzberg): o que foi planejado e o que de fato se fez, lado a lado, preenchido pelo laço de medição.

O **tipo de plano** (por exemplo `aquisicao`, `marca`, `comunidade`, `retencao`) é configuração: quais seções são obrigatórias, quais lentes se aplicam, quais tipos de entrada do Brain assina e quais checagens do Gate valem. Tipo novo é inserir configuração, não escrever fluxo.

### 2. Versão imutável e ciclo de vida
Molde do ADR 0051. Um plano tem identidade estável por cliente e tipo; cada mudança é uma **versão nova** com `supersedes_id`. Versão não se edita nem se apaga.
- Estados: `rascunho` → `proposto` → `vigente` → `superado` | `revogado`; `proposto` → `rejeitado`.
- Uma versão vigente por plano (índice único parcial). Superar é transacional: a nova nasce vigente e a anterior vira `superada` na mesma transação.
- **Agente cria `rascunho` e `proposto`.** Tornar vigente, revogar e rejeitar é do Comitê **somente dentro de uma política de autonomia** assinada por pessoa (§5); fora dela exige pessoa com permissão, com `actor_kind = usuario` e membro vivo, conferido por gatilho no banco como no ADR 0051 §4. A origem `agente` é fixada no servidor, nunca pelo corpo. A autonomia do Comitê nunca cria, aumenta nem revoga limite ou regra do ADR 0051.
- Eventos em tabela só de acréscimo; o `status` muda só por gatilho disparado pelo evento.
- Mesmos recortes de acesso dos ADRs 0041, 0043 a 0045: RLS ligada e forçada por `app.organization_id` e `app.client_ids`; cascata a partir do cliente.

### 3. Brain vivo: ponteiro, hash e revisão proposta
- Evidência e premissa do plano citam o Brain por **URN** (`orla:{org}:{cliente}:{tipo}:{id}`, ADR 0026) e guardam o `contentHash` visto na versão. Nunca copiam o texto.
- Cada tipo de plano **assina tipos de entrada** do Brain, não provedores. Quando um provedor novo (por exemplo, o serviço de pesquisa de mercado) cataloga entradas de um tipo assinado, o planning as enxerga na próxima leitura sem código novo.
- Quando o manifest do Brain muda, um avaliador **determinístico** (sem IA) calcula: (a) planos vigentes que citam URN cujo hash mudou ou que foi removido; (b) planos cujo tipo assina um tipo de entrada com entrada nova; (c) decisão ou regra nova do ADR 0051 que colide com `nao_faremos[]`, apostas ou metas.
- O impacto é classificado: `nenhum`, `informativo` (anotação na versão, sem revisão) ou `material` (abre **pedido de revisão**). Material é: hash de evidência de hipótese mudou; limite duro novo ou alterado; regra nova em `etica_marca`, `segmento` ou `governanca`; evidência vencida; entrada nova de tipo assinado que o tipo de plano marca como `pode_invalidar`.
- Pedido de revisão cria um `rascunho` de versão nova com as diferenças e o motivo. **O plano vigente nunca muda sozinho.** Um plano vigente com impacto material pendente é exibido como `desatualizado`, e o Gate recusa nova aposta dele até a revisão ser decidida.
- Custo: o avaliador roda por evento do manifest, com debounce por `hashDoConjunto`. IA só é chamada depois de impacto `material`, com orçamento de chamadas por plano e por dia.

### 4. Catálogo de Conhecimento: três camadas, velocidades diferentes
1. **Lentes** (décadas): Rumelt, Porter, Mintzberg, Sharp, Ritson, Helmer, AEIOU e efeitos de rede (Meira). Cada lente é uma entrada de catálogo que declara os campos e as perguntas que acrescenta ao diagnóstico, às hipóteses e ao Gate.
2. **Práticas e plataformas** (meses): cada plataforma é uma entidade com capacidades (circuito fechado de atribuição, pagamento nativo, objetivo de otimização, nível de acesso à API); cada prática tem maturidade (`rumor`, `piloto`, `validado`) e jurisdição.
3. **Regras legais e de plataforma** (por vigência): fonte, vigência, jurisdição e **data da última verificação**. Exemplos: ECA Digital, Anexo X do CONAR, cookies de publicidade (ANPD), Consent Mode v2.

Toda entrada de evidência ou benchmark do catálogo tem fonte, **nota A (primária), B (pesquisa com método), C (fornecedor), D (não verificável)**, data, mercado, `valid_until` e se foi replicada. **Nota D nunca vira meta, só hipótese a testar.** Entrada vencida não é apagada: marca como `desatualizado` os planos que a citam (mesmo mecanismo do §3).
O catálogo é **global e não guarda dado de cliente** (como `core.limit_definitions`, ADR 0051 §2: versão nova em vez de edição, `organization_id` nulo). O plano do cliente referencia o catálogo por chave e versão. Quando o serviço de pesquisa de mercado existir, ele alimenta este catálogo com a nota de evidência.
Texto raspado ou de terceiros no catálogo é **conteúdo não confiável**: passa pelo `textoSeguro` do Brain e nunca é instrução ao agente.

### 5. Comitê e Gate
- **Comitê** = painel só de agentes revisores com lentes distintas (performance, marca, risco e legal, dados e medição, comunidade). Cada revisor devolve parecer estruturado (aprova, aprova com condição, reprova, e por quê), registrado como evento. **Eco não é evidência:** pareceres que citam a mesma fonte contam como uma evidência. O Comitê decide por regra de quórum configurada no tipo de plano; reprovação de revisor de risco e legal veta.
- **Humano fora do laço, dentro da política.** Uma pessoa com permissão assina, por cliente, uma **política de autonomia** (registro imutável, no molde do ADR 0051): classes de ação que o Comitê pode aprovar sozinho, limites, tetos de ordens e validade. Só `admin` assina, e a validade é definida pelo próprio `admin` na política (obrigatória, sem prazo máximo fixo; vencida, vale como sem política). Dentro dela o Comitê torna vigente, ordena e mede sem pedir nada. A pessoa **recebe os relatórios** do Comitê (por versão, por revisão aberta, por ordem bloqueada e por veredito) e mantém veto e kill switch a qualquer momento. Sem política vigente, ou fora dela, nada fica vigente nem executa: a versão fica `proposto` e o relatório diz o que falta. A classe `irreversivel_ou_gasto_novo` só entra na política se a pessoa a listar de forma explícita.
- **Gate** = checagens determinísticas, em código, antes de uma versão ficar `vigente` e antes de cada aposta com orçamento. **Falha fechada**: checagem que não consegue rodar bloqueia (como `definicao_ausente`, ADR 0051 §8.1).
  1. Há holdout ou teste de incrementalidade planejado, com poder estatístico calculado e orçamento mínimo viável.
  2. A meta de canal é incrementalidade (iROAS ou lift); ROAS de plataforma entra só como teto.
  3. Busca de marca e retargeting estão separados da prospecção.
  4. O split marca:ativação está justificado por hipótese (60:40 é ponto de partida; B2B tende a ~46:54).
  5. Há verba de criativo com diversidade de conceito, não variação cosmética.
  6. Qualidade de sinal checada (CAPI, EMQ, consentimento); sinal ruim bloqueia o canal.
  7. Creators e comunidade entram como hipótese com holdout, sem retorno assumido.
  8. Teste de IA contra humano mede métrica de negócio, não CTR.
  9. Critérios de parada e de escala definidos antes de gastar.
  10. Toda ação respeita `avaliarAcao` (ADR 0051 §8): limite duro bloqueia; `nao_faremos[]` violado bloqueia.
  11. Toda meta e premissa decisiva tem evidência com nota; nota D em meta bloqueia.
  12. Regra legal aplicável (jurisdição, vigência, verificação) está presente e não vencida.
  Lista inicial; cada checagem é uma entrada configurável do tipo de plano, e acrescentar uma é registro e teste, não mudança de fluxo.

### 6. Execução: tarefa e escrita em conta de anúncio
Uma aposta aprovada gera **ordens de execução** de duas famílias, ambas auditadas (ADR 0049), idempotentes e ligadas à versão e à aposta. **Todas as ordens são de agente**: não há tarefa para pessoa. O que só pessoa faz (login, aceite legal, billing) aparece como ordem `bloqueada` e como item do relatório, com o que falta.
- **Ordem de trabalho de agente:** criativo, configuração, revisão e análise, registrada com agente, prazo e critério de pronto.
- **Escrita em conta:** vira tarefa na fila existente `automation.account_tasks`, executada pelo **executor da conexão** (ADR 0005), com a credencial dessa conexão. O acesso que a conexão tem e o vínculo dela com o cliente são o **teto** do que é possível, nunca uma permissão por si. Só executa um **tipo de ação registrado** (executor, classe, esquema do pedido). Regras:
  - Cada tipo de ação pertence a uma **classe**: `leitura`, `reversivel_dentro_do_teto` (por exemplo, ajustar orçamento dentro do limite vigente), `irreversivel_ou_gasto_novo` (campanha nova, mudança de objetivo, acréscimo de verba). A política de autonomia (§5) diz quais classes o Comitê aprova sozinho.
  - A primeira execução de qualquer tipo novo roda com **`validateOnly`** (já suportado, ADR 0005). Aplicar de verdade só depois do parecer do Comitê, dentro da política de autonomia, registrado no Gate.
  - Antes de cada ordem, `avaliarAcao` com o conjunto vigente. Limite duro bloqueia no servidor; o agente não decide.
  - Teto de ordens por execução e por dia por cliente, e **kill switch** por cliente e global; ordem em andamento vira `cancelada`, nunca fica presa.
  - Login, aceite legal e billing continuam inalcançáveis ao agente: se faltam, a ordem fica `bloqueada` dizendo o que falta.
  - Produção: a mudança de código segue os ADRs 0046 a 0048. Escrita em conta de cliente é operação de produto, mas **o primeiro uso real em cada plataforma e cliente exige autorização humana nomeada** para aquela operação.
- **Estado real dos executores:** só existe o de vínculo MCC do Google Ads; não existe executor Meta (ADR 0005), e o nível de acesso à Ads API da agência é o Básico (cota a verificar). Este ADR fixa o **contrato** (classe, aprovação, `validateOnly`, `avaliarAcao`, teto, kill switch). Qual é o primeiro tipo de escrita real fica para a implementação e para decisão do humano (pergunta aberta 1).

### 7. Medição fecha o laço
- **Strategy Metrics** lê o realizado (BigQuery `tria_dw`, ADR 0015) e grava, por hipótese e meta, previsto × realizado e o veredito (`confirmada`, `refutada`, `inconclusiva`). Veredito alimenta o Brain como entrada de aprendizado e abre pedido de revisão (§3) quando cruza o limiar do gatilho. **Esta é a seta que faltava no diagrama.**
- **Registro de experimento**: hipótese, tipo (holdout, geo, lift de plataforma, antes e depois), grupos, duração, poder estatístico, resultado e erro conhecido. Resultado de experimento é evidência de nota A ou B do próprio cliente, citável por URN.
- Métricas pareadas (custo e qualidade) para evitar Goodhart. Atribuição de plataforma nunca fecha hipótese sozinha.

### 8. Piloto: Credaz
- O planning lê a Credaz **só pelo Brain** e pela API de regras. Nada nesta camada chama, lê, edita ou lista conteúdo de fluxo n8n com tag `credaz` (ADR 0053 §2): coleta e execução usam o que a plataforma já tem (`ORLA · …`).
- **Não há mínimo de Brain para planejar.** O plano nasce com o que a Credaz tiver; os limites dela vêm do Brain (regras do ADR 0051) e ficam disponíveis ao planning por URN. O que falta (teto mensal, CAC máximo, regras de `segmento` e `etica_marca`) vira **lacuna visível** no diagnóstico e no relatório, nunca suposição nem valor padrão.
- **Sem limite, sem gasto autônomo.** Se `avaliarAcao` devolve `sem_regra` para a medida de uma ação com gasto (`gasto`, `custo_por_aquisicao`), a ação não é aprovável pela política de autonomia: fica `bloqueada` com o motivo "limite ausente". Ações sem gasto (leitura, análise, criativo, configuração sem efeito de verba) seguem.
- Setor regulado e o tipo de ação (§6) definem se a Credaz entra em `validateOnly` por tempo maior; a decisão é do humano.

### 9. Modelo de dados (migração própria, número a definir, sem DDL neste ADR)
- `core.strategy_plans` (identidade: cliente, tipo, `plan_type_key`), `core.strategy_plan_versions` (imutável: conteúdo jsonb validado por `schema_version`, status, `supersedes_id`, `author_kind`, `agent_id`, `agent_run_id`, `idempotency_key`), `core.strategy_plan_refs` (versão, URN, `content_hash`, papel: evidência a favor, contra, premissa), `core.strategy_plan_events` (só acréscimo: proposta, parecer, efetivada, rejeitada, revogada, revisão aberta, impacto anotado).
- `core.strategy_autonomy_policies` (imutável, por cliente: classes aprovadas, limites, tetos, validade, `decided_by` pessoa membro vivo, `supersedes_id`; revogar é evento; sem política vigente o Comitê não ativa nem ordena) e `core.strategy_reports` (relatórios entregues às pessoas).
- `core.strategy_review_requests` (evento do manifest, planos afetados, impacto, rascunho gerado), `core.strategy_experiments`, `core.strategy_execution_orders` (ordem, classe, versão, aposta, tarefa de conta, estado).
- `core.knowledge_entries` e `core.knowledge_entry_versions` (globais, `organization_id` nulo, versão nova em vez de edição, nota, validade, jurisdição, maturidade); `core.plan_type_definitions` (configuração por tipo, também versionada).
- RLS e gatilhos no molde 0060 e ADR 0051 §6; auditoria com `x-request-id`: `strategy.plan.proposed`, `activated`, `superseded`, `revoked`, `review_opened`, `order.created`, `order.blocked`; log nunca leva o conteúdo do plano.
- Porta do agente no molde do ADR 0051 §10: `workerRoute`, `Authorization: Bearer <TRIA_WORKER_TOKEN>`, `agenteId`, `execucaoId` e `idempotencyKey` obrigatórios, teto por execução e por dia, 422 para campo fora do contrato. O app não tem identidade de agente: `agenteId` é autodeclarado por chamador já autenticado e serve a rastreio, não a autoridade.

### 10. Segurança e privacidade
- Conteúdo do Brain, do catálogo e da web é **dado não confiável**; passa por `textoSeguro`; o parecer do Comitê é saída estruturada, nunca instrução executada.
- Sem dado pessoal no plano nem nos eventos. Texto livre do plano entra no roteiro de redação do ADR 0051 §7 (função de redação só do worker, cadeia de versões nos dois sentidos).
- Todo evento e ordem leva `x-request-id`; falha de auditoria não derruba o fluxo.
- Mudança que implementar este ADR toca tenant, autorização e banco: passa por `security-reviewer`, integração obrigatória.

### 11. Manutenção simples
- Um **laço genérico** (avaliar → propor → Comitê → Gate → ordenar → medir → revisar) serve a todo plano; o tipo é configuração.
- Lente, prática, regra legal, checagem do Gate e tipo de plano são **entradas**, não código. Medida de limite nova continua exigindo código (ADR 0051 §2).
- O planning **não coleta dado**: lê o Brain e o `tria_dw`. Provedor novo entra pelo Brain.
- Um job de validade marca evidência e regra vencidas e dispara o §3.
- Contratos estáveis até 2040: hipótese, evidência, decisão, métrica, guardrail, experimento. Canais, plataformas e modelos de IA ficam no catálogo, com validade.

## Fora da v1
Construir o serviço de pesquisa de mercado; novos coletores Apify e catálogo de APIs externas; alteração automática de mídia sem aprovação humana; MMM e módulos de comunidade; tela de comparação lado a lado de versões; planos de rede e filial; mercados fora do Brasil e moeda diferente de BRL (ADR 0051 §5.5); executor Meta.

## Consequências
- Plano passa a ter autoria, versão, evidência e motivo, como regras e limites já têm.
- O custo sobe no avaliador de impacto e no catálogo; o debounce por hash e o orçamento de IA limitam o gasto.
- O Gate bloqueia aposta sem incrementalidade planejada e meta com evidência nota D: parte das propostas vai voltar de revisão, e isso é o objetivo.
- Risco residual: a classificação de "mudança material" é regra de negócio e vai errar nos dois sentidos; entra com revisão humana das primeiras revisões abertas e ajuste por configuração.
- Risco residual: nota de evidência é julgamento; enquanto o serviço de pesquisa não existe, a nota é atribuída por pessoa ou por agente com revisão humana.
- Risco residual: sem humano no laço, um erro do Comitê dentro da política executa antes de alguém ler o relatório. Mitigam: política estreita e com validade, `validateOnly` no primeiro uso de cada tipo, tetos, `avaliarAcao` no servidor, kill switch e a recusa de gasto novo sem listagem explícita. Revisão adversarial do `security-reviewer` é obrigatória na implementação.
- Risco residual: a escrita em conta amplia a superfície de dano; o contrato do §6 reduz, mas não elimina, e o primeiro uso real exige autorização humana.

## Perguntas abertas
Decididas em 2026-11-24 pelo dono do produto: escrita em todas as plataformas que as conexões vinculadas ao cliente permitirem (limitada a tipos de ação registrados); Comitê sem humano, que só recebe relatórios (dentro de política de autonomia assinada por pessoa); todas as ordens são de agente.
Também decidido: só `admin` assina a política de autonomia e define a validade junto; não há mínimo de Brain, o planning usa o que o cliente tiver e mostra o que falta.
1. O nível Básico da Ads API comporta o volume de operações do piloto?
2. Em que ordem entram os tipos de ação registrados (o executor de vínculo MCC existe; os de campanha e de orçamento do Google Ads e os da Meta não)?
