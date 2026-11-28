---
status: accepted
date: 2026-11-27
---
# ADR-0071: Página do cliente com aba Atividade, abas sem subabas, Contexto com mapa ao vivo e logo no cabeçalho

Supera em parte os ADRs 0036, 0050 e 0055 (subabas de Conexões, Contexto e Regras, e desenho do cabeçalho). Supera em parte o ADR 0027 só no ponto "download sempre como `attachment`", para a logo do cliente. Os blocos, as rotas das abas, o escopo por cliente (`escopoDoClienteNaOrganizacao`) e as regras de Regras (ADR 0051) e da Estratégia (ADRs 0069 e 0070) continuam valendo. Issue 24K-135, decidida pelo dono do produto em 2026-11-27.

## Por que mexer

Cada aba tinha a própria subnavegação, e o histórico estava espalhado: pendentes e convites em Conexões › Pedir, revisões do contexto num diálogo do editor, linha do tempo em Regras. A lista de clientes e o cabeçalho usavam pill colorida para tudo, e o anunciante não via a própria marca em lugar nenhum.

## Decisão

### Lista de clientes
- Modelo, Situação e Pronto para planejar viram texto na cor normal. Só a bolinha da situação e o ícone do veredito têm cor (`Indicador`, classe `marcador`).
- Os arquivados saem da lista principal e abrem por um atalho com ícone no topo da tabela (`?lista=arquivados`). O filtro de situação não aceita mais "arquivado". Regra em `domain/painel/listaDeClientes.ts`.

### Cinco abas, nenhuma com subabas
- **Conexões**: Fontes direto. "Pedir ao cliente" vira botão secundário ao lado de "Vincular" (antes "Vincular Google Ads"; a plataforma fica no `title`). Quando a ação principal é de conexão, ela sai do cabeçalho nessa aba para não duplicar (`abaComAcaoNoCabecalho`). "Outros jeitos" (MCC do Google Ads e parceiro do Meta) fica abaixo das fontes.
- **Contexto**: o topo é o mapa ao vivo do Brain com a taxa global de preenchimento. Catálogo, "O que o Brain consegue responder" e "Próximas ações" ficam recolhidos. Linha de cobertura e "Como um agente enxerga" continuam, recolhidos, para nenhuma função sumir. O pulso duplicado sai. O Mapa de contexto vira bloco recolhido que mostra só o total e abre sozinho quando a URL pede seção ou campo. A lista de seções mostra uma taxa global em vez de uma barra por item, e o Destino (WhatsApp e landing pages) é o último item da lista. Campo preenchido aparece fixo, com lápis para editar e "Concluir" para voltar; campo vazio abre em edição. Regras em `mapaDeContexto.ts`, `contexto/leitura.ts` e `visaoDoDestino.ts`.
- **Regras**: as vigentes viram cards menores, em grade, e dividem a tela com Propostas de agentes e Revisar e converter. Registrar, Alterar e Versões continuam como seções por URL, sem subnavegação.
- **Estratégia**: o formulário de novo plano vira um assistente de cinco passos no mesmo `<form>` e na mesma action, e a verba pode ser informada por mês ou pelo período (ver abaixo).
- **Atividade** (nova): três seções empilhadas, sem abas: Pedidos ao cliente (pendentes com Copiar e Revogar, e o histórico), Histórico do contexto e Linha do tempo de Regras (filtros e páginas). As actions de revogar voltam para cá. Regra em `domain/painel/atividade.ts`.
- Links antigos continuam abrindo: `secao=pedir` e `/acessos` caem em Conexões ou Atividade, `secao=brain` e `secao=perfil` caem no Contexto, `secao=linha` some (a linha do tempo está em Atividade).

### Verba por mês ou pelo período
- O plano continua guardando só a verba do horizonte. Sem migração. Se a pessoa escolhe "por mês", o servidor converte: total = mensal × dias do horizonte (inclusivos) / 30, arredondado a centavos (`interface/verbaDoPlano.ts`). A revisão do assistente mostra o total e o equivalente por mês. O modo não é gravado; se um dia precisar aparecer no plano, é decisão nova com migração.

### Cabeçalho e logo
- Cabeçalho no padrão de `page__head`: logo ou monograma neutro, nome, uma linha de fatos e as ações; abaixo, uma faixa com Situação e Pronto para planejar (sugestões recolhidas). Regra em `domain/painel/cabecalho.ts`.
- A logo é o arquivo mais recente do campo `logo` (seção Marca) do Mapa de contexto, já existente no catálogo. Sem logo, quem edita vê "Adicionar logo", que abre esse campo. `VERSAO_DO_CATALOGO` não muda.
- Exceção ao ADR 0027: `GET /api/contexto/[clienteId]/logo` serve a imagem **em linha**, porque `attachment` não aparece numa `<img>`. Limites que valem só aqui:
  - sessão e escopo do cliente (`clienteNoEscopo`) e a mesma visão por papel do contexto: quem só vê recebe a logo apenas se a equipe a compartilhou (ADR 0062);
  - só png, jpeg, webp ou gif (tipo decidido pelos bytes no envio), do campo `logo`, fora de item de lista, até 5 MB (conferido no registro e de novo no objeto lido);
  - caminho conferido no prefixo do cliente antes de ler o bucket;
  - `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: private, max-age=300, must-revalidate` e `ETag` do sha256; com `If-None-Match` igual, 304 sem ler o bucket.
- Todo outro arquivo continua só como `attachment`.

## Consequências e cuidados
- Nenhuma migração e nenhuma mudança de RLS. Rotas novas: `/clientes/[id]/atividade` e `/api/contexto/[clienteId]/logo`.
- O layout passa a carregar o contexto em toda aba (para a logo). A leitura é cacheada por request e já era feita na aba Contexto.
- Os componentes só renderizam: filtro, classificação, rótulos, passos, verba e cabeçalho vivem no domínio ou em `interface/`, com teste de unidade. Os carregadores em `app/` derivam a organização da sessão (`carregarPainel`), como exige a fronteira do ADR 0028.
- Testes de integração que dependiam das subabas foram atualizados no mesmo PR. O teste de que quem só vê não recebe valor interno passou a cobrir `/atividade`.

## Critérios de aceite
1. A lista de clientes não tem fundo colorido em Modelo, Situação nem Pronto para planejar, e os arquivados só aparecem pelo atalho.
2. Nenhuma aba do cliente tem subnavegação; Atividade mostra as três seções.
3. "Pedir ao cliente" fica ao lado de "Vincular" em Conexões, e há um único ponto de entrada para conectar.
4. O Contexto abre com a taxa global e o mapa ao vivo; o Mapa de contexto mostra só o total até ser aberto; campo preenchido abre em leitura com lápis.
5. O assistente de novo plano envia os mesmos campos de antes e converte a verba mensal.
6. A rota da logo devolve 401 sem sessão, 404 para cliente de outra organização ou sem logo, e nunca serve tipo fora da lista.
7. Typecheck, unidade, build e integração passam.
