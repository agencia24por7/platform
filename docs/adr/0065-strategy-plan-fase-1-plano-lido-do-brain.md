---
status: accepted
date: 2026-11-25
---
# ADR-0065: Strategy Plan, fase 1: plano de marketing lido só do Brain, com Comitê de personas e autorização por pessoa

Supera em parte o ADR 0056 (§2 no que toca status, §3 no gatilho por evento, §4 e §9 no catálogo de conhecimento, §5 na política de autonomia e no Gate, §7 na leitura direta do `tria_dw`). O §6 do ADR 0056 (execução e escrita em conta) fica adiado, não revogado. Complementa os ADRs 0026, 0030, 0051 e 0055. Issue 24K-116. Decidido pelo dono do produto em 2026-11-25. As migrações são a 0145 (diferença sobre a 0143 já em `dev`), a 0146 (Brain) e a 0147 (execuções).

## Contexto
O ADR 0056 desenhou a camada inteira: plano, Comitê, Gate, execução e medição. Três fatos do código mudam a primeira entrega:
1. O Brain é calculado na leitura e não emite evento quando muda. Não tem conhecimento global (lente, prática, regra legal, evidência com nota e validade) nem números de desempenho: ele diz que a tabela existe, não o que há nela.
2. Não existe chamada a modelo de linguagem no produto. A camada de IA é a issue 24K-131, de outra frente, com ADR próprio.
3. Só existe um executor de escrita em conta (vínculo MCC). Construir execução agora seria código sem uso.

O dono do produto fixou o escopo: entregar um plano de marketing completo, com foco em anúncios, campanhas e publicidade, 100% guiado por dado do Brain, revisado por Comitê e levado até a autorização. Sem execução.

## Decisão

### 1. Escopo da fase 1
O módulo de Estratégia lê o Brain, cria o plano, passa pelo Comitê, ajusta, passa pelos Gates e entrega. A pessoa edita à mão ou pede mudança ao agente, aplica e autoriza. O módulo não cria ordem, não escreve em conta e não gasta verba.

### 2. Fonte única: o Brain
O módulo lê só o catálogo do Brain, em processo, pela mesma política de uso da API de leitura (ADR 0030 §6): entrada `negado` fica de fora, `restrito` entra só com metadados. Informação que o plano precisa e o Brain não tem entra primeiro no Brain, por provedor:
- **`desempenho`**: resumos agregados do `tria_dw` (gasto, resultado, custo por resultado, por canal, campanha e período; quem converte, onde e quando). Só agregados, sem dado pessoal. O catálogo não consulta o BigQuery a cada leitura: uma medição periódica grava o resumo no Postgres, no molde da cobertura (ADR 0030 §4). As entradas são por mês fechado, para que o plano não fique desatualizado todo dia.
- **`conhecimento`**: lentes de estratégia, práticas e plataformas, regras legais e de plataforma, benchmarks e evidências. Cada entrada tem fonte, nota (A primária, B pesquisa com método, C fornecedor, D não verificável), data, mercado, validade, jurisdição e data da última verificação. A entrada do catálogo ganha um campo opcional e tipado para esses metadados; o hash das entradas que não o usam não muda. A tabela é global e o provedor projeta as entradas no catálogo de cada cliente, porque a URN exige organização e cliente. As regras legais da carga inicial foram conferidas na fonte oficial em 26/11/2026 por agente de IA, sem revisão jurídica; nenhuma é obrigatória no Gate, porque três delas só se aplicam a um tipo de cliente ou de público e o sistema ainda não modela a quem cada regra se aplica. A entrada sobre a medida provisória de apostas vence em 04/03/2027, quando precisa ser conferida de novo. A tela continua mostrando "não verificada" só quando `verificadoEm` é nulo e "vencida" quando passou da validade.

O conhecimento global tem a fonte no banco (tabela global, sem dado de cliente, versão nova em vez de edição) e é publicado no bucket do Brain pela publicação que já existe. O módulo de Estratégia nunca lê a tabela direto.

Todo número e toda afirmação do plano cita uma entrada do Brain por URN e hash. O que não tem evidência aparece como hipótese ou como lacuna. Nota D nunca sustenta meta.

### 3. Mudança do Brain por comparação
Cada referência guarda o hash que viu. Além do que o conteúdo cita, toda versão grava como premissa as entradas de limite, regra e decisão que estavam no pacote lido, para que uma regra nova ou alterada seja percebida. Ao ler o plano, o módulo compara com o catálogo atual e classifica o impacto (`nenhum`, `informativo`, `material`). Impacto material marca o plano vigente como **desatualizado** e oferece abrir uma revisão. O plano vigente nunca muda sozinho. A comparação é feita na leitura; um job diário só passa a ter utilidade quando existir notificação fora da aba, e fica para essa fase.

