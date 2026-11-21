---
status: accepted
date: 2026-11-21
---
# ADR-0036: Página do cliente em dois blocos, Conexões e Contexto

Revisado por um comitê de design, UX e produto antes de implementar (pareceres resumidos em "Comitê").

## Por que mexer

A página do cliente tem 6 abas (Visão geral, Contexto, Brain, Dados, Acessos, Configurações). Lida como gestor
de agência no app local:

- **Conexões espalhadas:** contas vinculadas em *Dados*; convites de integração, links do mapa de contexto e
  "outros jeitos de pedir acesso" em *Acessos*; "Conectar conta" no topo; "Vincular conta ou fonte" em *Dados*;
  "Vincular a primeira conta" em *Próximos passos*. Quatro entradas para o mesmo ato.
- **Contexto espalhado:** descrição, redes e catálogo na *Visão geral* e de novo em *Contexto*; "Enviar mapa de
  contexto" no topo e em *Acessos*; o *Brain* é a leitura do mesmo contexto.
- **Três medidores da mesma coisa** na Visão geral. *Configurações* ocupa uma aba para quase nada.

## O produto que a página alimenta

Diagrama da solução: **Agência → Cliente → Conexões → coleta/mapeamento → armazenamento → planejamento (ICP,
pesquisa de mercado, regras das conexões, budget e metas, contexto do cliente) → plano de estratégia → sugestão
de caminhos → comitê → gate de aprovação → métricas**. A página do cliente é a entrada de dois insumos: **o que
está conectado** e **o que sabemos do negócio**. O resto entra depois como novos blocos, e a estrutura não pode
impedir.

## Decisão

Dois blocos no topo, no lugar de seis abas. Seções internas por `?secao=` (duas rotas, sem subrotas).

```
Cliente  [nome · situação ⋯]                                   [ação principal]
 ├─ Conexões   estado do bloco
 │    Fontes          contas e fontes por plataforma; problema primeiro; frescor e atraso em cada linha
 │    Pedir ao cliente  um só fluxo: link com plataformas e mapa de contexto juntos; convites pendentes (mínimo)
 └─ Contexto   estado do bloco
      Perfil          descrição, redes, catálogo, seções A–K em etapas
      Brain           o que sabemos e como o motor enxerga (leitura)
```

- **Faixa de prontidão fundida às abas:** cada aba mostra rótulo, estado e, se houver, o próximo passo. O veredito
  vem de `capacidades` do Brain (ADR 0030): **Pronto para planejar: sim, parcial ou não**, com as 2 ou 3 lacunas
  que bloqueiam, ordenadas pelo peso de `diagnostico.ts`. Percentual de completude fica só dentro de Contexto.
- **Ação principal do cabeçalho** = primeira ação de `diagnostico.acoes` (reautorizar passa na frente de enviar
  mapa). Sem pendência, sem botão. Um único ponto de entrada para "conectar conta" na página.
- **Situação e arquivos** no menu `⋯` do cabeçalho (some a aba Configurações). Só ações destrutivas e arquivos.
- **Cobertura vira parte de Fontes**, não seção: frescor, atraso e lacuna são atributos da linha. Lista ordenada
  com o que pede ação no topo (padrão HubSpot); tudo ok recolhe em densidade baixa.
- **Cinco estados com ícone, cor e rótulo de uma palavra:** ok, atenção, reautorizar, vazio, pausado/erro.
  "Reautorizar" tem botão próprio, nunca "Conectar". Cor nunca é o único sinal.
- **Rota padrão fixa:** `/clientes/[id]` abre sempre em Conexões. A faixa mostra o próximo passo em qualquer
  tela. Rotas antigas redirecionam (tabela abaixo), inclusive `?enviar=contexto`.
- **Texto mínimo** para o gestor. Para o anunciante o texto de segurança e do que a agência verá fica.
- **Lista de clientes** mostra o veredito de prontidão por cliente (uma agência com 50 clientes decide ali).

### Anunciante (segunda persona)

A página pública `/convite/[token]` já é unificada ("Dois passos": conectar, depois o mapa, com progresso e
salvamento). Não reconstruímos: alinhamos ao mesmo vocabulário (Conectar contas / Contexto) e aos mesmos cinco
estados, e fechamos as lacunas: foco volta à mesma conta ao retornar do OAuth, "não uso esta plataforma", estados
de autorização negada, sem permissão e expirada com a ação certa, e tela final. Pelo link público não sai campo
não compartilhável nem anotação interna (verificado no servidor).

### Tabela de migração de telas

| Tela antiga | Destino |
| --- | --- |
| Visão geral | faixa de prontidão (abas) + `/clientes/[id]` → Conexões |
| Dados | Conexões › Fontes |
| Acessos (convite, mapa, links, outros jeitos) | Conexões › Pedir ao cliente |
| Contexto | Contexto › Perfil |
| Brain | Contexto › Brain |
| Configurações | menu `⋯` do cabeçalho |
| `contas/nova` | mantida, aberta pelo bloco Conexões |
| `convite/novo` | redireciona para Conexões › Pedir ao cliente |

