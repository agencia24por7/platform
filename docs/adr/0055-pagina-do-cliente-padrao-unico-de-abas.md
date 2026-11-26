---
status: accepted
date: 2026-11-24
---
# ADR-0055: Página do cliente com um padrão único de aba, cabeçalho e formulário

Supera em parte o ADR 0050 (cabeçalho, abas, Brain e formulário de Regras). Os três blocos (Conexões, Contexto e Regras) e as rotas do ADR 0036 e do ADR 0051 continuam valendo.

## Por que mexer

Auditoria do código e da página ao vivo (24K-113) mostrou cada aba desenhada de um jeito:

- O cabeçalho empilha situação, prontidão e lacunas de Regras, e a mesma lacuna reaparece dentro da aba Regras.
- Cinco estilos de título de seção, três componentes de estado vazio, três de campo, e botões de 32 e 38 px na mesma linha.
- A ação principal muda de lugar em cada aba, e "Vincular Google Analytics" aparece até em Regras e Brain.
- Ações destrutivas (Desvincular, Revogar, arquivar) enviam sem confirmação.
- O menu "…" do cabeçalho abre cortado no celular.
- O formulário de Regras pede 12 campos de uma vez; o Brain abre com título display e URN cru.

## Decisão

### Cabeçalho
- Nome, uma linha de fatos e a ação principal, que só aparece nas abas onde faz sentido (Conexões e Contexto).
- Um único resumo de prontidão recolhido, que reúne as lacunas do planejamento e as de Regras. A aba Regras não repete o bloco.
- "Novo negócio" fica no menu "…" do cabeçalho (só anunciante, dono ou admin, organização inteira), além da lista: o anunciante com um só negócio é levado direto a ele e nunca vê a lista. Isso preserva o ADR 0036.
- Estado do Brain e uso de arquivos saem do menu "…" e vão para as abas Brain e Contexto. O menu fica só com a situação, e arquivar pede confirmação.
- O popover do menu respeita a largura da tela.

### Padrão de aba
- Cada aba abre com título, uma linha de descrição e a ação primária à direita (`CabecalhoDeSecao`).
- Subnavegação de segundo nível menor que as abas, com contador no mesmo formato.
- Um só estado vazio (`EstadoVazio`), um só campo de formulário, botão normal para ação da página e compacto só dentro de linha.
- Ação destrutiva abre diálogo de confirmação (`ConfirmarAcao`) antes de enviar.
- Azul só em ação e foco: o banner de "Pedir ao cliente" fica neutro.

### Abas
- Conexões: linha de conta sem ID cru nem detalhe repetido; busca quando há muitas contas; Pendentes abre quando há pendência e some com zero; status de pedido em português.
- Contexto: sai o botão desabilitado de sugestão e a atividade recente repetida; uma barra de progresso por passo; chips com seleção única ou múltipla indicada.
- Regras: formulário só com natureza, valor ou texto e título; o restante em "Detalhes opcionais"; filtros aplicam ao mudar; Registrar e Alterar têm indicador próprio.
- Brain: resumo em uma faixa; catálogo sem URN cru por padrão; mais filtros recolhidos.

### Feedback
- Sucesso é aviso efêmero, erro fica junto do campo, autosave só no Contexto.

## Consequências e cuidados
- Nenhuma função some, nenhuma rota muda e nenhuma migração entra. O escopo por cliente (`escopoDoClienteNaOrganizacao`) não muda.
- Teste que dependa de texto de interface é atualizado no mesmo PR.

## Critérios de aceite
1. O menu "…" cabe em 390 px.
2. As lacunas de Regras aparecem uma vez só na página.
3. "Vincular Google Analytics" não aparece em Regras nem no Brain.
4. Desvincular, Revogar e arquivar pedem confirmação.
5. O formulário de Regras mostra no máximo cinco campos antes de "Detalhes opcionais".
6. Typecheck, unit, build e integração passam.

