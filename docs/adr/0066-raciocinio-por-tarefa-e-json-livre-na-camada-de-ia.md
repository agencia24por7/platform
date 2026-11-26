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