## Comitê (resumo das decisões)

- **Aceito:** fundir faixa e abas; Cobertura dentro de Fontes; unir Acesso e Pedir; estados com ícone; ação
  principal vinda de `diagnostico`; prontidão por `capacidades`; rota padrão fixa; tabela de migração no ADR;
  lista de clientes com prontidão; critérios de aceite do produto.
- **Adiado, com registro:** bloco **Metas e limites** (objetivo, orçamento, teto, restrições duras, com estado
  "aprovado pelo anunciante"). Produto mostrou que são normativos e não podem ficar como "desejo" do mapa quando
  o motor autônomo existir. Exige dado novo e aprovação; fica para o ADR do plano de estratégia. Hoje a seção J
  do mapa segue como está.
- **Mantido contra o comitê:** Brain dentro de Contexto (decisão anterior do dono do produto) com a metade de
  conexões já refletida em Fontes e na faixa.
- **Edição concorrente:** o salvamento por versão e o estado de conflito já existem; mostrar autoria por campo
  ("preenchido pelo cliente") entra se o dado já estiver disponível; revisão pós-envio e aviso de link aberto
  ficam para depois.

## Critérios de aceite

1. Toda função das seis abas tem destino na tabela, com teste por rota antiga redirecionando.
2. O veredito da faixa é o de `capacidades` do mesmo cliente.
3. A ação principal é a primeira de `diagnostico.acoes`; conexão `reauth_pending` mostra "Reautorizar".
4. "Conectar conta" aparece uma única vez na página.
5. O link público não devolve campo não compartilhável nem anotação interna.
6. Cliente de outra organização ou excluído responde 404 em todas as rotas novas.
7. Fluxos principais em 360 px, só com teclado, sem violações graves de acessibilidade.

## Restrições

- Nenhum dado novo nem mudança de banco: reorganização de telas, rotas e textos sobre serviços atuais.
- Reaproveitar `.abas`, `.pill`, `.chip` e `Anel`; nenhuma segunda linguagem visual.
- Sem comentários no código; o porquê fica aqui.

## Implementação (feito)

| Tela antiga | Onde está agora |
| --- | --- |
| Visão geral: descrição, redes, catálogo | Contexto › Perfil (editor atual, sem cópia) |
| Visão geral: completude por seção, atividade recente | Contexto › Perfil (completude no editor; atividade recente recolhida) |
| Visão geral: próximos passos e saúde dos dados | faixa de prontidão (abas) e ação principal do cabeçalho; frescor em Conexões › Fontes |
| Dados | Conexões › Fontes (lista com problema primeiro; um só "Conectar conta"; "Reautorizar" próprio) |
| Cobertura (frescor, atraso) | atributo de cada linha de Fontes |
| Acessos: convite, mapa, links, outros jeitos | Conexões › Pedir ao cliente (um fluxo: plataformas e contexto no mesmo link; pendentes recolhidos) |
| Contexto | Contexto › Perfil |
| Brain | Contexto › Brain (rotulado como leitura) |
| Configurações: situação, arquivos, Brain publicado | menu `⋯` do cabeçalho |
| `/clientes/[id]` e rotas antigas | redirecionam (`destinoDaRotaLegada`), com a busca preservada; `?enviar=contexto` vai para Pedir |

Decisões de implementação:

- **Veredito** (`prontidao.ts`): sim quando todas as capacidades estão disponíveis; não quando nenhuma está disponível
  nem parcial; parcial no resto. Lacunas: até 3 ações de `diagnostico.acoes` por impacto. Estado de cada bloco vem do
  `diagnostico` (reautorizar, vazio, atenção, ok; contexto: vazio, parcial, completo).
- **Ação principal**: primeira de `diagnostico.acoes`. Contexto vazio vira "Enviar mapa" na agência. Conectar e reautorizar usam
  o rótulo específico ("Conectar Meta Ads", "Reautorizar Meta Ads"); no anunciante conectar vira "Conectar conta". O botão
  "Conectar conta" de Fontes só aparece quando o cabeçalho não tem ação de conectar ou vincular, então a página tem um
  único ponto de entrada. Reautorizar não esconde o botão, porque não adiciona conta nova. Membro com recorte só recebe
  ação de contexto. Quem só consulta não
  recebe ação.
- **`?secao=` em Contexto**: `brain` abre o Brain; qualquer outro valor abre o Perfil, e chaves do catálogo (`empresa`,
  `produtos`...) continuam rolando o editor até a seção. Os links antigos seguem válidos.
