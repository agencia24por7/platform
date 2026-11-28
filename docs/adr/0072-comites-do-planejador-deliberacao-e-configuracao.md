---
status: accepted
date: 2026-11-27
---
# ADR-0072: Comitês do planejador ligados ao motor, ao banco, ao Gate e à Config da IA (24K-134, fase 2b)

Complementa os ADRs 0056 (camada Strategy Plan), 0065 §4 e §6 (cadeia de uma só execução e juiz), 0069 Estratégia §4 e §5 (juiz em lote, repetição por etapa, orçamento por tarefa), 0064 (modelo por tarefa) e 0075 (sinais de cultura). A migração é a 0153. O conflito de tetos entre os 17 comitês, o juiz e o ajuste está resolvido por cota (§6), sem migração; aceito pelo dono do produto em 2026-11-28.

## Contexto
A fase 2a trouxe o domínio: 17 comitês com 35 membros (`domain/comite/comites.ts`), a mesa em duas rodadas e a síntese do parecer do comitê (`domain/comite/mesa.ts`). Faltava o motor chamar os membros e as mesas, guardar o que cada chamada devolveu para retomar sem pagar de novo, deixar a organização ligar e desligar comitês e escolher modelo por comitê, e o Gate conferir contra os comitês de fato convocados.

## Decisão

### 1. Deliberação gravada e retomável
- `core.strategy_plan_deliberations` guarda, por versão, o parecer de cada membro (rodada 0, `membro` obrigatório) e as mesas 1 e 2 (sem `membro`). Único por (versão, comitê, rodada, membro). Imutável: só a redação LGPD troca o payload (`core.redigir_plano` passa a redigir também as deliberações). RLS forçada no padrão do Strategy Plan; o app não grava (gatilho `a_autoridade`, sem DEFINER) e o worker só grava com execução ativa, mesma ficha e lease vigente (gatilho `b_antes`, cópia da regra de `strategy_plan_agente_com_execucao`). Teto de 160 linhas por versão. Nenhuma tela lê a tabela.
- Coluna `client_id` entra além do especificado: a RLS, o expurgo em cascata e a trava consultiva do cliente dependem dela.
- O parecer final do comitê continua sendo o evento `parecer` de sempre, com `persona` igual à chave do comitê; o juiz, a consolidação, o ajuste e os gates recebem os comitês como personas (`PERSONAS_DOS_COMITES`, agora o padrão desses módulos). Nenhum CHECK do banco amarrava a persona a um conjunto: nada muda em 0145 e 0149.

### 2. Motor
- Etapa `comite`: para cada comitê convocado, os membros em paralelo (tarefa `comite_<chave>`), depois a mesa 1 e a mesa 2, `conferirMesa`, `sintetizarParecerDoComite` e o evento `parecer`. Chave de idempotência `${execucao}:deliberacao:${comite}:${rodada}[:${membro}]`.
- Retomada: ao entrar, o motor lê as deliberações da versão e só chama o que falta. A mesa é conferida antes de gravar, então mesa inválida não fica gravada e a repetição refaz só ela.
- Paralelismo: no máximo `PARALELISMO_DO_COMITE` (3) chamadas ao modelo ao mesmo tempo na etapa inteira (semáforo), com até 3 comitês em andamento.
- Etapa longa (69 chamadas com os 17 ligados): o motor para de iniciar comitês quando o orçamento de tempo do passo não comporta mais uma chamada (`tempoMaximoMs` do comitê) e devolve a etapa `comite` de novo; o processador libera a execução como pendente e a próxima reserva continua. O lease é renovado antes de cada comitê e antes e depois de cada chamada.
- Superado em parte pelo ADR 0076 §2 e §3: paralelismo de 6 chamadas com 3 comitês em andamento, regra de parada pela duração observada e membros com prefixo estável para o cache do fornecedor.
- Falha: a primeira falha de um comitê para a fila; o motivo gravado na auditoria é `comite:<chave>:<motivo compacto>` (código e caminho, nunca texto do modelo). Saída inválida segue repetível pelas regras do ADR 0069; falta de configuração e teto não.
- Convocação: na rodada 1 todos os ligados; na execução `corrigir_gate` (a única que reconvoca o Comitê depois de um ajuste) só os comitês com seção alterada entre a base e a versão corrigida. `risco_legal` é sempre convocado. Comitê que já tem deliberação na versão é sempre terminado, mesmo que tenha sido desligado no meio.

### 3. Gate `comite_completo`
- Confere contra os comitês convocados na raiz da cadeia: os que têm deliberação na raiz, mais os que já têm parecer nela (raiz antiga, de antes da 0153), mais `risco_legal` sempre. A configuração atual nunca entra nessa conta: ligar ou desligar um comitê entre a etapa `comite` e a etapa `gates` não muda quem o Gate cobra. Sem a lista (chamada direta do domínio, ou raiz sem deliberação nem parecer), exige todos os comitês: falha fechada.

