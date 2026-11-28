# ADR-0066: Nível de raciocínio por tarefa e recuo para JSON livre na camada de IA

Data: 2026-11-26. Status: aceita. Complementa os ADRs 0063 e 0064; não os contradiz.

## Contexto

A prova real da redação do plano com o Gemini (24K-116) mostrou dois defeitos da camada, independentes de fornecedor:

1. `maxOutputTokens` conta o raciocínio do modelo. Um modelo que pensa gastou até 6.241 dos 6.485 tokens de saída pensando e a resposta saiu cortada (`MAX_TOKENS`), inválida.
2. O fornecedor recusou o esquema estruturado com HTTP 400 ("too many states for serving") nos cinco esquemas por grupo. A camada só tinha o modo estruturado e a falha virava indisponível.

## Decisão

1. A tarefa pode declarar `raciocinio` (`minimal`, `low`, `medium`, `high`). A porta repassa ao `reasoning` do AI SDK, que cada fornecedor traduz para o seu controle. Sem a declaração, nada é enviado e vale o padrão do fornecedor. As tarefas internas da Estratégia (`strategy_plan`, `comite`, `gate`) declaram `low`.
2. Quando o fornecedor recusa o esquema (HTTP 400 com mensagem de esquema, restrição ou estados), a porta refaz a chamada uma única vez em JSON livre: o JSON Schema da tarefa vai no texto do sistema, a saída é lida do texto (cercas de código removidas) e validada pelo esquema da tarefa. Falha de leitura ou de validação vira `validation`, sem devolver texto do modelo.
3. O recuo não se repete: a segunda recusa vira falha, sem laço. O teto de passos, de tokens e de tempo da tarefa vale nas duas chamadas; o recuo pode, no pior caso, gastar duas chamadas de saída.

## Consequências

- Funciona para qualquer fornecedor que o SDK traduza; fornecedor sem suporte a `reasoning` ignora o campo.
- O esquema vai no texto do sistema só no recuo e não passa pelo limite de 4.000 caracteres da instrução da tarefa.
- A prova real continua sendo o critério: a taxa de saída válida de primeira por grupo mede se o `low` basta.

## Adendo (24K-132): JSON livre robusto, truncamento distinto e teto elástico

Evidência de produção: no Gemini a etapa `ajustar` falhou 3 vezes seguidas com `esquema:json_invalido`, ou seja, o esquema estruturado foi recusado, caímos no JSON livre e o texto não parseou.

1. No recuo a porta pede JSON nativo ao fornecedor sem esquema (`Output.json()`: no Google vira `responseMimeType: application/json`); o esquema continua colado no texto do sistema e a validação continua sendo a do esquema da tarefa. A leitura é tolerante: remove cercas de código e pega o primeiro objeto `{...}` balanceado (respeitando aspas e escapes), de modo que prosa antes ou depois não derruba.
2. `finishReason` de tamanho (`length`), no modo estruturado ou no JSON livre, devolve um erro distinto e transitório, `validation` com o detalhe `[saida:truncada]`, sem tentar ler o texto. O motor grava `truncada: true` na linha `adiada` e o motivo `ia:saida_invalida:saida:truncada`.
3. Teto elástico: se a tentativa imediatamente anterior da mesma etapa e rodada terminou truncada, a repetição das chamadas `strategy_plan` pede 1,6× o teto de saída (6.500 viram 10.400) e leva em `corrigir` "a resposta anterior foi cortada por tamanho: seja mais conciso, mantenha só o pedido". O limite absoluto é `TETO_ELASTICO_DE_SAIDA` = 12.000 (a camada só o aplica quando o pedido marca `elastico`; sem a marca vale o teto da tarefa). A reserva contra o teto diário da organização (ADR 0064 §6) continua `passos × tokens de saída` do orçamento efetivo da chamada, então a chamada elástica reserva mais (31.200 em vez de 19.500) e é recusada antes de abrir a chave se não couber. Custo: só as repetições após truncamento.
4. Telemetria por chamada: a porta devolve `caminho` (`estruturado` ou `json_livre`), `finishReason`, tokens de saída usados, teto e, quando o fornecedor recusou o esquema, só a classe (`schema`, `constraint` ou `too many states`, a primeira palavra casada pelo regex), nunca a mensagem do fornecedor nem conteúdo. O motor grava a lista (até 8) no campo `ia` das linhas `strategy.run.step`, de sucesso e de falha, para saber em produção quais tarefas caem no JSON livre.
5. Reduzir a saída do ajuste (devolver só as seções que mudaram e o motor manter as demais) não foi feito: o ajuste devolve hoje o grupo inteiro e o contrato gravado, os gates de preservação e a mesclagem da mídia dependem disso; fica como proposta.
6. Por que o fornecedor recusa o esquema (medido com `z.toJSONSchema`, entrada): os esquemas são pequenos, 4,1 a 6,0 KB por grupo de redação (5 grupos), 1,5 KB a mídia por plataforma e 4,6 a 6,6 KB os de ajuste (2,1 KB o de mídia), sem `$ref`. O que pesa são as restrições: 15 a 26 `pattern` por esquema (2 a 7 distintos: ids `^[a-z][a-z0-9_]{0,31}$`, chaves `{0,63}`, URN), 16 a 22 objetos com `additionalProperties:false`, `maxItems` de até 80 (soma até 332), profundidade 10 a 18 e de 0 a 3 uniões (o valor do campo de mídia é união de 4 tipos). A causa mais provável de "too many states" são as repetições limitadas dos `pattern`. Menor mudança proposta, não aplicada por falta de chave para provar: enviar ao fornecedor um JSON Schema relaxado, sem `pattern`, `format` e `maxItems`/`maxLength`, mantendo o esquema zod completo na validação local (`jsonSchema(relaxado, { validate })` do SDK); a validação do contrato com o fornecedor real é `scripts/ia-contrato.ts` e exige chave no ambiente.
7. Degrau intermediário: quando o fornecedor recusa o esquema completo, a porta tenta UMA chamada estruturada com um JSON Schema relaxado, derivado do mesmo zod sem `pattern`, `format`, `minLength`/`maxLength`, `minItems`/`maxItems`, `minimum`/`maximum`/`multipleOf` (tipos, propriedades, `required`, enums e estrutura ficam), passado ao SDK com `jsonSchema()`. A resposta é sempre validada pelo zod completo, com os mesmos erros `[esquema:caminho:tipo]`, então valor fora do `pattern` falha localmente e alimenta o `corrigir`. Se o fornecedor recusar também o relaxado, cai no JSON livre. A ordem não muda: o completo é sempre o primeiro degrau, mas a recusa fica num cache em memória da porta (chave: fornecedor, modelo e impressão do esquema; até 200 entradas, sem persistência) para as chamadas seguintes irem direto ao relaxado sem pagar um 400. A telemetria `caminho` passa a ter três valores: `estruturado`, `estruturado_relaxado` e `json_livre`. Custo: no pior caso, a primeira chamada de cada esquema recusado gasta três chamadas (completo, relaxado, JSON livre).