- **Estados da fonte** (`fontes.ts`): reautorizar, erro, atenção, vazia, pausada, ok. Ordem de problema primeiro.
- **Lista /clientes**: veredito por cliente, com consultas ao Brain em lotes de 4 e teto de 30 clientes não arquivados;
  do 31º em diante aparece "—". Próximo passo: uma agregação única (consulta por organização) no lugar de um snapshot
  por cliente.
- **Pedir ao cliente**: `criarPedidoAoCliente` cria o convite de integração (mesma validação, auditoria e permissão da
  ação anterior) e o link do mapa com `conviteDeIntegracaoId`; se o link falha, o convite criado é revogado.
- **Anunciante convidado** (`/convite/[token]`): vocabulário Conectar contas / Contexto, estados com ícone e rótulo,
  volta do OAuth com foco na conta, "Não uso esta plataforma" (guardado só na URL, sem banco: a agência não é avisada),
  mensagens para autorização negada, sem permissão, expirada e convite inválido, e tela final. O servidor já filtra
  campo não compartilhável e nota interna em `core.contexto_link_ler`; há teste de integração.
- **Fora desta entrega**: percentual de cobertura por tabela dentro de Fontes (fica no Brain), autoria por campo,
  Metas e limites.

## Anunciante direto

Organização `type='advertiser'` gerencia os próprios anúncios, sem agência. Vocabulário em um lugar só
(`organizations/domain/vocabulario.ts`).

- Negócio no lugar de cliente em cabeçalho, lista, mensagens, papéis e menu. Rotas `/clientes/*` ficam.
- Pedir ao cliente vira **Convidar** (colega ou consultor, secundário). A ação principal usa "Conectar conta" ou
  "Preencher contexto", nunca "Enviar mapa" nem "Pedir ao cliente"; o Perfil não oferece envio.
- Com exatamente um negócio não excluído (ativo, pausado ou arquivado), `/clientes` redireciona para ele e o menu
  lateral esconde a entrada "Conexões" da organização (a rota `/integracoes` continua). Com zero ou dois ou mais, lista
  normal. "Novo negócio" existe também no cabeçalho do negócio para owner e admin, senão o anunciante nunca passaria de
  um para dois.
- Em `/config` o anunciante não vê "Como esta organização trabalha" nem Conta administradora e Business Manager.
  `changeType` agora exige papel `owner` no serviço (vale para a ação do servidor, não só para a tela). A mudança de
  anunciante para agência é só de ida e intencional: o anunciante não vê o seletor, então não volta sozinho.
- Fora de escopo, para a revisão de segurança: `any_organization_exists()` global, inferência de tipo por contagem em
  `authorizationService.ts`, multi-negócio agregado, papéis e convite de colega.

## Correções da revisão

- **Estado ao vivo**: a prontidão soma ao `diagnostico.acoes` uma ação de reautorizar para toda conexão que precisa
  (`precisaReautorizar` ou revogada), sem depender de catálogo publicado. Com reautorização pendente o veredito nunca é
  "sim". As lacunas da faixa só listam o que bloqueia capacidade (reautorizar, vincular, conectar, coleta parada,
  contexto essencial).
- **Fontes agrupadas por conexão**: uma ação "Reautorizar" por conexão, com contas e fontes dentro do grupo.
- **Escopo por cliente**: todas as ações de Conexões e de Pedir validam o id, o recorte (`ctx.clientIds`), que o cliente
  é da organização e não está excluído, que a conta ou fonte pertence ao cliente informado e que o destino de uma
  movimentação também está no escopo. Teste de integração em `tests/escopo-por-cliente.test.mjs`.
- **`convite/novo`**: virou redirecionamento para Pedir ao cliente e a ação antiga foi removida; o fluxo único é o
  diálogo de Pedir.
- **Convite público**: "não uso esta plataforma" viaja no retorno do OAuth (`nao` no `returnTo` validado por
  `isSafeReturnPath`); erro de autorização volta com `plataforma`, foco na conta e "Tentar de novo"; convite expirado
  ou revogado não mostra item como pendente; sucesso só aparece se o item está concluído.
- **Menu `⋯`** também para quem só consulta (arquivos e Brain publicado, sem ação de escrita). Qualquer rota antiga com
  `?enviar=contexto` vai para Pedir.
- **Carregamento**: `montarSnapshotDoCliente` e `carregarContexto` usam o cache de requisição do React. Medido por
  requisição em `/contexto?secao=brain`: snapshots do Brain 2 antes, 1 depois; em `/contexto`: carregamentos de
  contexto 2 antes, 1 depois; demais telas ficam em 1 e 1. O snapshot ainda carrega o contexto por dentro (reuso fica
  para a agregação).
- **Acessibilidade**: axe-core 4.10.2 sem violações em Conexões, Pedir, Contexto, Brain e convite público (ajustes:
  `--fg-subtle` mais escuro, lista de definição e região rolável do Brain, ícone do `⋯`). Teclado validado no menu `⋯`,
  em "Mais" de Fontes e no diálogo de Pedir (abre, Esc fecha e devolve o foco).
