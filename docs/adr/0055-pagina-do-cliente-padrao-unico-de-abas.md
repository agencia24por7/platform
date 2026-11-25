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
- "Novo negócio" sai do cabeçalho do cliente; fica na lista.
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
