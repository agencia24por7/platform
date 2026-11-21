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
| `contas/nova`, `convite/novo` | mantidas, abertas pelo bloco Conexões |

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
