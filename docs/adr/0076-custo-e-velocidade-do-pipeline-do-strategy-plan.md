---
status: accepted
date: 2026-11-28
---
# ADR-0076: Custo e velocidade do pipeline do Strategy Plan: prefixo estável com cache do fornecedor, agendamento do Comitê e medição (24K-136)

Complementa os ADRs 0063 (§1 e §9: cache é otimização interna do adaptador), 0064, 0066 e 0069. Supera em parte o ADR 0072 §2 (paralelismo e regra de parada por tempo da etapa `comite`). Sem migração. Pedido do dono do produto em 2026-11-28, com a condição de não tirar comitê, membro, mesa, juiz nem Gate e de não baixar modelo, raciocínio ou teto de saída.

## Contexto
Medido por leitura do código (não havia medição de produção por etapa antes desta entrega):

- **O Comitê é a maior parte do plano.** Com os 17 ligados são 69 chamadas (35 membros e 34 mesas). Cada membro recebia o pacote do Brain inteiro (até 40 KB) com instrução de sistema própria, então nenhuma chamada reaproveitava o que a anterior já tinha mandado ao fornecedor. Não havia cache de prompt em nenhum fornecedor.
- **O Comitê rodava um comitê por vez.** A regra de parada estimava o comitê pelo pior caso (três níveis de 90 s, 270 s) contra o orçamento de 240 s da rota. A estimativa nunca cabia, então cada passo iniciava só o comitê isento da regra e os outros dois trabalhadores saíam. O paralelismo de 3 do ADR 0072 só valia dentro de um comitê (2 ou 3 membros).
- **Não havia soma de tokens nem de tempo por etapa**, e os tokens lidos de cache não eram contados.

## Decisão

### 1. Prefixo estável e cache do fornecedor
- O pedido à camada de IA ganha dois campos opcionais: `instrucaoFinal` (texto confiável do repositório, escrito depois do bloco `<dados>`) e `prefixoEstavelDosDados` (quantos caracteres do JSON dos dados são iguais em toda a coorte). O texto enviado ao modelo é o mesmo com ou sem o prefixo: o prefixo só diz onde o fornecedor pode cortar o bloco de cache.
- `prefixoEstavelDosDados` (`src/modules/ia/domain/tarefa.ts`) é o começo comum do JSON dos dados da coorte, cortado no fim de um item. Menos de 4.000 caracteres, coorte de uma chamada ou valor inválido: sem prefixo, e o pedido sai como antes.
- O adaptador (`portaAiSdk.ts`) traduz por fornecedor, como manda o ADR 0063 §1: na Anthropic o prefixo vira bloco de texto próprio com `cacheControl` efêmero; na OpenAI o texto vai inteiro com `promptCacheKey` (hash da organização e da instrução de sistema, sem dado do cliente); Google, xAI e Moonshot não recebem opção, porque o cache deles é implícito e só precisa do prefixo igual.
- O uso passa a trazer `tokensDeEntradaEmCache`.

### 2. Membros do Comitê com prefixo comum
- A instrução de sistema de todo membro é a mesma (`INSTRUCAO_COMUM_DOS_MEMBROS`, a base que já existia). A parte da persona e do assento no comitê vai em `instrucaoFinal`. A soma dos dois textos é a instrução de antes, letra por letra (teste).
- Os dados do membro passam a ter o pacote primeiro (`pacote`, `comite`, `persona`, `plano`). `pacotesComPrefixoComum` (`domain/pacote.ts`) calcula o recorte de cada membro com a mesma função de antes e só reordena: as entradas presentes em todos os recortes vêm primeiro, na mesma ordem para todos; as próprias de cada membro vêm depois. O conjunto de entradas de cada membro não muda (teste).
- A coorte é calculada sobre todos os membros dos comitês convocados, não só sobre os que faltam, para a retomada produzir o mesmo prefixo.
- **Aquecimento:** com prefixo estável, a primeira chamada de membro do passo roda sozinha e as demais esperam ela terminar, com sucesso ou falha. Sem isso as chamadas simultâneas chegam antes de o cache existir e todas pagam a entrada cheia.
- Mesas, juiz, redação, ajuste e Gates não mudam.

### 3. Agendamento do Comitê
- `PARALELISMO_DO_COMITE` sobe de 3 para 6 chamadas simultâneas na etapa; `COMITES_EM_ANDAMENTO` fica em 3.
- A regra de parada usa a duração observada: três níveis (membros, mesa 1, mesa 2) vezes a maior chamada do passo, com piso de 30 s e teto de 90 s. O primeiro comitê do passo continua isento, para todo passo avançar.
- Depois de uma falha na mesma etapa e rodada, a repetição roda com `PARALELISMO_DO_COMITE_APOS_FALHA` (3), para um limite de taxa do fornecedor não consumir as duas repetições da etapa (ADR 0069).
- Limite duro: `piorCasoDaEtapaComiteMs` (aquecimento, ondas de membros e de mesas no tempo máximo de cada chamada) somado ao orçamento da rota tem de terminar antes do tempo limite do fluxo do n8n com um minuto de folga. Com 6 chamadas são 450 s depois dos 240 s; com 3, 540 s; o limite é 900 s (teste em `fluxoDoWorker.test.ts`).

### 4. Medição
- A linha `strategy.run.step` de cada passo ganha `uso`: chamadas, tokens de entrada, tokens de entrada lidos de cache, tokens de saída, tempo somado de IA e a maior chamada. Só números.
- O `uso` é um piso do custo, não a fatura: chamada que falha (saída inválida, truncada, tempo esgotado) conta em `chamadas` e no tempo, mas soma zero token, e a escrita de cache da Anthropic (25% a mais) não vem separada dos tokens de entrada.
- `scripts/ia-contrato.ts` ganha o caso "prefixo estável": duas chamadas com o mesmo prefixo fictício; na Anthropic a segunda tem de ler do cache, nos demais o resultado é informado.

## Consequências
- Entrada dos membros: até 35 × 40 KB por rodada passam a ser lidos de cache depois da primeira chamada, no preço de leitura de cache de cada fornecedor. A primeira chamada paga a escrita (na Anthropic, 25% a mais sobre o prefixo).
- Tempo da etapa `comite`: de um comitê por vez para três, com até seis chamadas simultâneas.
- Nenhuma chamada foi removida, nenhum modelo, raciocínio, teto de saída ou esquema mudou.

## O que muda no que o modelo lê
- A ordem das entradas do pacote do membro: antes vinham primeiro as regras e as citadas nas seções dele; agora vêm primeiro as comuns a todos os membros. O conjunto é o mesmo.
- A parte da persona sai da instrução de sistema e vai para depois dos dados.

## Não verificado
- Acerto de cache com fornecedor real e o ganho em reais: não há chave neste ambiente. Verifica-se com `scripts/ia-contrato.ts` e pelo campo `uso` do primeiro plano gerado em produção.
- Equivalência de qualidade dos pareceres com a nova ordem: não foi comparada em plano real.
- Limite de taxa do fornecedor com 6 chamadas simultâneas na conta de cada organização.

## Fora desta entrega
- Prefixo estável na redação por grupos, no Production Director e nas mesas.
- Coluna de tokens em cache em `core.ai_usage` (pede migração).
- Batch API: metade do preço, mas com prazo de até 24 horas.

## Rollback
Reverter o PR. Sem migração e sem dado gravado em formato novo: deliberações e pareceres têm o mesmo esquema.
