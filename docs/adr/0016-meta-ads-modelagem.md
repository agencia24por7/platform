# 0016 — Modelagem do Meta Ads no BigQuery

- Status: aceito
- Data: 2026-11-20

## Contexto

O coletor do Meta coletava só `level=campaign` por dia, com compras. Gestão e
relatório precisam de anúncio, conjunto, vídeo, ações (lead, mensagens,
conversões personalizadas) e recortes de público e posicionamento. Convenções
gerais: ADR 0015.

## Decisão

### Grão

- **Entrega**: anúncio × dia (`level=ad`, `time_increment=1`), métricas
  escalares em colunas (gasto, alcance, cliques, vídeo p25-p100, thruplay).
- **Ações**: anúncio × dia × `tipo_acao` × `origem_metrica`. A lista de
  `action_type` é aberta e cresce com o produto da Meta, então vai em formato
  longo, não em colunas. `origem_metrica` separa `acoes` (`actions`,
  `action_values`, `cost_per_action_type`) de `conversoes` (`conversions`,
  `conversion_values`, `cost_per_conversion`, onde aparecem as conversões
  personalizadas). Os pares vêm da mesma linha de insights, sem chamada extra.
- **Recortes** (idade × gênero, plataforma × posição, região): a API não combina
  breakdowns incompatíveis entre si, então são três fatos. O grão é
  **conjunto × dia × recorte**, não anúncio. Idade × gênero tem ~21 células e
  região ~27: no nível anúncio o volume multiplica por 3 a 10 sem ganho de
  análise (público e posicionamento são decididos no conjunto). Um fato de
  anúncio × recorte só se justificar por demanda concreta. As métricas do
  recorte são um conjunto fixo (gasto, alcance, cliques, leads, compras,
  receita, conversas, visualizações de página); as demais ações só existem no
  fato de ações, que não tem recorte.
- **Dimensões SCD2** de campanha, conjunto e anúncio, para objetivo, status,
  orçamento, lance, otimização, cobrança e criativo, que mudam e precisam ser
  lidos "como eram" quando o fato foi gerado. `updated_time` e
  `budget_remaining` ficam de fora dos atributos: mudam sem mudança de gestão e
  gerariam uma versão por coleta.
- `fato_ads_diario` (campanha × dia) segue como está, alimentada agora por
  agregação dos anúncios na mesma coleta (gasto, impressões, cliques e compras
  somam; o resultado coincide com `level=campaign`). Não há segunda chamada.

### Atribuição

Os pedidos usam `use_unified_attribution_setting=true`: a Meta aplica a janela
configurada em cada conjunto, o mesmo número do Ads Manager. A coluna
`janela_atribuicao` do fato de ações grava `unificada`, e a janela efetiva de
cada conjunto está em `dim_meta_conjunto_scd2.janela_atribuicao`
(`CLICK_THROUGH:7,VIEW_THROUGH:1`). Pedir janelas explícitas triplicaria as
linhas de ação sem uso conhecido.

### Relatórios assíncronos

Anúncio × dia e breakdowns em janelas de 28 dias estouram o tempo do endpoint
síncrono ("reduce the amount of data") em contas grandes. Os quatro relatórios
são criados por `POST /{conta}/insights` (`report_run_id`), consultados a cada
20 segundos por até 30 tentativas e baixados com paginação por
`/{report_run_id}/insights`. As listas de campanhas, conjuntos e anúncios
(paginadas, síncronas) rodam enquanto os relatórios processam. Relatório que
não termina vira falha; só o de anúncios é obrigatório. Recorte ou dimensão
indisponível mantém as linhas coletadas e marca `coleta_incompleta`.

### Fora do escopo

- Segmentação (`targeting`): tem nomes de públicos personalizados e listas de
  clientes; entra só com decisão de LGPD.
- Texto do criativo, imagem e URL: não são métrica nem atributo de gestão.
- `unique_*` além de cliques, `cost_per_*` derivados e ratios (CTR, CPC, CPM):
  recalculam-se das colunas.

## Consequências

- O volume do fato de ações domina: ~10 a 30 linhas por anúncio-dia. Contas
  muito grandes devem monitorar o tamanho do POST de gravação.
- Orçamento e lance vêm em unidade menor da moeda e são divididos por 100
  (certo para BRL e USD; moeda sem centavos exigiria o deslocamento da conta).
- A primeira coleta de uma fonte abre a versão inicial das dimensões desde
  `1970-01-01`; a coleta lê o estado atual das entidades, não o histórico.
