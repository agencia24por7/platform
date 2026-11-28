---
status: accepted
date: 2026-11-27
---
# ADR-0070: Estratégia: foco do plano (produtos ou marca), remoção lógica e edição por campos

Complementa os ADRs 0065, 0067, 0068 e 0069 (esquema do plano, pacote do modelo e imutabilidade). Não supera nenhum. Issue 24K-132. Decidido pelo dono do produto em 2026-11-27. A migração é a 0151.

## Contexto

O plano nascia sem dizer sobre o quê é: o modelo escolhia o produto ou a oferta sozinho. Também não havia como o usuário tirar da lista um plano errado ou de teste, e a edição de seção abria o JSON bruto (URNs, ids e estrutura) numa caixa de texto.

## Decisão

### 1. Foco do plano
- Na criação, a pessoa escolhe um ou mais produtos do cliente ou marca "campanha de marca". São exclusivos e um dos dois é obrigatório. O foco é independente do tipo de plano (um plano de Aquisição pode ser de marca). Fora desta versão: produtos e marca juntos e landing page por produto.
- Fonte dos produtos: os itens confirmados da lista "Produtos e serviços" do Contexto do cliente, lidos na visão da equipe, sem cadastro novo. O Brain só expõe essa lista como uma entrada agregada (`contexto_lista`), sem um item por produto. O leitor da Estratégia (`produtosDoContexto`) monta uma entrada por produto: URN `orla:<org>:<cliente>:contexto_produto:<id do item>` (estável, a mesma que o Contexto usa para o item), hash do conteúdo (`hashEstavel` de id e dados) e resumo por `textoSeguro`. Se a lista `produtos` estiver marcada com aviso de dado pessoal no catálogo do Contexto, a entrada vai só com título e hash (sem resumo), como o Brain faz com entrada restrita. Cliente sem produto: lista vazia com aviso e link para o Contexto; a campanha de marca continua possível. Leitura indisponível: aviso, só a marca.
- Intenção fixa: `intencao.foco` é `{ tipo: 'marca' }` ou `{ tipo: 'produtos', produtos: [{ urn, rotulo, hash }] }`, de 1 a 20 sem repetição. `SCHEMA_VERSION` continua 1 e o campo é opcional para o plano antigo. O pedido do formulário leva só as URNs: o servidor resolve rótulo e hash no Contexto da mesma organização e cliente e recusa o que não existe nele. O motor continua recolocando a intenção original (`fixarIntencao`), e a edição manual preserva o foco da versão base.
- Pacote do modelo: as entradas dos produtos escolhidos entram sempre em `entradas`, marcadas `foco: true`, na frente de tudo (também nos perfis de pacote que filtram por URN). O tipo `contexto_produto` não existe no catálogo do Brain: se o modelo citar um produto como evidência, a avaliação de impacto o ignora (o produto não vira "entrada removida"). Mudança no produto depois da criação não marca o plano como desatualizado; isso fica para uma versão futura.

### 2. Produtos são balizador, sem amarra estrutural
- Decisão do dono do produto em 2026-11-27, que substituiu a primeira versão deste ADR (verba por produto e gates de alinhamento): "nada prende nada a produto". Os produtos escolhidos orientam posicionamento, oferta, campanhas e copy, mas o plano é livre para distribuir campanhas e verba entre eles como quiser, inclusive combinar dois produtos numa mesma campanha. Não há divisão de verba por produto, campo de produto na campanha nem gate ligado a produto; o registro de gates segue com as 13 checagens de antes.
- O que o foco garante: a intenção fixa (§1) e as entradas dos produtos sempre no pacote do modelo, com prioridade. A instrução diz só isso ao modelo, em foco de marca "trabalhe a marca", e não traz regra dura de "não cite outros produtos".
- O que isso implica: não existe conferência automática de que o plano usa os produtos do foco, nem de que a verba ou as campanhas os respeitam. Quem confere é a pessoa que lê o plano. Se isso mudar, é decisão nova e um gate novo, não uma troca silenciosa.

### 3. Remover plano (remoção lógica)
- Botão "Apagar plano" na página e no card, só owner e admin (`remover` em `domain/papeis`), com a confirmação em diálogo da própria página (`ConfirmarAcao`), sem `window.confirm`. Plano com execução ativa recusa: "Cancele a execução antes de apagar o plano." (conferido no serviço e de novo na transação).
- Semântica: `removido_em` e `removido_por` em `core.strategy_plans`. Irreversível pela tela, nunca volta a `NULL`. Versões, eventos, execuções, referências e auditoria ficam intactos e imutáveis. Por que não física: o plano pode ter versão autorizada, e o histórico (ADR 0056, 0065) é a prova do que foi decidido e pedido; apagar linhas quebraria as chaves das tabelas filhas e a auditoria. A exclusão física segue só com o expurgo do cliente.
- O gatilho `strategy_plan_plano_imutavel` passa a permitir só a transição `removido_em` de `NULL` para um valor, uma vez, quando `app.user_id` é owner ou admin da organização da sessão (`core.memberships_of`), sem mudar outra coluna; ele fixa `removido_em = now()` e `removido_por`. O app ganha `UPDATE (removido_em, removido_por)` e uma policy de UPDATE com o mesmo recorte de inquilino.
- RLS: o SELECT continua permitindo a linha e o filtro `removido_em IS NULL` vive no repositório. Escolha por ser a mais simples e segura aqui: a policy de leitura é a mesma de quatro tabelas e esconder só a do plano não esconderia versões, execuções nem eventos, que o worker e a auditoria precisam ler. Todo caminho do repositório (plano, lista, painel, `clienteDoRecurso`, versões, eventos, execuções, reserva do worker, escrita de versão, evento e execução) filtra o plano removido e devolve não encontrado; `core.strategy_runs_pendentes` ignora execução de plano removido, e a reserva e a atualização do worker também. A auditoria é `strategy.plan.removed` (organização, cliente, plano, tipo; sem conteúdo).
- Corrida entre remover e criar versão ou execução: a escrita de versão e de execução trava a linha do plano com `FOR SHARE` (e só segue se `removido_em IS NULL`) na mesma transação, e a remoção a trava com `FOR UPDATE`; uma das duas espera a outra e a perdedora recebe não encontrado. A reserva e a atualização do worker também filtram o plano removido.
- Apagar o usuário (LGPD) faz `removido_por` virar `NULL` por `ON DELETE SET NULL`; o gatilho aceita só essa transição, fora do app e com o resto da linha igual, como já faz com `author_user_id` nas versões.

