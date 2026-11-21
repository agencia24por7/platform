# ADR 0031 — Página do cliente: arquitetura de informação, layout fluido, formulário público e seção Brain

- Situação: aceita
- Data: 2026-11-20
- Relacionadas: 0022 (exclusão lógica), 0030 (catálogo do Brain), 0026 (contexto do cliente), 0027 (armazenamento do contexto), 0028 (limite de corpo no Caddy)

## Contexto

A página do cliente era uma coluna de cards fixa em 1180 px, alinhada à esquerda, com convites (inclusive revogados) numa
lista permanente. O mapa de contexto (ADR 0026) tinha serviço completo, mas nenhuma interface; e o "company brain" ainda
não tem API pronta (PR `feat/brain-catalogo`, em paralelo). Abaixo de 760 px a barra lateral sumia sem navegação
alternativa — e, por ordem de cascata, nem sumia: ocupava a tela inteira antes do conteúdo.

## Decisões

### Layout global fluido

- Tokens novos em `app/tokens.css`: `--page-max: 1680px`, `--gutter: clamp(16px, 2.2vw, 40px)`, `--gap`, `--gap-lg`,
  `--fs-titulo`, `--fs-display`, `--alvo-toque: 44px`, e as cores de frescor (`--c-fresco|atrasado|parado|desconhecido`).
- `.page` ocupa a largura disponível até 1680 px, centralizada. Acima disso não se estica formulário: a página usa grades
  `auto-fit/minmax` (`.grade-auto`) e, a partir de 1900 px, colunas extras nas visões que têm conteúdo para isso.
- Pontos de quebra: 960 px (barra lateral → barra superior com botão de menu e gaveta), 640 px (cabeçalhos quebram,
  ações ocupam a largura, primeira coluna de tabela fica fixa no rolar horizontal), `pointer: coarse` (alvos de 44 px).
- A gaveta móvel é um `<dialog>` aberto com `showModal()`: o navegador dá foco preso, `Esc` e fundo inerte. Ela repete a
  mesma navegação, o trocador de organização e o menu do usuário. Animação só com `prefers-reduced-motion: no-preference`.
- Regras responsivas ficam no fim de `globals.css`; estilos de feature em `app/estilos/*.css`, importados no topo. Nada de
  `style=` novo: valores dinâmicos (anéis, barras, mapa) são atributos SVG, compatíveis com o CSP.

### Arquitetura de informação

> Superada em parte pelo ADR 0036: as seis abas viraram dois blocos, Conexões e Contexto.

Rotas aninhadas num grupo `app/clientes/[id]/(painel)/` com um layout comum (cabeçalho com situação, modelo, segmento e
anel de completude; abas fixas no topo ao rolar). As abas são rotas, não estado: `Visão geral`, `Contexto`, `Brain`,
`Dados`, `Acessos` e uma `Configurações` discreta. Cada aba carrega só o que mostra (o editor de contexto e o Brain são
componentes cliente apenas nas suas rotas). `contas/nova` e `convite/novo` ficam fora do grupo.

- **Dados** junta contas de anúncio e fontes, agrupadas por plataforma, com frescor da última coleta e as mesmas ações de
  antes (pausar/retomar, mover, desvincular). As server actions saíram da página para `dados/acoes.ts`.
- **Acessos** é deliberadamente mínima: dois botões primários (convite de integração, mapa de contexto) e resumos
  recolhíveis. Convites e links mostram só o que está pendente/ativo; o resto fica atrás de "ver histórico".
- **Configurações** concentra a mudança de situação; o cabeçalho mostra uma faixa quando o cliente está pausado ou
  arquivado. Cliente excluído (ADR 0022) não aparece: `byId` devolve 404.

### Editor de contexto

- Uma seção por vez, com trilho de passos (barra cheia = essencial, barra clara = aprofundar), seletor no celular, URL com
  `?secao=&campo=` para links diretos ("próximas ações" e Brain apontam para o campo exato).
- Campos renderizados pelo `tipo` do catálogo (`app/_components/contexto/Entrada.tsx`), compartilhados com o formulário
  público. Salvamento automático com espera de 900 ms e envio imediato ao sair do campo; `versaoEsperada` em tudo. No
  conflito o texto local não é descartado: "usar a versão atual" ou "manter a minha".
