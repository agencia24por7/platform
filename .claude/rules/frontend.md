---
paths:
  - "app/**"
  - "proxy.ts"
  - "next.config.mjs"
---
# Frontend e server actions (Next.js 16)

- Leia `node_modules/next/dist/docs/` antes de escrever: APIs e convenções diferem do que você conhece.
- Server action e rota sob `app/clientes/[id]/` valida o escopo do cliente na organização com `escopoDoClienteNaOrganizacao` (`app/clientes/[id]/_escopo.ts`) antes de ler ou gravar. Teste em `tests/escopo-por-cliente.test.mjs`.
- Texto que muda entre agência e anunciante vem de `vocabularioDe(tipo)` (`src/modules/organizations/domain/vocabulario.ts`), nunca de string fixa.
- Página do cliente: cinco abas, nenhuma com subabas (ADR 0071): Conexões (Fontes, "Pedir ao cliente" ao lado de "Vincular", Outros jeitos), Contexto (mapa ao vivo e taxa global no topo; Brain recolhido; Mapa de contexto recolhido, com o Destino como último item da lista), Regras (vigentes em cards e, ao lado, Propostas e Revisar), Estratégia (lista de planos em cards, novo plano em passos e uma página por plano, com Resumo executivo e Plano de mídia; Comitê, Gates e histórico não aparecem ao usuário; foco, apagar e edição por campos no ADR 0070) e Atividade (Pedidos ao cliente, Histórico do contexto, Linha do tempo de Regras). Nenhuma lógica de estado, permissão, rótulo ou validação nos componentes: eles só renderizam view-models de `src/modules/*/domain/painel/` e `src/modules/strategy/interface/`. Decisões nos ADRs 0036 e 0071; mudança de estrutura pede ADR novo.
- Arquivo do contexto sai só como `attachment` (ADR 0027); a única exceção é a logo do cliente, em linha e com os limites do ADR 0071.
- Página pública por token não vaza dado de outro cliente nem de outra organização.
- Acessibilidade: tela principal nova passa por axe sem violação.
- Cor, tipografia e azulejo vêm da identidade (`docs/marca/LEIA-ME.md`): azul só em ação e foco, laranja só em oportunidade, estado sempre com ícone e texto.
