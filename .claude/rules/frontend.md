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
- Página do cliente: quatro abas, Conexões (Fontes, Pedir ao cliente), Contexto (Mapa de contexto, Brain), Regras e Estratégia (Plano, Comitê, Gates, Histórico). Decisão e critérios no ADR 0036; uma mudança de estrutura ali pede ADR novo.
- Página pública por token não vaza dado de outro cliente nem de outra organização.
- Acessibilidade: tela principal nova passa por axe sem violação.
- Cor, tipografia e azulejo vêm da identidade (`docs/marca/LEIA-ME.md`): azul só em ação e foco, laranja só em oportunidade, estado sempre com ícone e texto.
