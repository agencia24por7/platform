# ADR-0067: A Estratégia lê o Brain na visão da equipe e envia ao fornecedor o catálogo e o conteúdo

Data: 2026-11-26. Status: aceita. Supera o ADR 0063 §4 só para o caminho do motor da Estratégia; não altera a ferramenta `brain_consultar_catalogo`, que segue na visão do cliente.

## Contexto

O ADR 0063 §4 limita o agente à visão do cliente e diz que abrir a visão da equipe a um agente pede decisão nova. O motor do plano (ADR 0065) lê o Brain na visão da equipe e manda o pacote ao fornecedor do modelo, fora da plataforma. A diferença para a visão do cliente é o segmento herdado do cadastro, os valores de negócio confirmados e não compartilháveis (CAC, LTV, ROAS, ticket, investimento) e as hipóteses confirmadas pela equipe. A decisão do dono do produto, em 2026-11-26, é enviar tudo, em catálogo e em conteúdo.

## Decisão

1. O motor lê o Brain na visão da equipe e envia ao fornecedor o conteúdo dessa visão. A saída do plano é só para a equipe.
2. O pacote leva dois blocos: `entradas` (o conteúdo, com os limites de entradas e de bytes) e `catalogo` (índice compacto de tudo que é visível, com URN, tipo, título de até 80 caracteres, nota e validade, e a marca `incluida`). O catálogo mostra também o que não coube em `entradas`. Só se cita URN de `entradas`; o Gate continua conferindo contra `entradas`.
3. O que a política de uso nega nunca sai, nem no catálogo. Entrada restrita sai só como metadado. Título e resumo passam por `textoSeguro`.
4. Entradas do tipo `arquivo` ficam fora do pacote e do catálogo: o nome do arquivo pode conter nome de pessoa (ADR 0063 §8) e o plano não usa arquivos.
5. A consulta livre pelo agente (laço de ferramentas) não entra: a ADR 0065 mantém o agente sem ferramenta, e ela exigiria registro de cada consulta na execução e um Gate sobre esse registro. Fica para decisão própria.

## Consequências

- O fornecedor passa a receber números internos do cliente. A escolha do modelo em `/config/ia` continua sendo o interruptor: sem modelo escolhido, nada sai.
- O catálogo duplica uns poucos tokens por pedido e deixa o modelo declarar em Lacunas o que existe e não foi lido.
- A página compara o plano com o Brain pela mesma leitura; o catálogo não entra no hash das entradas.