## Fase 2a (Conexões e Contexto)
- A subseção "Perfil" passa a se chamar "Mapa de contexto" (chave `perfil` e URL iguais).
- A barra de cada passo mostra o progresso do essencial; sem campo essencial, mostra o percentual da seção. O aprofundar aparece só dentro da seção. Antes, seção sem essencial mostrava barra cheia com 0%, e o percentual ao lado (ponderado) divergia da barra.
- `VERSAO_DO_CATALOGO` sobe de 2 para 3 (ajuda de "Modelo de negócio" reescrita). Brains já publicados ficam no catálogo 2 até a próxima edição; depois do deploy, rodar `scripts/contexto-reconstruir-brain.mjs` (ADR 0028, leia o `--help` e o alvo antes).

## Fase 2b (Regras)
- Formulário: natureza vira escolha segmentada (radio, mesmo `name="natureza"`). Antes de "Detalhes opcionais" ficam natureza, tipo de limite, valor e escopo (lado a lado), título ou texto, e força. Evidência, "em nome de", "por quê" e vigência ficam recolhidos e o grupo abre sozinho com valor inicial ou erro. No modo alterar o motivo continua obrigatório e visível, fora do recolhido.
- O aviso de dado pessoal (LGPD) sai do topo e fica junto dos campos de texto; em limite, que não tem título nem texto, fica dentro de "Detalhes opcionais", junto do "por quê".
- Filtros da linha do tempo aplicam ao mudar (`FiltrosDaLinha`, `requestSubmit` do form GET). Sem JS, o botão "Filtrar" aparece via `noscript`.
- Registrar e Alterar ganham item próprio na subnavegação, ativo, em vez de marcar "O que vale hoje". A descrição da seção vem do `CabecalhoDeSecao`; o título solto e os parágrafos de apoio saíram.
- Cartão vira linha expansível (`details`): resumo com título, valor e escopo, força em pill com ícone e vigência; detalhe com por quê, evidência, quem decidiu e ações. Em Propostas e Revisar, Aceitar, Rejeitar e Converter ficam visíveis na linha. Revogar e Rejeitar passam por `ConfirmarAcao`, com o motivo dentro do diálogo.
- "Superada por nova versão" vira "Substituída por nova versão" nos eventos. Os rótulos "Bloqueia" e "Orienta" já estavam no domínio.

## Fase 3 (Brain e feedback)
- Brain: o pulso vira uma faixa compacta, com anel de 72 px, título de seção, a frase "N entradas preenchidas · atualizado X" (a versão ficou no `title`) e as três medidas em grade responsiva, com a ajuda em uma linha só (reticências e `title`). Sem eyebrow nem fundo decorativo.
- Catálogo: a linha mostra título e tipo; a URN fica no `title` e, dentro do detalhe, ganha botão "Copiar URN". Só a busca fica sempre visível; Tipo, Plataforma, Sensibilidade e Frescor ficam em "Filtros", que abre sozinho (com contador) quando há filtro ativo. "Mostrar o que falta" e Tabela/Cartões dividem uma barra com a busca.
- Feedback: `AvisoEfemero` (client) substitui o banner `Feedback` só nas páginas Conexões, Contexto e Regras. O servidor continua renderizando a mensagem (sem JS ela fica visível). Com JS, os parâmetros `erro` e `feito` saem da URL por `history.replaceState`, então não voltam no reload; sucesso (`role="status"`) fecha em 6 s e erro (`role="alert"`) fica até fechar. Nenhuma action mudou. `Feedback` segue valendo nas demais telas (config, integrações, novo cliente, nova conta, organização).
- Texto: "Superada" virou "Substituída" (rótulo de status e aviso após Alterar), "Cadeia de superação" virou "Versões da regra", a dica do menu do cabeçalho perdeu o número de ADR, e os textos do Brain que citavam ADR (retenção e descrição de Regras) foram reescritos. `VERSAO_DO_CATALOGO` não mudou, mas o hash do `catalogo.md` muda com esses textos.
