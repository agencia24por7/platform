# ADR-0067: A Estratégia lê o Brain na visão da equipe e envia ao fornecedor o catálogo e o conteúdo

Data: 2026-11-26. Status: aceita. Supera o ADR 0063 §4 só para o caminho do motor da Estratégia; as ferramentas seguem na visão do cliente para credenciais externas.

## Contexto

O ADR 0063 §4 limita o agente à visão do cliente e diz que abrir a visão da equipe a um agente pede decisão nova. O motor do plano (ADR 0065) lê o Brain na visão da equipe e manda o pacote ao fornecedor do modelo, fora da plataforma. A diferença para a visão do cliente é o segmento herdado do cadastro, os valores de negócio confirmados e não compartilháveis (CAC, LTV, ROAS, ticket, investimento) e as hipóteses confirmadas pela equipe. A decisão do dono do produto, em 2026-11-26, é enviar tudo, em catálogo e em conteúdo.

## Decisão

1. O motor lê o Brain na visão da equipe e envia ao fornecedor o conteúdo dessa visão. A saída do plano é só para a equipe.
2. O pacote leva dois blocos: `entradas` (o conteúdo, com os limites de entradas e de bytes) e `catalogo` (índice compacto de tudo que é visível, com URN, tipo, título de até 80 caracteres, nota e validade, e a marca `incluida`). O catálogo mostra também o que não coube em `entradas`. Só se cita URN de `entradas`; o Gate continua conferindo contra `entradas`.
3. O que a política de uso nega nunca sai, nem no catálogo. Entrada restrita sai só como metadado. Título e resumo passam por `textoSeguro`.
4. Entradas do tipo `arquivo` entram no pacote e no catálogo, por decisão do dono do produto. O nome do arquivo passa por `textoSeguro`, que não remove nome de pessoa: é risco aceito, e remover o tipo é uma constante (`TIPOS_FORA_DO_PACOTE`) se a decisão mudar.
5. A consulta livre entra, como ferramentas MCP do registro único da camada de IA (ADR 0063): `brain_consultar_catalogo` (já existia) e `brain_consultar_item` (nova, lê uma entrada pela URN). As duas são somente leitura, ficam presas à organização e ao cliente do escopo e respeitam a política de uso. Uma credencial externa de MCP continua na visão do cliente.
6. A visão da equipe nas ferramentas só existe no escopo interno: `visao: 'equipe'` é campo do escopo montado pelo nosso código para a tarefa `strategy_plan`; nenhuma credencial de agente a carrega.
7. Só a tarefa de redação (`strategy_plan`) recebe as ferramentas e passa a ter 3 passos. Comitê e Gate por modelo seguem sem ferramenta.
8. A URN citada pelo plano que não está em `entradas` é resolvida pelo motor contra o Brain real (mesma organização e cliente, mesma política de uso) antes de conferir as referências e rodar o Gate. A entrada resolvida entra no pacote do Gate e a referência grava o hash dela. URN que o Brain não devolve continua sendo saída inválida. Assim o Gate não depende do que o modelo diz ter lido.
9. A auditoria registra cada consulta com o agente como ator (o id da execução), só com contagens. A procedência do que importa está nas referências do plano (URN e hash de cada entrada citada).

## Consequências

- O fornecedor passa a receber números internos do cliente. A escolha do modelo em `/config/ia` continua sendo o interruptor: sem modelo escolhido, nada sai.
- O catálogo duplica uns poucos tokens por pedido e deixa o modelo declarar em Lacunas o que existe e não foi lido.
- A página compara o plano com o Brain pela mesma leitura, sem os limites de entradas e de bytes, para que uma entrada citada fora do pacote não apareça como removida.
- Dois planos feitos com o mesmo Brain podem divergir conforme o que o modelo consultou. O que fica reproduzível é a procedência: toda URN citada vale pelo hash gravado.
- A consulta custa passos: até 3 por chamada de redação, com reserva de tokens por passo contra o teto diário da organização.
- O texto devolvido por uma ferramenta é dado não confiável, como o resto do pacote; a instrução diz isso ao modelo.
