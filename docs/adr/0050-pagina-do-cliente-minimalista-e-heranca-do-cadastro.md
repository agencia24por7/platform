---
status: accepted
date: 2026-11-23
---
# ADR-0050: Página do cliente mais enxuta, Contexto que herda o cadastro e perguntas de imagem

Supera em parte o ADR 0036 (restrição "nenhum dado novo" e o desenho da faixa, das abas e de Fontes). A estrutura em dois blocos, Conexões e Contexto, continua valendo.

## Por que mexer

Na prática o gestor via o mesmo texto três vezes (faixa de prontidão, cartões das abas e o diagnóstico), a lista de Fontes mostrava todos os detalhes de todas as contas de uma vez, o Brain mostrava "72 de 72 entradas" mesmo com a maioria vazia, e o Contexto pedia de novo nome e segmento que a pessoa já digitou ao criar o cliente.

## Decisão

### Lista de clientes
- Sem botão "Abrir". A linha inteira é clicável: o link do nome cobre a linha (`::after` posicionado), então o alvo é um `<a>` real, com foco visível e leitura por teclado e leitor de tela. Um `onClick` no `<tr>` foi descartado por perder isso.

### Cabeçalho do cliente
- Três níveis: nome, uma linha de fatos (situação em pill; objetivo, segmento e rede em texto único) e a ação principal à direita.
- A faixa "Pronto para planejar" mostra o veredito e a contagem de sugestões. As lacunas ficam num `<details>` recolhido. Sem lacunas, só o veredito.
- As abas deixam de ser cartões com o próximo passo repetido: viram abas compactas (rótulo e estado). O próximo passo fica no `title`, e a ação continua no cabeçalho (ADR 0036, "ação principal").

### Fontes
- Uma linha por conexão: marca, nome do conector, quantidade, estado agregado (o pior da conexão) e seta. Contas, ID, frescor, "Pausar coleta", "Mais" e "Reautorizar" ficam dentro do `<details>` da conexão e só aparecem ao clicar. A ordem "problema primeiro" não muda.

### Brain
- O catálogo mostra por padrão só o que está preenchido (`entradaPreenchida`, em `domain/painel/brain/preenchimento.ts`): conexão, fonte e arquivo sempre; tabela com linhas ou dias de dado; seção e lista do contexto com completude acima de zero; capacidade fora, por ser derivada do sistema. Um botão "Mostrar o que falta (N)" revela o resto, porque as lacunas alimentam o diagnóstico e não podem sumir.
- Mapa vivo, linha de cobertura e "Como um agente enxerga" começam recolhidos.
- Limite conhecido: tabela cuja cobertura o snapshot não informa (`linhas` e `diasComDado` nulos) fica entre as ocultas até haver leitura.

### Contexto herda o cadastro
- `nome_empresa` e `segmento` passam a vir de `core.clients` quando não há entrada salva (`domain/contexto/heranca.ts`). A sobreposição é feita no `contextoRepository.carregar`, então vale para a tela, a completude, o card Contexto, o Brain e a exportação, sem tabela nem migração nova.
- A entrada herdada tem `versao` 0, `fonte` equipe, `revisao` confirmado e `compartilhavel` falso: não aparece no link público do anunciante. Versão 0 é "criar" no salvamento por versão, então editar o campo não gera conflito falso; a partir daí vale o valor do Contexto. Limpar o campo faz a herança voltar.
- "Modelo de negócio" (leads ou e-commerce) e "Pertence a uma rede" (filial de quem) são exibidos como leitura, num bloco "Do cadastro" na seção Empresa. Não são campos do catálogo e não se editam ali, porque o cadastro não tem tela de edição ainda. O campo `modelo_de_negocio` do catálogo (B2B, B2C, D2C…) é outra coisa e ganhou uma ajuda que diz isso.
- Divergência aceita: depois de editar no Contexto, nome e segmento podem diferir do cadastro. O selo "Do cadastro" só aparece enquanto o valor é herdado.

### Perguntas de imagem (Contexto › Marca)
- Três campos de arquivo novos, nível "aprofundar" para não mexer na completude essencial de quem já preencheu: **Referências visuais** (imagem, até 20), **Identidade visual** (imagem, até 20) e **Criativos históricos da marca** (imagem e vídeo, até 30).
- Reusam o armazenamento, a política de tipos e a cota do ADR 0027: bucket único, prefixo por organização e cliente, upload e download pelo app, 25 MB por arquivo e 500 MB por cliente, svg e zip recusados. Nada de URL assinada nem bucket novo.
- Os campos são visíveis ao cliente no link público, como os demais de Marca, e a ajuda de Criativos pede para evitar pessoas identificáveis sem autorização de uso (dado pessoal possível, ADR 0033).
- `VERSAO_DO_CATALOGO` sobe de 1 para 2 (campos novos e ajuda alterada).
- Risco aberto: 30 vídeos de criativos podem passar de 500 MB. A cota não mudou; se estourar, a recusa já existe e a decisão de aumentar é do ADR 0027.

## Consequências e cuidados
- Brains já publicados ficam no catálogo 1 e sem os campos herdados até a próxima edição do contexto: a fila (`core.contexto_brains_pendentes`) só pega quem tem pedido novo, e mudar `name` ou `segment` em `core.clients` não enfileira. Depois do deploy, rodar `scripts/contexto-reconstruir-brain.mjs` (leia o `--help` e o alvo antes, ADR 0028). Enfileirar na mudança do cadastro pede migração e fica para quando houver edição do cadastro.
- "Pertence a uma rede" usa `parent_client_id` para dizer sim ou não. O nome da rede só aparece se a rede estiver no recorte de quem olha (a RLS esconde a matriz fora do recorte); sem nome, mostra "Sim".
- Limpar um campo herdado não grava auditoria, porque não havia linha para apagar.

## Fora desta entrega
- Tela de edição do cadastro do cliente.
- Pré-visualização em galeria das imagens e leitura delas por IA.
- Agregação única de prontidão na lista (ADR 0036).

## Critérios de aceite
1. A linha da lista abre o cliente por clique e por teclado (Enter no link), sem botão "Abrir".
2. Com lacunas, o cabeçalho mostra veredito e "N sugestões" e abre a lista ao clicar; sem lacunas, só o veredito.
3. Fontes mostra uma linha por conexão e revela as contas ao expandir; "Reautorizar" continua alcançável.
4. O Brain abre só com entradas preenchidas e o botão revela as demais, com o total.
5. Cliente novo com nome e segmento abre o Contexto com os dois campos preenchidos e marcados "Do cadastro", e a completude conta os dois.
6. O link público não devolve a entrada herdada.
7. Os três campos de imagem aceitam imagem (e vídeo nos criativos) e recusam documento e svg.
