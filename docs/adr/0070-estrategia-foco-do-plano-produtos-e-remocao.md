---
status: accepted
date: 2026-11-27
---
# ADR-0070: Estratégia: foco do plano (produtos ou marca), verba por produto, remoção lógica e edição por campos

Complementa os ADRs 0065, 0067, 0068 e 0069 (esquema do plano, pacote do modelo e imutabilidade). Não supera nenhum. Issue 24K-132. Decidido pelo dono do produto em 2026-11-27. A migração é a 0151.

## Contexto

O plano nascia sem dizer sobre o quê é: o modelo escolhia o produto ou a oferta sozinho, e a verba não tinha divisão por produto. Também não havia como o usuário tirar da lista um plano errado ou de teste, e a edição de seção abria o JSON bruto (URNs, ids e estrutura) numa caixa de texto.

## Decisão

### 1. Foco do plano
- Na criação, a pessoa escolhe um ou mais produtos do cliente ou marca "campanha de marca". São exclusivos e um dos dois é obrigatório. O foco é independente do tipo de plano (um plano de Aquisição pode ser de marca). Fora desta versão: produtos e marca juntos e landing page por produto.
- Fonte dos produtos: os itens confirmados da lista "Produtos e serviços" do Contexto do cliente, lidos na visão da equipe, sem cadastro novo. O Brain só expõe essa lista como uma entrada agregada (`contexto_lista`), sem um item por produto. O leitor da Estratégia (`produtosDoContexto`) monta uma entrada por produto: URN `orla:<org>:<cliente>:contexto_produto:<id do item>` (estável, a mesma que o Contexto usa para o item), hash do conteúdo (`hashEstavel` de id e dados) e resumo por `textoSeguro`. Cliente sem produto: lista vazia com aviso e link para o Contexto; a campanha de marca continua possível. Leitura indisponível: aviso, só a marca.
- Intenção fixa: `intencao.foco` é `{ tipo: 'marca' }` ou `{ tipo: 'produtos', produtos: [{ urn, rotulo, hash }] }`, de 1 a 20 sem repetição. `SCHEMA_VERSION` continua 1 e o campo é opcional para o plano antigo. O pedido do formulário leva só as URNs: o servidor resolve rótulo e hash no Contexto da mesma organização e cliente e recusa o que não existe nele. O motor continua recolocando a intenção original (`fixarIntencao`), e a edição manual preserva o foco da versão base.
- Pacote do modelo: as entradas dos produtos escolhidos entram sempre em `entradas`, marcadas `foco: true`, na frente de tudo (também nos perfis de pacote que filtram por URN). A instrução diz que o plano se alinha aos produtos, não propõe outros e, em foco de marca, não ancora a oferta central em produto. O tipo `contexto_produto` não existe no catálogo do Brain: se o modelo citar um produto como evidência, a avaliação de impacto o ignora (o produto não vira "entrada removida"). Mudança no produto depois da criação não marca o plano como desatualizado; isso fica para uma versão futura.

### 2. Verba por produto
- Com mais de um produto, `orcamento.por_produto: [{ produto (urn), valor, justificativa?, evidencias }]` é definido pelo modelo e conferido por gate; a divisão não é fixada na criação. A campanha ganha `produto` opcional (urn), obrigatório com mais de um produto. Na saída do modelo, `produto` aceita o ref curto, como `urn` (ADR 0068).
- Gates novos no registro (15 no total): `foco_verba_por_produto` (soma igual ao total do orçamento, mesma regra do `orcamento_fecha`; só produtos do foco, todos presentes e sem repetição; valor zero só com justificativa; com um produto, `por_produto` ausente ou um item com o total; em foco de marca, ausente) e `foco_alinhamento` (campanha só cita produto do foco). Plano sem foco (antigo) aprova os dois. Não há campo de produto em segmento: o alinhamento de segmentos fica fora.

