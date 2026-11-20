# 0016 — Modelagem do GA4 e do Search Console no BigQuery

- Status: aceito
- Data: 2026-11-20

## Contexto

GA4 gravava só `canal × dia` e o Search Console só `site × dispositivo × dia`.
As duas APIs deixam combinar dimensões, mas não todas entre si, e cobram por
requisição (tokens de cota no GA4, linhas por consulta no Search Console).
Um fato único com todas as dimensões não existe: o limite de 9 dimensões do
GA4 e a restrição de escopo entre dimensões de sessão, evento e item o
impedem, e no Search Console `query` e `page` explodem a cardinalidade.

## Decisão

- Um fato por recorte compatível, grão diário, `organization_id` + chave da
  fonte + `data_dia` + dimensões do recorte. Métricas em colunas tipadas.
  A lista de recortes é declarativa em `domain/recortesGa4.ts` e
  `domain/recortesSearchConsole.ts`; DDL, configuração do gravador e
  manifesto derivam dela, e um teste confere que o coletor n8n pede
  exatamente essas colunas.
- Dimensão ausente grava `(not set)` (valor que o GA4 já usa), nunca `NULL`:
  a chave do MERGE não pode ter `NULL`. O `(other)` do GA4 (linha agregada
  quando a cardinalidade estoura) é gravado como veio, é o resto da cauda.
- `padrao` continua existindo em cada plataforma (`fato_ga4_diario`,
  `fato_search_console_diario`) como total conferível do recorte mais grosso.
  Não vira view: a tabela já tem histórico em produção.
- GA4: uma requisição `runReport` por recorte, paginada por `offset` com
  `limit` 100000 e ordenação por todas as dimensões (paginação estável). A
  resposta é associada ao recorte pelos `dimensionHeaders`. Métricas
  escolhidas só entre as compatíveis com as dimensões do recorte. O recorte de
  itens (e-commerce) é opcional: um 400 que cite só nomes dele não falha a
  coleta, porque propriedade sem e-commerce não deve derrubar o resto.
- Search Console: uma consulta por recorte, paginada por `startRow` com
  `rowLimit` 25000, `dataState: final`. A API não ecoa a consulta na
  resposta, então cada recorte tem seu nó HTTP e um nó `Fechar` que reúne as
  páginas, em série (também poupa a cota por minuto). O recorte de
  `searchAppearance` é opcional pelo mesmo motivo do e-commerce.
- LGPD: só agregados. Consultas de busca já vêm anonimizadas pela API (termos
  raros que identificariam o usuário são omitidos e não entram em nenhuma
  linha); nenhuma dimensão de pessoa é coletada. `pagePath` do GA4 exclui a
  query string de propósito.
- Limites assumidos, não contornados: o Search Console devolve só as linhas
  de maior tráfego por consulta (teto interno por dia e por site) e, para
  `query × page`, os totais não batem com os de `site × dispositivo` por causa
  do filtro de anonimização; o GA4 agrupa a cauda em `(other)`. Compare totais
  só dentro do mesmo recorte.

## Consequências

- Cada coleta passa de 1 para 8 requisições no GA4 e de 1 para 5 (mais
  páginas) no Search Console; `query × page` domina o volume.
- Recorte novo = entrada na lista declarativa + nova consulta no coletor +
  DDL (tabela, staging, view) no mesmo molde de `22_ga4.sql`/`23_searchconsole.sql`.
- Dimensões de metadados do GA4 (`getMetadata`) e dimensões personalizadas
  ficam de fora: exigem uma chamada por propriedade e registro prévio.
