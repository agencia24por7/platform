# 0016 — Modelagem do YouTube e do Google Business Profile no BigQuery

- Status: aceito
- Data: 2026-11-20

## Contexto

`fato_youtube_diario` (canal por dia) e `fato_gbp_diario` (local por dia por
métrica) eram as únicas tabelas das duas plataformas. A ADR 0015 permite várias
tabelas por coletor. Falta o grão de vídeo, os recortes de audiência e os
atributos das entidades.

## Decisão

### YouTube

- Vídeo e playlist viram dimensões SCD2 (título, privacidade e duração mudam).
  Vêm da Data API (`videos.list`, `playlists.list`, 1 unidade por chamada); a
  cota diária de 10 mil unidades não é ameaçada: são 2 chamadas por canal por
  execução. `search.list` (100 unidades) nunca é usado.
- Vídeo por dia usa `reports.query` com `filters=video==<id>` e
  `dimensions=day`, um pedido por vídeo. A API não documenta `video,day`
  juntos em relatório de canal, então a descoberta é `dimensions=video`,
  `sort=-views`, `maxResults=25`: só os 25 vídeos mais vistos da janela entram
  nas duas tabelas de vídeo. Cobrir o catálogo inteiro exigiria listar a
  playlist de uploads e multiplicaria os pedidos.
- Origem de tráfego, dispositivo e local de reprodução aceitam `day`: um fato
  por recorte, grão canal x dia x categoria. País e idade/gênero não aceitam
  `day`; o coletor faz um pedido por dia (no máximo 31 dias da janela) para
  manter o grão diário em vez de inventar um grão de janela sobreposta.
- Só o pedido de `canal_dia` derruba a execução; recortes e metadados
  recusados (por exemplo demografia sem volume) são ignorados, para não perder
  a série principal.
- Dado de pessoa não entra: nada de comentário, autor ou inscrito. `likes` e
  `comments` são contagens.

### Google Business Profile

- `fato_gbp_diario` continua longo (local x dia x métrica) e ganha as demais
  métricas não depreciadas da API.
- Local vira SCD2 com os dados do estabelecimento (endereço comercial é dado
  empresarial, não pessoal).
- Palavras-chave de busca: a API soma os meses pedidos, então o coletor pede
  um mês por vez para ter o grão termo x mês. A API devolve `value` ou
  `threshold`, nunca os dois: as colunas `valor` e `limiar` ficam separadas e
  nulas quando não se aplicam, para não tratar "abaixo de 15" como 15.
  Só a primeira página (100 termos) por mês: paginar em n8n quebra o
  pareamento resposta x mês.
- Avaliações ficaram de fora. A lista de avaliações é a API legada
  `mybusiness.googleapis.com/v4/accounts/{conta}/locations/{local}/reviews`,
  que precisa do id da conta (a fonte guarda só o local) e de uma terceira API
  habilitada no projeto; a resposta traz nome e foto do avaliador, que não
  devem passar pelo coletor. Reavaliar se a conexão passar a guardar a conta.

## Consequências

- Cada requisição do coletor é rotulada e pareada por posição com a resposta;
  o coletor do YouTube tem duas etapas (a segunda depende dos vídeos achados
  na primeira).
- Volume do YouTube: até cerca de 90 pedidos por canal por janela de 28 dias
  (pedidos espaçados em 250 ms).
