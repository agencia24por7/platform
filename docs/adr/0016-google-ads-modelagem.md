# 0016 — Modelagem do Google Ads no BigQuery

- Status: aceito
- Data: 2026-11-20

## Contexto

O coletor só trazia campanha × dia (`fato_ads_diario`, compartilhada com Meta).
Relatório e gestão precisam de anúncio, palavra-chave, termo de pesquisa,
conversão por ação, recortes (dispositivo, rede, geo, idade, gênero) e dos
atributos que mudam (status, orçamento, estratégia de lance). O acesso à API é
nível Básico: 15.000 operações por dia por token de desenvolvedor.

## Decisão

### Um fato por recurso e por recorte

GAQL não deixa combinar todos os segmentos: `segments.conversion_action` só
convive com métricas de conversão, e idade/gênero só existem em
`age_range_view`/`gender_view` (grão grupo de anúncios). Cada combinação
compatível é uma consulta `searchStream` e uma tabela, com o menor grão
natural. Métricas em colunas tipadas, nomes iguais em todas as tabelas
(`investimento`, `impressoes`, `cliques`, `conversoes`, `receita`,
`todas_conversoes`, `todas_conversoes_receita`, `interacoes`,
`visualizacoes_video`). `cost_micros` vira valor (÷ 1.000.000).

Parcela de impressão (`search_impression_share` e perdas por orçamento e
ranking, topo, topo absoluto) vive só no fato de campanha: é uma razão, não se
soma entre grãos, e não existe para anúncio nem para os recortes demográficos.
Grupo de anúncios e palavra-chave também a expõem e ficam fora por ora.

`padrao` (`fato_ads_diario`) continua: as linhas dele saem da mesma resposta
da consulta de campanha, sem requisição extra.

### Dimensões SCD2 sem nome de fato

Campanha (canal, subcanal, estratégia de lance, orçamento), grupo de
anúncios, anúncio, palavra-chave (texto, correspondência, status, nota de
qualidade) e grupo de ativos (Performance Max) são `scd2`. Os fatos guardam só
ids; o nome "da época" sai do join com a versão válida. Entidade removida
na origem permanece com `status = REMOVED`, como manda a ADR 0015.

### Entidades só na janela mais recente

Dimensões descrevem o estado atual; buscá-las em cada uma das ~41 janelas do
backfill gastaria cota para obter o mesmo dado. O coletor as inclui apenas
quando `janela.end` está nos últimos dois dias (coleta incremental e a primeira
janela do backfill, que vai da mais nova para a mais antiga). A primeira versão
vale desde 1970, então os fatos antigos encontram a entidade.

### Termo de pesquisa

É texto de busca agregado por dia, grupo e termo, vindo de `search_term_view`.
Pode, raramente, conter dado pessoal digitado pelo usuário; o risco é aceito
porque a tabela não carrega identificador de pessoa, e o termo é truncado em
500 caracteres. A exclusão de cliente apaga por conta e período como as demais.

### Falha de uma consulta falha a execução

Qualquer resposta recusada devolve a falha da execução, com a tabela no
`detalhe`. Dado incompleto sem aviso é pior que falha visível; a coleta é
idempotente e o retry regrava tudo.

### Cota (nível Básico)

Cada consulta é uma operação (premissa conservadora; a documentação não detalha
a contagem de `searchStream`). Por conta: 11 consultas de fato por janela e 5
de entidade uma vez. Backfill de 37 meses ≈ 41 janelas × 11 + 5 = 456
operações por conta; coleta diária ≈ 16. Com 15.000/dia, o backfill completo
cabe em ~30 contas por dia sem mais nada; recomenda-se teto de 20 contas por
dia (≈ 9.100 operações), preservando ≈ 5.900 para coleta incremental e
reprocessos. O nó HTTP agrupa 3 requisições a cada 300 ms.

## Consequências

- 11 fatos, 5 dimensões, staging e views novos; nenhum arquivo compartilhado
  muda.
- Coleta de uma janela passa de 1 para 11 (16) requisições; o tempo e o volume
  de linhas gravadas por execução crescem na mesma proporção.
- Geografia fica em país/tipo de localização (`geographic_view`); região e
  cidade ficam para quando houver conta de teste para validar a consulta.