### 4. Edição de seção por campos, sem JSON bruto
- "Editar seção" deixa de abrir o JSON. A tela mostra um formulário por grupos, só com campos de conteúdo: no resumo executivo, objetivo, aposta, resultado esperado e verba (em reais); no plano de mídia, valor e justificativa dos campos do catálogo (rótulo é a chave do campo, tipo vem do catálogo: escolha vira lista, número, texto, lista de itens em linhas). Ids, URNs, refs, hashes, evidências, papéis, hipótese, a intenção fixa, os campos de destino, UTM e WhatsApp (cópia da intenção) qualquer chave desconhecida e os campos de URL ou identificador de destino sem papel (`adset_po_store_url`, `adset_po_pixel_id`) não aparecem: a lista é uma regra explícita por seção, não "toda string".
- A ação recebe só pares caminho e valor, relê a versão no servidor, aplica apenas os caminhos que o view-model gera para ela (caminho fora da lista, tipo errado e tamanho acima do limite são recusados por campo), monta a seção e chama `editarManual`, o mesmo serviço de antes: esquema, privacidade, referências, nova versão e revisão, sem relaxar nada. Recusa `json` no envio e mantém a checagem "o plano mudou enquanto você editava". O erro do esquema é mapeado para o campo. A tela não recebe mais o JSON da seção.
- Só o resumo executivo e o plano de mídia são editáveis pela tela; as outras seções mudam por "Pedir mudança ao agente". A intenção, antes editável pelo JSON, passa a ser fixa na tela.

## Consequências

- Migração 0151, aditiva: colunas `foco`, `removido_em` e `removido_por`, função `core.strategy_plan_foco_valido` (formato e URN do mesmo cliente no CHECK), policy e grant de UPDATE restritos, gatilho novo, `strategy_runs_pendentes` filtrada e o limite do `pedido` das execuções de 8 para 16 KB (o foco com 20 produtos entra na intenção). Nenhum DROP de tabela ou coluna; fora do corte-gate.
- O foco não entra na redação LGPD: guarda só rótulos do catálogo do cliente passados por `textoSeguro` e URNs; o `pedido` que o contém já é redigido junto com a versão. Se o rótulo de produto passar a poder carregar dado pessoal, a redação precisa cobri-lo.
- Cada plano novo exige o foco no pedido; plano antigo continua legível sem foco e sem gate novo.

## Adendo: plano sem versão mostra o pedido, repete após cancelamento e reabre o formulário (24K-132)

Em produção, um plano cuja execução falhou cedo ou foi cancelada antes da primeira versão abria uma página só com o status e "Apagar plano": o que foi pedido não aparecia e não havia caminho para corrigir.

- **Pedido visível.** Sem versão, a página do plano mostra o bloco "O que foi pedido" (objetivo, foco, plataformas, landing page, horizonte, verba, retorno e ousadia), lido da intenção guardada na execução de criação e validado pelo `esquemaIntencao`. Pedido que não passa no esquema (plano antigo ou já redigido pela LGPD) não vira bloco. O título do plano passa a ser o objetivo do pedido. O leitor vê o bloco, sem ações.
- **Tentar de novo após cancelamento.** A execução de criação cancelada pode ser repetida com o mesmo pedido, pela mesma ação e com a mesma permissão (`criar`) da repetição após falha. A regra única fica em `execucaoRepetivel` (domínio): `corrigir_gate` nunca repete, cancelamento só repete criação, falha só repete com código repetível. Ajuste e revisão cancelados continuam fora, porque a pessoa os cancelou sobre uma versão que ela pode editar.
- **Editar e pedir de novo.** A identidade do plano (tipo, plataformas, landing page e foco) é imutável, então editar o pedido não altera o plano: o botão abre o formulário de novo plano já preenchido (`?novo=1&de=<plano>`) e o envio cria um plano novo, com chave de idempotência nova. O plano de origem continua na lista até ser apagado. O plano de origem é lido por `painelDoPlano` no escopo da organização e do cliente da rota; id de outro cliente apenas deixa o formulário vazio.
- **Erro de campo some ao corrigir.** No formulário em passos, o erro devolvido pelo servidor deixa de ser mostrado, no campo e no indicador de passos, assim que a pessoa altera aquele campo. Antes, "Escolha a landing page" continuava na tela com a página já escolhida, até o envio seguinte. A validação do servidor não muda.
- **Lacuna de LGPD conhecida.** A redação (`core.redigir_plano`) parte de uma versão: o `pedido` de um plano que nunca teve versão não tem como ser redigido hoje. A lacuna é anterior a este adendo; por causa dela o bloco não mostra o WhatsApp. Fechar pede uma função de redação por plano, que aceite plano sem versão e redija `strategy_plan_runs.pedido` e `strategy_plans.whatsapp`, em migração própria.

Sem migração e sem mudança de infra.
