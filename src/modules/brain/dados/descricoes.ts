import type { DescricaoDeColuna } from './glossario.ts';

export type SensibilidadeDaTabela = {
  readonly nivel: 'publico' | 'negocio' | 'pessoal_possivel' | 'restrito';
  readonly piiPossivel: boolean;
  readonly usoPorAgente: 'permitido' | 'restrito' | 'negado';
};

export type DescricaoDaTabela = {
  readonly titulo: string;
  readonly descricao: string;
  readonly view: string | null;
  readonly colunaDeData: string | null;
  readonly relacionadas?: readonly string[];
  readonly sensibilidade?: SensibilidadeDaTabela;
  readonly colunas?: Readonly<Record<string, DescricaoDeColuna>>;
  readonly tags?: readonly string[];
};

const PESSOAL_POSSIVEL: SensibilidadeDaTabela = { nivel: 'pessoal_possivel', piiPossivel: true, usoPorAgente: 'permitido' };

const fato = (
  titulo: string,
  descricao: string,
  view: string,
  extra: Partial<DescricaoDaTabela> = {},
): DescricaoDaTabela => ({ titulo, descricao, view, colunaDeData: 'data_dia', ...extra });

const dimensao = (titulo: string, descricao: string, view: string, extra: Partial<DescricaoDaTabela> = {}): DescricaoDaTabela => ({
  titulo,
  descricao,
  view,
  colunaDeData: null,
  tags: ['dimensao', 'scd2'],
  ...extra,
});