### 4. Configuração dos comitês e modelo por comitê
- `core.strategy_committee_settings` (organização, comitê, ligado, autor, data), sem linha o comitê está ligado. Escrita só de owner ou admin, conferida no serviço e no gatilho; `risco_legal` desligado é recusado no serviço, no gatilho e por CHECK. Ligar e desligar audita `strategy.comite.ligado` e `strategy.comite.desligado` só com a chave.
- Cada comitê tem a tarefa de IA `comite_<chave>` (classe `raciocinio_forte` para risco_legal, marca, sparring_criativo, cultura, producao e memoria_e_decisoes; `rapido_e_barato` para os demais; raciocínio `low`; 5.000 tokens e 90 s). Sem modelo próprio, a tarefa herda o modelo de `comite` (`escolhaEfetiva`), para não exigir 17 escolhas. "Usar o modelo padrão do Comitê" remove a escolha própria (`ia.modelo_padrao`).
- Config da IA ganha a seção "Comitês do planejador" (view-model em `strategy/interface/comitesNaConfiguracao.ts`): propósito, membros, custo por rodada (membros + 2), liga e desliga, trava explicada do risco e legal e o aviso de chamadas por rodada com os ligados. As tarefas dos comitês saem da lista geral de modelo por tarefa.

### 5. Juiz neutro
- A instrução do juiz deixa de ser a do "publicitário cético": aceita ponto concreto, ancorado em prova do pacote e que melhora o resultado pedido; rejeita o vago ou sem prova; não descarta ponto por ser criativo.

### 6. Cota de pontos por comitê (resolve o conflito de tetos, sem migração)
- Os tetos do ADR 0069 §4 (45 pontos no juiz, gatilho da 0149) e do ajuste (80 respostas, 16 KB) não mudam. Quem se ajusta é a síntese do comitê (`domain/comite/cota.ts`, `sintetizarParecerDoComite` com o parâmetro `cota`).
- O motor deixa de gravar o parecer de cada comitê assim que ele termina. A etapa `comite` primeiro termina a deliberação (membros e mesas, retomável) de todos os convocados e só então grava os pareceres de todos de uma vez, porque a cota depende do veredito e dos pontos pedidos dos outros comitês. Cada síntese roda duas vezes: sem corte, para medir veredito e pontos pedidos, e com a cota. A alocação é função pura das deliberações gravadas, então a retomada recalcula o mesmo resultado.
- Regra: entre os comitês cujos pontos vão ao juiz, cada um recebe `floor(45 / n)` pontos (no máximo o que pediu). O comitê com `obrigaAjuste` que reprova fica fora de `n`, porque seus pontos são pendência obrigatória e vão direto ao ajuste (até 5). Se ele não reprova, seus pontos vão ao juiz e ele entra em `n`. A sobra (resto da divisão mais o que comitês pediram a menos) é entregue em sequência por veredito mais severo, depois mais pontos pedidos, depois ordem do catálogo, cada um até o que pediu. O corte dentro do comitê segue a prioridade que já existia (quem manteve posição, parecer mais severo, ordem).
- Consequência por construção: juiz com no máximo 45 pontos; ajuste com no máximo 45 + 5 = 50 respostas, abaixo de 80. Os 16 KB do ajuste dependem de texto livre multibyte (motivo de até 160 caracteres), então o motor passa as respostas por `ajustarRespostasAoTamanho`, que encurta só os motivos (nunca a decisão) até caber.
- Custo: pontos de comitês com muitos pedidos podem ficar de fora do juiz; a prioridade deles é a da síntese. Não há ponto perdido em silêncio no sentido de decisão: o que não entra no parecer não existe para juiz, ajuste nem Gate.

## Consequências
- Custo por rodada do Comitê com os 17 ligados: 69 chamadas (35 membros e 34 mesas), contra 9 antes; teto de saída de 345.000 tokens por rodada (69 × 5.000). Com o teto diário padrão de 200 chamadas por organização, cabem cerca de dois planos por dia.
- `modules().strategy` passa a expor também o serviço `comites` (o teste de arquitetura foi ajustado para "só serviços de aplicação").

## Riscos residuais
- **Conflito de tetos: resolvido por cota (§6).** O motor não chega mais a `juiz_acima_do_teto` com o catálogo atual; a guarda (`juiz_acima_do_teto:<n>` e `ajuste_acima_do_teto:<n>`) continua como defesa e não é repetível. Resta o caso de uma configuração mudar entre dois passos da etapa depois de parte dos pareceres gravados (comitê religado no meio): a cota é recalculada sobre o conjunto final e os já gravados não mudam, então a guarda pode disparar.
- A trava do Gate depende da deliberação gravada antes do parecer; um parecer de comitê sem deliberação só é aceito em raiz antiga.