- Listas com "+", edição em linha, reordenação por arrasto ou botões ↑/↓ (teclado) e remoção com desfazer (a remoção só
  vai ao servidor depois de 6 s).
- Marcações Fato/Hipótese/Desejo e fonte por campo e item; "sugerido → confirmar" usa `confirmarSugestao`. O botão
  "Sugerir a partir do site/Instagram" existe desabilitado: é o gancho do próximo passo, sem chamada a IA.
- "Compartilhável com o cliente" é por seção: marca os campos e itens visíveis ao cliente daquela seção (`marcar`).

### Upload

Uploads vão por route handlers em `/api/contexto/{clienteId}/arquivos` e `/api/contexto/publico/{token}/arquivos`, único
prefixo que o Caddy libera acima de 1 MB (ADR 0028). Corpo binário cru com cabeçalhos `x-campo`, `x-nome`, `x-lista`,
`x-item`; progresso por `XMLHttpRequest`. O handler confere mesma origem, recusa `Content-Length` acima de 25 MB, lê o
corpo com limite e confere que chegou inteiro (o proxy do Next trunca em silêncio acima de `proxyClientMaxBodySize`,
agora 26 MB). A política de tipos e cota continua no serviço.

### Formulário público

- `/contexto/[token]` e `/convite/[token]/contexto` usam só os métodos públicos do serviço, com credencial `link` ou
  `convite`, IP confiável e `requestId`. Fora do shell autenticado, sem navegação interna.
- Cabeçalhos: `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex` (next.config) e
  metadados `robots`/`referrer`. `/contexto` e `/api/contexto` entram nas rotas abertas do `proxy.ts`.
- Fluxo: boas-vindas (tempo estimado, recado da equipe), uma seção por passo com rascunho salvo, revisar e enviar,
  confirmação. Link inválido, vencido ou revogado têm a mesma página amigável (não revelamos qual dos três); limite de
  taxa tem página própria.
- O link aparece uma única vez, no diálogo de envio, com mensagem pronta em pt-BR. Pode ser amarrado a um convite de
  integração (só quem administra); a página do convite passa a mostrar os dois passos com progresso.

### Seção Brain: serviço real, view-model e fixtures

- O Brain é um índice do que o cliente tem (conexões, fontes, tabelas, contexto, arquivos) mais governança (frescor,
  lacunas, capacidades, próximas ações). Vem do módulo `src/modules/brain` (ADR 0030), chamado no servidor por
  `modules().brain.montarNaOrganizacao(organizationId, clientId)`, nunca pelo endpoint HTTP do worker.
- Autorização: a aba só abre depois de `carregarPainel` (sessão, papel e recorte de clientes); a organização vem da
  sessão, não do resolvedor do worker (`core.brain_resolver_cliente` é só de `orla_worker`). O inventário roda com
  `withTenant`, então cliente de outra organização ou excluído não monta e a aba responde 404. Falha do serviço vira o
  estado "o Brain não respondeu agora", sem derrubar a página.
- `src/modules/clients/domain/painel/brain/doCatalogo.ts` converte o `Snapshot` (entradas, capacidades, diagnóstico)
  para o view-model da UI (`tipos.ts`, com os mesmos enums do esquema da entrada) e usa o `renderizarCatalogoMd` do
  módulo para a prévia "Como um agente enxerga". A série de 90 dias vem de `cobertura.desde/ate/lacunas`.
- `exemplo.ts` (fixture determinística a partir do catálogo de tabelas) ficou só para testes e desenvolvimento.
- Visualizações em SVG/CSS próprio, sem biblioteca de gráficos; toda visualização tem alternativa em lista/tabela.

## Consequências

- Rotas antigas continuam: `/clientes/{id}` é a visão geral; ações que redirecionavam para lá agora vão para a aba certa.
- O teste de integração de mover fonte aponta para `/clientes/{id}/dados`.
- `BrainService` ganhou `montarNaOrganizacao` (mesmo núcleo de `montar`, sem o resolvedor do worker) para a UI.