### 4. Status e versões
Ficam os status do ADR 0056 e entra `cancelado`: `rascunho`, `proposto`, `vigente`, `superado`, `revogado`, `rejeitado`, `cancelado`. Na tela: Em rascunho, Em autorização, Autorizado, Substituído, Revogado, Rejeitado, Cancelado.
- Transições novas: `rascunho` → `cancelado` e `proposto` → `cancelado`.
- **Um plano tem no máximo uma versão aberta** (`rascunho` ou `proposto`). Criar versão nova cancela a aberta anterior na mesma transação.
- Editar um plano em autorização cria versão nova em `rascunho` e cancela a que estava em `proposto`. Ao ser aplicada de novo, a versão nova volta a `proposto`.
- "Aplicar o plano" leva a `proposto`. Autorizar leva a `vigente`.
- Uma versão só vai a `proposto` se, no banco: (a) o Gate mais recente dela é aprovado, posterior a todo parecer e ajuste dela e da mesma execução que eles; e (b) ela passou pelo Comitê, por parecer próprio ou por uma cadeia de ajustes: cada ajuste responde exatamente à versão que a sua substituiu, e a cadeia termina numa versão com parecer. Uma versão antiga do plano não empresta parecer a uma revisão nova: todos os ajustes da cadeia e os pareceres da raiz são da mesma execução. O ajuste gera versão nova (o conteúdo é imutável), por isso a versão ajustada herda a passagem pelo Comitê pelo evento de ajuste, um por versão, que aponta a versão respondida.
- O banco só garante que houve parecer e Gate. Que todas as personas opinaram e que todo ponto foi respondido é checagem de Gate em código (`comiteCompleto`).
- Agente só cancela rascunho. Plano em autorização só sai de lá por pessoa ou por versão nova.
- O agente só grava versão ou evento com uma execução do mesmo plano em andamento e com reserva vigente; o banco confere. Cancelar a execução impede a escrita atrasada do agente, e a edição da pessoa não é desfeita por uma resposta tardia do modelo.
- Reenvio idempotente de criação de versão é recusado antes de cancelar a versão aberta.
- A redação de dado pessoal alcança todas as versões do plano, não só a cadeia de `supersedes_id`.

### 5. Papéis
Criar, editar, aplicar e cancelar: `owner`, `admin` ou `operator`. Autorizar, rejeitar e revogar: `owner` ou `admin`. `viewer` não acessa a Estratégia nesta fase: pelo ADR 0062 o leitor é o papel dado ao cliente e só vê o recorte cliente do contexto, enquanto o plano, os pareceres do Comitê, os Gates e as marcas de evidência são montados com a visão da equipe; por isso `ler` é de `owner`, `admin` e `operator`, a aba some da barra para o leitor e a rota redireciona para Conexões. Uma visão do plano para o cliente é trabalho futuro. Agente nunca autoriza, rejeita nem revoga. Não há política de autonomia nesta fase: quem autoriza é sempre pessoa.

### 6. Comitê de personas
Todo plano novo e toda mudança passam pelo Comitê. Persona é dado (nome, papel, foco, instrução, formato do parecer), não código. Personas iniciais: publicitário, redator, buzz e social, analista de dados, marqueteiro, diretor de vendas, SDR, representante do cliente, risco e legal.
- Cada persona devolve parecer estruturado: aprova, aprova com ajuste ou reprova, com motivo e trecho do plano.
- O Comitê não decide status. O ajuste gera versão nova que responde aos pareceres e registra o que não acatou e por quê.
- Reprovação de risco e legal não pode ser ignorada pelo ajuste.
- Eco não é evidência: pareceres que citam a mesma fonte contam como um argumento.
- O Comitê opina uma vez por execução. Se o Gate reprovar a versão ajustada, o agente ajusta de novo, até duas rodadas, sem reconvocar o Comitê; esgotadas as rodadas, a execução termina como reprovada e o rascunho fica visível com o que falta. Toda execução nova (plano novo, pedido de mudança, edição manual, revisão) convoca o Comitê de novo.

### 7. Gates
- **Checagens em código** (bloqueiam): Comitê completo e ajuste respondendo a todos os pontos; toda afirmação tem URN presente no pacote lido; nenhuma evidência vencida; nota D não sustenta meta; limites e regras do cliente respeitados (todo limite vigente da medida é avaliado, em todo período e escopo que a definição declara; o gasto é comparado como teto mensal, pela verba dividida pelos meses do horizonte, e como total; limite que bloqueia reprova; limite que existe e não pode ser comparado reprova; limite ausente não reprova, desde que o plano o declare em Lacunas, porque esta fase não gasta e o plano não exige mínimo de Brain); `nao_faremos` não violado; regra legal aplicável presente; seções obrigatórias preenchidas; a verba fecha com a soma das campanhas; todo objetivo tem métrica e forma de medir.
- **Checagem por modelo** (pode bloquear, nunca aprova sozinha): coerência entre diagnóstico, público, mensagem e campanhas; meta plausível frente ao histórico.