export const DESCRICOES_DAS_TABELAS: Readonly<Record<string, DescricaoDaTabela>> = {
  fato_ads_diario: fato(
    'Anúncios por campanha e dia (Google Ads e Meta Ads)',
    'Investimento, impressões, cliques, conversões e receita por campanha e dia, nas duas plataformas de anúncio. Responde quanto se gastou, quanto rendeu e o custo por resultado de cada campanha.',
    'vw_ads_diario',
    { relacionadas: ['dim_meta_campanha_scd2', 'dim_google_campanha_scd2', 'fato_meta_entrega_diaria', 'fato_google_campanha_diario'], tags: ['anuncios', 'midia_paga'] },
  ),
  fato_google_campanha_diario: fato(
    'Google Ads: campanhas por dia',
    'Métricas completas de cada campanha do Google Ads por dia, inclusive parcela de impressões e perdas por orçamento ou classificação. Responde por que uma campanha entrega pouco e quanto espaço há para crescer.',
    'vw_google_campanha_diario',
    { relacionadas: ['dim_google_campanha_scd2'], tags: ['anuncios', 'midia_paga'] },
  ),
  fato_google_anuncio_diario: fato(
    'Google Ads: anúncios por dia',
    'Desempenho de cada anúncio do Google Ads por dia. Responde quais anúncios convertem melhor dentro de cada grupo.',
    'vw_google_anuncio_diario',
    { relacionadas: ['dim_google_anuncio_scd2', 'dim_google_grupo_anuncios_scd2'], tags: ['anuncios', 'criativos'] },
  ),
  fato_google_palavra_chave_diario: fato(
    'Google Ads: palavras-chave por dia',
    'Desempenho de cada palavra-chave cadastrada por dia. Responde quais palavras-chave trazem conversões e quais só gastam.',
    'vw_google_palavra_chave_diario',
    { relacionadas: ['dim_google_palavra_chave_scd2'], tags: ['anuncios', 'pesquisa'] },
  ),
  fato_google_termo_pesquisa_diario: fato(
    'Google Ads: termos de pesquisa por dia',
    'O que as pessoas realmente digitaram antes de ver o anúncio, com custo e conversões. Responde quais buscas negativar e quais viram novas palavras-chave.',
    'vw_google_termo_pesquisa_diario',
    { sensibilidade: PESSOAL_POSSIVEL, tags: ['anuncios', 'pesquisa'] },
  ),
  fato_google_conversao_diario: fato(
    'Google Ads: conversões por ação e dia',
    'Conversões e valor por ação de conversão (compra, lead, ligação...) e campanha. Responde quais tipos de conversão cada campanha gera.',
    'vw_google_conversao_diario',
    { tags: ['anuncios', 'conversoes'] },
  ),
  fato_google_dispositivo_diario: fato(
    'Google Ads: desempenho por dispositivo',
    'Métricas por campanha, dispositivo e dia. Responde se celular ou computador converte melhor.',
    'vw_google_dispositivo_diario',
    { tags: ['anuncios', 'publico'] },
  ),
  fato_google_rede_diario: fato(
    'Google Ads: desempenho por rede',
    'Métricas por campanha, rede de veiculação e dia. Responde quanto da verba vai para pesquisa, display ou YouTube.',
    'vw_google_rede_diario',
    { tags: ['anuncios'] },
  ),
  fato_google_geo_diario: fato(
    'Google Ads: desempenho por país',
    'Métricas por campanha, país e tipo de localização por dia. Responde de onde vêm os resultados da mídia paga.',
    'vw_google_geo_diario',
    { tags: ['anuncios', 'publico', 'geografia'] },
  ),
  fato_google_idade_diario: fato(
    'Google Ads: desempenho por faixa etária',
    'Métricas por grupo de anúncios, faixa etária e dia. Responde quais idades convertem melhor.',
    'vw_google_idade_diario',
    { tags: ['anuncios', 'publico'] },
  ),
  fato_google_genero_diario: fato(
    'Google Ads: desempenho por gênero',
    'Métricas por grupo de anúncios, gênero e dia. Responde se há diferença de resultado entre gêneros.',
    'vw_google_genero_diario',
    { tags: ['anuncios', 'publico'] },
  ),
  fato_google_grupo_ativos_diario: fato(
    'Google Ads: grupos de recursos (Performance Max)',
    'Desempenho dos grupos de recursos das campanhas Performance Max por dia. Responde quais conjuntos de criativos da PMax entregam resultado.',
    'vw_google_grupo_ativos_diario',
    { relacionadas: ['dim_google_grupo_ativos_scd2'], tags: ['anuncios', 'criativos'] },
  ),
  dim_google_campanha_scd2: dimensao(
    'Google Ads: cadastro das campanhas',
    'Configuração de cada campanha do Google Ads com histórico de mudanças (nome, status, canal, estratégia de lance, orçamento). Responde como a campanha estava configurada em cada período.',
    'vw_dim_google_campanha',
  ),
  dim_google_grupo_anuncios_scd2: dimensao(
    'Google Ads: cadastro dos grupos de anúncios',
    'Grupos de anúncios com nome, status e tipo, versionados no tempo. Liga anúncios e palavras-chave às campanhas.',
    'vw_dim_google_grupo_anuncios',
  ),
  dim_google_anuncio_scd2: dimensao(
    'Google Ads: cadastro dos anúncios',
    'Anúncios com tipo, status e aprovação, versionados no tempo. Responde quais anúncios estão ativos ou reprovados.',
    'vw_dim_google_anuncio',
  ),
  dim_google_palavra_chave_scd2: dimensao(
    'Google Ads: cadastro das palavras-chave',
    'Palavras-chave com texto, correspondência, status, se é negativa e índice de qualidade, versionadas. Responde como está a qualidade das palavras-chave.',
    'vw_dim_google_palavra_chave',
  ),
  dim_google_grupo_ativos_scd2: dimensao(
    'Google Ads: cadastro dos grupos de recursos',
    'Grupos de recursos da Performance Max com nome e status, versionados.',
    'vw_dim_google_grupo_ativos',
  ),
  fato_meta_entrega_diaria: fato(
    'Meta Ads: entrega por anúncio e dia',
    'Investimento, alcance, frequência, cliques, vídeo e rankings de qualidade de cada anúncio da Meta por dia. Responde quais criativos entregam e engajam e quanto custam.',
    'vw_meta_entrega_diaria',
    { relacionadas: ['dim_meta_anuncio_scd2', 'dim_meta_conjunto_scd2', 'dim_meta_campanha_scd2'], tags: ['anuncios', 'criativos'] },
  ),
  fato_meta_acoes_diarias: fato(
    'Meta Ads: ações e conversões por anúncio e dia',
    'Cada tipo de ação atribuída (lead, compra, mensagem, clique...) com quantidade, valor e custo por ação, por anúncio e dia. Responde quantos leads ou vendas cada anúncio gerou.',
    'vw_meta_acoes_diarias',
    {
      relacionadas: ['dim_meta_anuncio_scd2'],
      colunas: { valor: { significado: 'Valor monetário atribuído à ação.', unidade: 'moeda da conta (coluna moeda)', agregacao: 'soma' } },
      tags: ['anuncios', 'conversoes'],
    },
  ),
  fato_meta_recorte_idade_genero: fato(
    'Meta Ads: público por idade e gênero',
    'Métricas por conjunto de anúncios, idade, gênero e dia. Responde qual público responde melhor aos anúncios.',
    'vw_meta_recorte_idade_genero',
    { relacionadas: ['dim_meta_conjunto_scd2'], tags: ['anuncios', 'publico'] },
  ),
  fato_meta_recorte_posicionamento: fato(
    'Meta Ads: desempenho por posicionamento',
    'Métricas por conjunto, plataforma (Facebook, Instagram...) e posição (feed, stories, reels) por dia. Responde onde os anúncios rendem mais.',
    'vw_meta_recorte_posicionamento',
    { relacionadas: ['dim_meta_conjunto_scd2'], tags: ['anuncios'] },
  ),
  fato_meta_recorte_regiao: fato(
    'Meta Ads: desempenho por região',
    'Métricas por conjunto, região e dia. Responde em quais estados os anúncios trazem resultado.',
    'vw_meta_recorte_regiao',
    { relacionadas: ['dim_meta_conjunto_scd2'], tags: ['anuncios', 'geografia'] },
  ),
  dim_meta_campanha_scd2: dimensao(
    'Meta Ads: cadastro das campanhas',
    'Campanhas da Meta com objetivo, status, estratégia de lance e orçamentos, versionadas no tempo. Responde o objetivo e a configuração de cada campanha.',
    'vw_meta_campanha',
  ),
  dim_meta_conjunto_scd2: dimensao(
    'Meta Ads: cadastro dos conjuntos de anúncios',
    'Conjuntos com otimização, cobrança, lance, orçamento, destino e evento de conversão, versionados. Responde como cada conjunto está otimizado.',
    'vw_meta_conjunto',
  ),
  dim_meta_anuncio_scd2: dimensao(
    'Meta Ads: cadastro dos anúncios',
    'Anúncios da Meta com status e criativo, versionados. Liga a entrega diária ao conjunto e à campanha.',
    'vw_meta_anuncio',
  ),
  fato_ga4_diario: fato(
    'Site (GA4): sessões por canal e dia',
    'Sessões, usuários, novos usuários, conversões e receita por grupo de canais e dia. Responde de onde vem o tráfego do site e quanto ele converte.',
    'vw_ga4_diario',
    { tags: ['site', 'trafego'] },
  ),
  fato_ga4_aquisicao_diario: fato(
    'Site (GA4): aquisição por origem, mídia e campanha',
    'Sessões, engajamento, eventos-chave e receita por origem/mídia/campanha (UTM) e dia. Responde quais campanhas e canais trazem visitas que convertem.',
    'vw_ga4_aquisicao_diario',
    { tags: ['site', 'trafego', 'atribuicao'] },
  ),
  fato_ga4_pagina_diario: fato(
    'Site (GA4): páginas por dia',
    'Visualizações, usuários, sessões e eventos-chave por página e dia. Responde quais conteúdos do site atraem e convertem.',
    'vw_ga4_pagina_diario',
    { sensibilidade: PESSOAL_POSSIVEL, tags: ['site', 'conteudo'] },
  ),
  fato_ga4_pagina_entrada_diario: fato(
    'Site (GA4): páginas de entrada',
    'Sessões e conversões por página de entrada (landing page) e dia. Responde quais páginas de destino seguram e convertem a visita.',
    'vw_ga4_pagina_entrada_diario',
    { sensibilidade: PESSOAL_POSSIVEL, tags: ['site', 'conteudo'] },
  ),
  fato_ga4_evento_diario: fato(
    'Site (GA4): eventos por dia',
    'Contagem, usuários e valor por nome de evento e dia. Responde se os eventos de conversão do site estão disparando.',
    'vw_ga4_evento_diario',
    {
      colunas: { valor: { significado: 'Valor do evento (event_value) somado no dia.', unidade: 'moeda da propriedade', agregacao: 'soma' } },
      tags: ['site', 'mensuracao'],
    },
  ),
  fato_ga4_dispositivo_diario: fato(
    'Site (GA4): tecnologia do visitante',
    'Sessões e conversões por categoria de dispositivo, sistema, navegador e plataforma por dia. Responde em que dispositivo o site perde conversão.',
    'vw_ga4_dispositivo_diario',
    { tags: ['site', 'publico'] },
  ),
  fato_ga4_geo_diario: fato(
    'Site (GA4): geografia do visitante',
    'Sessões e conversões por país, região e cidade por dia. Responde de onde vêm as visitas do site.',
    'vw_ga4_geo_diario',
    { tags: ['site', 'geografia'] },
  ),
  fato_ga4_item_diario: fato(
    'Site (GA4): itens do e-commerce',
    'Itens visualizados, no carrinho, comprados e receita por item e dia. Responde quais produtos vendem e onde o funil da loja quebra.',
    'vw_ga4_item_diario',
    { tags: ['site', 'ecommerce'] },
  ),
  fato_search_console_diario: fato(
    'Busca orgânica: site por dispositivo e dia',
    'Cliques, impressões, CTR e posição média na busca do Google por dispositivo e dia. Responde como o site está na busca orgânica.',
    'vw_search_console_diario',
    { tags: ['seo', 'busca_organica'] },
  ),
  fato_search_console_consulta_pagina_diario: fato(
    'Busca orgânica: consultas e páginas',
    'Cliques, impressões e posição por consulta buscada e página por dia. Responde por quais buscas o site aparece e qual página ranqueia.',
    'vw_search_console_consulta_pagina_diario',
    { sensibilidade: PESSOAL_POSSIVEL, tags: ['seo', 'busca_organica'] },
  ),
  fato_search_console_pagina_diario: fato(
    'Busca orgânica: páginas',
    'Cliques, impressões e posição por página e dia na busca do Google. Responde quais páginas trazem tráfego orgânico.',
    'vw_search_console_pagina_diario',
    { sensibilidade: PESSOAL_POSSIVEL, tags: ['seo', 'busca_organica'] },
  ),
  fato_search_console_pais_dispositivo_diario: fato(
    'Busca orgânica: país e dispositivo',
    'Cliques, impressões e posição por país, dispositivo e dia. Responde de onde e em que aparelho o site é encontrado.',
    'vw_search_console_pais_dispositivo_diario',
    { tags: ['seo', 'busca_organica'] },
  ),
  fato_search_console_aparencia_diario: fato(
    'Busca orgânica: aparência do resultado',
    'Cliques e impressões por tipo de aparência na busca (resultados ricos, vídeo...) e dia. Responde se os resultados ricos estão ajudando.',
    'vw_search_console_aparencia_diario',
    { tags: ['seo', 'busca_organica'] },
  ),
  fato_search_console_tipo_diario: fato(
    'Busca orgânica: tipos de busca (imagem, vídeo, notícias, Discover)',
    'Cliques, impressões e posição por tipo de busca fora da web (imagem, vídeo, notícias, Discover) e dia. Responde se o site ganha tráfego nesses espaços.',
    'vw_search_console_tipo_diario',
    {
      colunas: { tipo: { significado: 'Tipo de busca do Search Console (image, video, news, discover, googleNews).', agregacao: 'nenhuma' } },
      tags: ['seo', 'busca_organica'],
    },
  ),
  fato_youtube_diario: fato(
    'YouTube: canal por dia',
    'Visualizações, minutos assistidos, inscritos ganhos e perdidos e receita estimada do canal por dia. Responde como o canal cresce.',
    'vw_youtube_diario',
    { tags: ['video', 'conteudo'] },
  ),
  dim_youtube_video_scd2: dimensao(
    'YouTube: cadastro dos vídeos',
    'Vídeos do canal com título, duração, publicação e privacidade, versionados. Responde o que foi publicado e quando.',
    'vw_dim_youtube_video_scd2',
  ),
  dim_youtube_playlist_scd2: dimensao(
    'YouTube: cadastro das playlists',
    'Playlists com título, privacidade e quantidade de vídeos, versionadas.',
    'vw_dim_youtube_playlist_scd2',
  ),
  fato_youtube_video_diario: fato(
    'YouTube: vídeos por dia',
    'Visualizações, retenção, curtidas, comentários, compartilhamentos e inscritos por vídeo e dia. Responde quais vídeos performam.',
    'vw_youtube_video_diario',
    { relacionadas: ['dim_youtube_video_scd2'], tags: ['video', 'conteudo'] },
  ),
  fato_youtube_origem_trafego_diario: fato(
    'YouTube: origem do tráfego',
    'Visualizações e minutos por origem de tráfego e dia. Responde se o canal cresce por busca, sugestão ou fora do YouTube.',
    'vw_youtube_origem_trafego_diario',
    { tags: ['video'] },
  ),
  fato_youtube_dispositivo_diario: fato(
    'YouTube: dispositivo',
    'Visualizações e minutos por tipo de dispositivo e dia. Responde onde o público assiste.',
    'vw_youtube_dispositivo_diario',
    { tags: ['video', 'publico'] },
  ),
  fato_youtube_local_reproducao_diario: fato(
    'YouTube: local de reprodução',
    'Visualizações e minutos por local de reprodução (YouTube, incorporado) e dia.',
    'vw_youtube_local_reproducao_diario',
    { tags: ['video'] },
  ),
  fato_youtube_pais_diario: fato(
    'YouTube: país',
    'Visualizações e minutos por país e dia. Responde de onde vem a audiência do canal.',
    'vw_youtube_pais_diario',
    { tags: ['video', 'geografia'] },
  ),
  fato_youtube_audiencia_diario: fato(
    'YouTube: audiência por idade e gênero',
    'Percentual dos espectadores por faixa etária e gênero por dia. Responde quem assiste ao canal.',
    'vw_youtube_audiencia_diario',
    { tags: ['video', 'publico'] },
  ),
  fato_gbp_diario: fato(
    'Google Minha Empresa: métricas diárias do local',
    'Valor diário de cada métrica do perfil (visualizações na busca e no Maps, ligações, rotas, cliques no site). Responde quanto o perfil local gera de contato.',
    'vw_gbp_diario',
    {
      relacionadas: ['dim_gbp_local_scd2'],
      colunas: { valor: { significado: 'Valor da métrica (coluna metrica) no dia.', unidade: 'contagem', agregacao: 'soma' } },
      tags: ['local', 'presenca'],
    },
  ),
  dim_gbp_local_scd2: dimensao(
    'Google Minha Empresa: cadastro do local',
    'Local com nome, categoria, endereço comercial, status e site, versionado. Responde como o negócio aparece no Google.',
    'vw_dim_gbp_local_scd2',
  ),
  fato_gbp_palavras_chave_mensal: {
    titulo: 'Google Minha Empresa: buscas que acharam o local',
    descricao: 'Termos que as pessoas buscaram e mostraram o perfil, por mês, com limiar de privacidade. Responde como o negócio é procurado localmente.',
    view: 'vw_gbp_palavras_chave_mensal',
    colunaDeData: 'mes',
    relacionadas: ['dim_gbp_local_scd2'],
    sensibilidade: PESSOAL_POSSIVEL,
    colunas: { valor: { significado: 'Buscas no mês (nulo quando abaixo do limiar).', unidade: 'contagem', agregacao: 'soma' } },
    tags: ['local', 'busca'],
  },
  fato_rd_negociacoes: {
    titulo: 'CRM (RD Station): fotografia diária das negociações',
    descricao: 'Estado de cada negociação por dia: funil, etapa, situação, valores, fonte e campanha, sem nome de contato. Responde quantos negócios há em cada etapa, quanto foi ganho e de onde vieram.',
    view: 'vw_rd_negociacoes',
    colunaDeData: 'data_snapshot',
    relacionadas: ['dim_rd_funil_scd2', 'dim_rd_etapa_scd2', 'dim_rd_fonte_scd2', 'dim_rd_campanha_scd2'],
    sensibilidade: PESSOAL_POSSIVEL,
    tags: ['crm', 'vendas', 'leads'],
  },
  dim_rd_funil_scd2: dimensao('CRM (RD Station): funis de venda', 'Funis de venda do CRM, versionados.', 'vw_dim_rd_funil'),
  dim_rd_etapa_scd2: dimensao('CRM (RD Station): etapas do funil', 'Etapas de cada funil com ordem, versionadas.', 'vw_dim_rd_etapa'),
  dim_rd_fonte_scd2: dimensao('CRM (RD Station): fontes de negócio', 'Fontes (origens) cadastradas no CRM, versionadas.', 'vw_dim_rd_fonte'),
  dim_rd_campanha_scd2: dimensao('CRM (RD Station): campanhas', 'Campanhas cadastradas no CRM, versionadas.', 'vw_dim_rd_campanha'),
  dim_rd_produto_scd2: dimensao('CRM (RD Station): produtos', 'Produtos do CRM com preço e se estão ativos, versionados.', 'vw_dim_rd_produto'),
  dim_rd_usuario_scd2: dimensao(
    'CRM (RD Station): usuários do CRM',
    'Ids pseudônimos dos usuários da equipe comercial e se estão ativos, sem nome nem e-mail.',
    'vw_dim_rd_usuario',
    { sensibilidade: { nivel: 'pessoal_possivel', piiPossivel: true, usoPorAgente: 'restrito' } },
  ),
  fato_rd_negociacao_produtos: {
    titulo: 'CRM (RD Station): produtos das negociações',
    descricao: 'Produtos de cada negociação por dia de fotografia, com quantidade, preço, desconto e total. Responde o que está sendo vendido.',
    view: 'vw_rd_negociacao_produtos',
    colunaDeData: 'data_snapshot',
    relacionadas: ['dim_rd_produto_scd2'],
    tags: ['crm', 'vendas'],
  },
  fato_rd_negociacao_etapas: fato(
    'CRM (RD Station): passagem pelas etapas',
    'Quando cada negociação entrou em cada etapa. Responde quanto tempo os negócios levam entre etapas.',
    'vw_rd_negociacao_etapas',
    { relacionadas: ['dim_rd_etapa_scd2'], tags: ['crm', 'vendas', 'funil'] },
  ),
  fato_rd_tarefas_diarias: fato(
    'CRM (RD Station): tarefas por dia',
    'Quantidade de tarefas por tipo e status por dia. Responde o ritmo da equipe comercial.',
    'vw_rd_tarefas_diarias',
    { tags: ['crm', 'operacao'] },
  ),
  fato_meta_eventos_dataset: fato(
    'Meta Pixel: eventos por dia',
    'Quantidade de cada evento do Pixel e da API de Conversões por dia e origem (total, navegador, servidor). Responde se o site está enviando os eventos certos para a Meta.',
    'vw_meta_eventos_dataset',
    { relacionadas: ['dim_meta_dataset_scd2'], tags: ['mensuracao', 'pixel'] },
  ),
  dim_meta_dataset_scd2: dimensao(
    'Meta Pixel: cadastro do conjunto de dados',
    'Configuração do Pixel/conjunto de dados (correspondência automática, cookie, uso de dados), versionada.',
    'vw_dim_meta_dataset',
  ),
  fato_meta_eventos_dataset_recortes: fato(
    'Meta Pixel: eventos por recorte',
    'Quantidade de eventos por recorte (dispositivo, navegador, URL, correspondência) e dia. Responde a qualidade da correspondência dos eventos.',
    'vw_meta_eventos_dataset_recortes',
    {
      colunas: { valor: { significado: 'Valor do recorte (ex.: nome do navegador).', agregacao: 'nenhuma' } },
      tags: ['mensuracao', 'pixel'],
    },
  ),
  fato_meta_formularios: {
    titulo: 'Meta Lead Ads: fotografia dos formulários',
    descricao: 'Estado diário de cada formulário de cadastro com total de leads acumulado e expirados, sem ler nenhum lead. Responde quais formulários estão captando.',
    view: 'vw_meta_formularios',
    colunaDeData: 'data_snapshot',
    relacionadas: ['dim_meta_formulario_scd2', 'dim_meta_pagina_scd2'],
    tags: ['leads', 'formularios'],
  },
  dim_meta_pagina_scd2: dimensao('Meta Lead Ads: Páginas', 'Páginas do Facebook com nome e categoria, versionadas.', 'vw_dim_meta_pagina'),
  dim_meta_formulario_scd2: dimensao(
    'Meta Lead Ads: cadastro dos formulários',
    'Formulários com status, idioma e tipos de pergunta (sem respostas), versionados.',
    'vw_dim_meta_formulario',
  ),
  fato_meta_leads_diario: fato(
    'Meta Lead Ads: leads por dia',
    'Quantidade de leads por formulário, anúncio, campanha e dia (só contagem). Responde quantos leads cada campanha trouxe.',
    'vw_meta_leads_diario',
    { relacionadas: ['dim_meta_formulario_scd2'], tags: ['leads', 'formularios'] },
  ),
  gov_snapshot_fontes: {
    titulo: 'Governança: observações das fontes',
    descricao: 'Observações periódicas de cada fonte coletada (nome, estado, rótulos). Uso operacional: não tem view com dono, por isso o agente vê só os metadados.',
    view: null,
    colunaDeData: 'visto_em',
    sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'restrito' },
    colunas: { estado: { significado: 'Estado observado da fonte na plataforma.', agregacao: 'nenhuma' } },
    tags: ['governanca'],
  },
  dim_gtm_conteiner_scd2: dimensao(
    'Google Tag Manager: contêiner',
    'Contêiner com contexto de uso e domínios, versionado. Responde quais sites o contêiner mede.',
    'vw_dim_gtm_conteiner',
    { tags: ['dimensao', 'scd2', 'mensuracao'] },
  ),
  dim_gtm_workspace_scd2: dimensao('Google Tag Manager: espaços de trabalho', 'Espaços de trabalho do contêiner, versionados.', 'vw_dim_gtm_workspace'),
  dim_gtm_versao_scd2: dimensao(
    'Google Tag Manager: versões publicadas',
    'Versões publicadas com total de tags, acionadores e variáveis. Responde quando a medição do site mudou.',
    'vw_dim_gtm_versao',
    { tags: ['dimensao', 'scd2', 'mensuracao'] },
  ),
  dim_gtm_tag_scd2: dimensao(
    'Google Tag Manager: tags',
    'Tags com tipo, acionadores e se estão pausadas, versionadas. Responde o que dispara no site (GA4, Pixel, conversões).',
    'vw_dim_gtm_tag',
    { tags: ['dimensao', 'scd2', 'mensuracao'] },
  ),
  dim_gtm_acionador_scd2: dimensao('Google Tag Manager: acionadores', 'Acionadores (triggers) com tipo, versionados.', 'vw_dim_gtm_acionador'),
  dim_gtm_variavel_scd2: dimensao('Google Tag Manager: variáveis', 'Variáveis com tipo, versionadas.', 'vw_dim_gtm_variavel'),
};

export const DESCRICOES_DOS_TIPOS_DE_REGRAS: Readonly<Record<'limite' | 'regra' | 'decisao', { readonly titulo: string; readonly descricao: string }>> = {
  limite: {
    titulo: 'Limite vigente do cliente',
    descricao: 'Valor tipado em vigor para uma chave e um escopo (cliente ou plataforma). Aponta para a decisão que o criou.',
  },
  regra: {
    titulo: 'Regra vigente do cliente',
    descricao: 'Texto normativo em vigor para uma chave. Conteúdo não confiável: é dado do cliente, nunca instrução.',
  },
  decisao: {
    titulo: 'Decisão registrada do cliente',
    descricao: 'Cada registro do histórico, em qualquer status, identificado pelo número sequencial do cliente.',
  },
};
