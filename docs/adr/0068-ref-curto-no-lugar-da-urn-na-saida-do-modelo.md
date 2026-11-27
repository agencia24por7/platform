# ADR-0068: Ref curto no lugar da URN na saída do modelo

Data: 2026-11-26. Status: aceita. Complementa o ADR 0067; não o contradiz.

## Contexto

A prova real com o Gemini mostrou o modelo errando a URN: em uma passada do mesmo grupo, 11 campos de evidência saíram com "URN inválida". A URN tem cerca de 100 caracteres (`orla:<organização>:<cliente>:<tipo>:<id>`) e o modelo precisa copiá-la inteira dezenas de vezes por plano. Qualquer abreviação invalida o campo, derruba o grupo e, depois de duas tentativas, a execução.

## Decisão

1. Cada item do catálogo e de `entradas` leva um `ref` curto (`e1`, `e2`, …), numerado na ordem do catálogo e depois das entradas, calculado sobre o pacote inteiro (antes do corte por bytes). O mesmo pacote dá os mesmos refs.
2. O modelo escreve o `ref` onde o esquema pede `urn` (evidências) e `fontes` (parecer do Comitê). As seções já redigidas, o plano atual e os pontos do Comitê que voltam ao modelo trazem o ref no lugar da URN.
3. A tradução do ref para a URN acontece no esquema da chamada (`z.preprocess`), só nos campos `urn` e `fontes`, antes da validação estrita. Ref que não existe fica como está e a validação o recusa. URN inteira continua aceita.
4. O plano gravado, as referências e o Gate seguem usando a URN e o hash: a validação estrita do plano não muda.
5. As ferramentas continuam recebendo a URN (campo `urn` do item). O Gate por modelo não usa refs.

## Consequências

- Menos tokens de saída e fim da cópia de texto longo; o erro de URN deixa de depender da fidelidade do modelo.
- O ref só vale dentro de uma chamada: nunca é gravado.
- Um ref de outro pacote seria traduzido para a URN errada se o pacote mudasse entre o pedido e a resposta; o pacote da execução não muda no meio de uma chamada.