Falha fechada: checagem que não consegue rodar bloqueia e diz o que falta. Há limite de rodadas entre ajuste e Gates.

- A intenção (objetivo, horizonte, ousadia, retorno esperado, verba) é da pessoa e é fixa: depois de toda resposta do modelo, o motor recoloca a intenção original. Os Gates comparam verba e limite contra ela. Só a edição manual da seção de intenção a muda.
- Todo limite vigente do cliente tem de ser avaliado por uma meta do plano ou constar de uma declaração estruturada de que não se aplica, com motivo; a declaração aparece na tela e vai ao Gate por modelo. O limite de gasto nunca pode ser declarado não aplicável.
- Um "não faremos" não pode sumir nem afrouxar numa versão escrita pelo agente; só a pessoa o remove. A comparação é contra todas as versões de agente desde a última decisão de pessoa e contra a vigente, e o item só de texto tem de manter o texto. Plano novo (`criar`) compara só com as versões da própria execução. Nas demais execuções a caminhada vai da versão mais nova para a mais antiga: proposta rejeitada ou cancelada por pessoa é pulada (era proposta, não base); plano revogado encerra a caminhada sem entrar; versão de autor pessoa ou vigente entra e encerra (a cancelada pelo sistema, por substituição, entra e continua); e a vigente entra no fim se a caminhada não parou numa versão de pessoa. Assim um plano depois de revogado não herda o que foi descartado, e a edição manual não reimpõe o item que a pessoa removeu. Os itens só de texto e as regras e decisões do cliente vão ao Gate por modelo, com instrução de reprovar violação.

### 8. Conteúdo do plano
Esquema fixo, versionado por `schema_version`: resumo executivo, intenção, diagnóstico, público-alvo, comunidades alvo, posicionamento e mensagem, estratégia (política, `nao_faremos`, hipóteses), canais e plataformas, campanhas, criativos, orçamento, metas e métricas, medição, calendário, riscos e regras, lacunas. A pessoa informa só a intenção (objetivo, horizonte, ousadia, retorno esperado, verba).

### 9. Uso de modelo
O módulo não fala com fornecedor, não guarda chave e não importa SDK de fornecedor. Ele chama modelo só por uma porta própria e estreita, com a forma do ponto único de execução da camada de IA (24K-131): tarefa (`strategy_plan`, `comite`, `gate`), entrada, esquema da saída e orçamento; devolve saída validada ou erro tipado.
- Adaptadores: um falso e determinístico para teste, um "não configurada" como padrão, e depois o que chama a camada de IA. Trocar é registro, não fluxo.
- Os agentes não recebem ferramenta: o pacote do Brain entra como dado.
- Conteúdo do Brain é dado não confiável: passa por `textoSeguro` e nunca é instrução. Saída fora do esquema, ou que cite URN fora do pacote, é recusada.
- Agente de plano e Comitê gravam só pela credencial do worker. Parecer, ajuste e resultado de Gate são eventos que só o worker insere; aplicar o plano é ato de pessoa.
- Cada execução tem um dono: a reserva devolve uma ficha, toda atualização do worker a confere, e quem perde a reserva para sem gravar. A ficha também acompanha toda escrita de versão e de evento do agente, e o banco a confere, falhando fechado sem ela. A ficha protege contra código com defeito, não contra quem tem a credencial do worker. Reserva e vencimento usam o relógio do banco. O número de reservas só sobe de um em um, na própria reserva, e toda reserva (de pendente ou de lease vencido) o sobe. A reserva dura mais que a etapa mais longa e é renovada antes e depois de cada pedido ao modelo. Há teto de reservas por execução; estourado, ela termina como falha.
- O pedido ao modelo leva um sinal de cancelamento e é abortado no tempo máximo.
- A camada de IA absorve o limite passageiro do fornecedor; "limite atingido" nesta porta significa o teto da organização e encerra a execução.
- Texto livre de parecer, de resposta do ajuste e do Gate por modelo passa pelo mesmo filtro de dado pessoal do plano. A edição manual grava a versão e a execução de revisão na mesma transação.
- Teto de escrita do agente no banco: 100 por execução e 1000 por cliente em 24 h (o ADR 0056 fixava 50 e 200, pouco para um plano com nove pareceres por rodada). O ajuste por configuração só reduz.
- A criação do plano é longa: roda fora da requisição de página, acionada por rota de worker (`POST /api/v0/strategy/execucoes/avancar`), idempotente e retomável. O pedido e o andamento ficam numa tabela de execuções (criar, ajustar, revisar), com no máximo uma execução ativa por plano. Quem chama a rota periodicamente em produção é a camada de IA ou um fluxo `platform`, ainda a ligar. Quem aciona a rota é o workflow da plataforma `ORLA · strategy · avançar execuções` (`n8n/workflows/plataforma/strategy-avancar-execucoes.json`), a cada minuto, com o worker token e corpo `{"limite": 10}`; o orçamento de 4 minutos da rota é conferido só entre passos, e um passo de redigir ou ajustar faz até 5 chamadas em sequência (até cerca de 10 minutos) e o Comitê, 3 lotes de 90 segundos; a reserva da execução é renovada antes e depois de cada pedido ao modelo; por isso o tempo limite da chamada no n8n é de 15 minutos. Não há nova tentativa automática, porque a própria cadência repete a chamada.
- A edição manual desta fase é por seção, em formato avançado, validada pelo esquema; um editor por campo fica para depois.