### 3. Remover plano (remoção lógica)
- Botão "Apagar plano" na página e no card, só owner e admin (`remover` em `domain/papeis`), com a confirmação em diálogo da própria página (`ConfirmarAcao`), sem `window.confirm`. Plano com execução ativa recusa: "Cancele a execução antes de apagar o plano." (conferido no serviço e de novo na transação).
- Semântica: `removido_em` e `removido_por` em `core.strategy_plans`. Irreversível pela tela, nunca volta a `NULL`. Versões, eventos, execuções, referências e auditoria ficam intactos e imutáveis. Por que não física: o plano pode ter versão autorizada, e o histórico (ADR 0056, 0065) é a prova do que foi decidido e pedido; apagar linhas quebraria as chaves das tabelas filhas e a auditoria. A exclusão física segue só com o expurgo do cliente.
- O gatilho `strategy_plan_plano_imutavel` passa a permitir só a transição `removido_em` de `NULL` para um valor, uma vez, quando `app.user_id` é owner ou admin da organização da sessão (`core.memberships_of`), sem mudar outra coluna; ele fixa `removido_em = now()` e `removido_por`. O app ganha `UPDATE (removido_em, removido_por)` e uma policy de UPDATE com o mesmo recorte de inquilino.
- RLS: o SELECT continua permitindo a linha e o filtro `removido_em IS NULL` vive no repositório. Escolha por ser a mais simples e segura aqui: a policy de leitura é a mesma de quatro tabelas e esconder só a do plano não esconderia versões, execuções nem eventos, que o worker e a auditoria precisam ler. Todo caminho do repositório (plano, lista, painel, `clienteDoRecurso`, versões, eventos, execuções, reserva do worker, escrita de versão, evento e execução) filtra o plano removido e devolve não encontrado; `core.strategy_runs_pendentes` ignora execução de plano removido, e a reserva e a atualização do worker também. A auditoria é `strategy.plan.removed` (organização, cliente, plano, tipo; sem conteúdo).
- Limite conhecido: uma execução criada no mesmo instante da remoção (corrida entre duas transações) é barrada pelo filtro da reserva e do `UPDATE`, não por um gatilho no banco.

### 4. Edição de seção por campos, sem JSON bruto
- "Editar seção" deixa de abrir o JSON. A tela mostra um formulário por grupos, só com campos de conteúdo: no resumo executivo, objetivo, aposta, resultado esperado e verba (em reais); no plano de mídia, valor e justificativa dos campos do catálogo (rótulo é a chave do campo, tipo vem do catálogo: escolha vira lista, número, texto, lista de itens em linhas). Ids, URNs, refs, hashes, evidências, papéis, hipótese, a intenção fixa, os campos de destino, UTM e WhatsApp (cópia da intenção) e qualquer chave desconhecida não aparecem: a lista é uma regra explícita por seção, não "toda string".
- A ação recebe só pares caminho e valor, relê a versão no servidor, aplica apenas os caminhos que o view-model gera para ela (caminho fora da lista, tipo errado e tamanho acima do limite são recusados por campo), monta a seção e chama `editarManual`, o mesmo serviço de antes: esquema, privacidade, referências, nova versão e revisão, sem relaxar nada. Recusa `json` no envio e mantém a checagem "o plano mudou enquanto você editava". O erro do esquema é mapeado para o campo. A tela não recebe mais o JSON da seção.
- Só o resumo executivo e o plano de mídia são editáveis pela tela; as outras seções mudam por "Pedir mudança ao agente". A intenção, antes editável pelo JSON, passa a ser fixa na tela.

## Consequências

- Migração 0151, aditiva: colunas `foco`, `removido_em` e `removido_por`, função `core.strategy_plan_foco_valido` (formato e URN do mesmo cliente no CHECK), policy e grant de UPDATE restritos, gatilho novo, `strategy_runs_pendentes` filtrada e o limite do `pedido` das execuções de 8 para 16 KB (o foco com 20 produtos entra na intenção). Nenhum DROP de tabela ou coluna; fora do corte-gate.
- O foco não entra na redação LGPD: guarda só rótulos do catálogo do cliente passados por `textoSeguro` e URNs; o `pedido` que o contém já é redigido junto com a versão. Se o rótulo de produto passar a poder carregar dado pessoal, a redação precisa cobri-lo.
- Cada plano novo exige o foco no pedido; plano antigo continua legível sem foco e sem gate novo.