### 10. Interface
Quarta aba "Estratégia" na página do cliente, no padrão do ADR 0055: Plano, Comitê, Gates e Histórico.
- A tela recebe só o serviço (`modules().strategy`); a rota de worker recebe só o processador (`modules().strategyDoWorker`). Repositório, motor, leitor do Brain, executor de IA e avaliador de limites ficam locais à composição, e o teste de arquitetura confere pelo tipo e pelo texto.
- O catálogo para a comparação com o Brain vem do snapshot que a página já tem, nunca de um catálogo solto: o serviço confere organização e cliente do snapshot e, se não baterem, trata como indisponível, nunca como em dia.
- A tela marca regra legal sem `verificadoEm` ("não verificada") e evidência vencida ("vencida"), e avisa em Riscos e regras que a regra legal não verificada deve ser confirmada antes de autorizar.

## Fora da fase 1
Execução, ordens e escrita em conta; política de autonomia; Strategy Metrics e registro de experimento; ferramentas de agente e MCP; modelo por persona; serviço de pesquisa de mercado; notificação fora da aba.

## Consequências
- O plano de um cliente com pouco dado no Brain sai curto e diz o que falta. É o comportamento desejado.
- O módulo chama a camada de IA pelo adaptador `infrastructure/ia/iaDaCamada.ts` (ADR 0063 e 0064): sem chave e modelo escolhidos para `strategy_plan`, `comite` e `gate` em `/config/ia`, a execução falha com `ia_nao_configurada`. A qualidade real do plano só se mede com fornecedor real; o fornecedor falso da integração não devolve saída que case com o esquema.
- Cada plano custa dezenas de chamadas de modelo, e cada edição repete Comitê e Gates. O orçamento por execução e o teto diário são da camada de IA.
- Risco residual: personas no mesmo modelo tendem a concordar entre si. As checagens em código não dependem de modelo e são as que bloqueiam.
- Risco residual: o provedor `desempenho` lê o BigQuery; precisa de resumo já calculado ou de cache para não encarecer a leitura do catálogo.
- Risco residual: a maior parte da evidência de ads é nota C. O plano mostra a nota; não há dado onde ele não existe.
- Toda etapa que toca rota, autorização, tenant, banco ou dado que sai para terceiro passa por `security-reviewer` e teste de integração.

## Limites conhecidos da integração com a camada de IA
- A camada de IA não tem `AbortSignal`, idempotência nem erro próprio de tempo. O adaptador manda `tempoMs` com margem de 10 segundos abaixo do prazo do nosso `comValidacao`, para o tempo limite do SDK disparar antes e a chamada não ficar órfã e cobrada. Cada tentativa nova gasta cota.
- O teto da organização e o 429 do fornecedor chegam ambos como `rate_limited`, mas a mensagem do teto é constante exportada (`MENSAGEM_DO_BLOQUEIO`). O adaptador usa essa constante: teto da organização e IA desligada viram `limite_atingido` (encerra a execução); 429 do fornecedor vira `falha_do_fornecedor` (transitória, tenta de novo). Os motivos de teto são derivados do registro de mensagens da camada: um motivo novo é tratado como teto da organização, e o teste percorre todos os motivos.
- `unauthorized` (chave recusada pelo fornecedor), `not_found` (sem chave ou modelo) e fornecedor não habilitado viram `nao_configurada`: o remédio é o mesmo, `/config/ia`.
- Falha no meio da redação recomeça os 5 grupos, porque o progresso parcial não é guardado.
- Melhoria seguinte: um grupo por passo, com o progresso parcial guardado na execução (exige coluna nova e caminho de redação), o que também cabe no orçamento de tempo entre passos.
