import type { DefinicaoDeCapacidade, Requisito } from '../domain/capacidades.ts';

const RECENTE = 30;

const tabela = (rotulo: string, tabelas: readonly string[], diasRecentes = RECENTE): Requisito => ({
  tipo: 'tabela_com_dado',
  rotulo,
  tabelas,
  diasRecentes,
});

const contexto = (rotulo: string, secao: string, completudeMinima: number): Requisito => ({
  tipo: 'contexto_secao',
  rotulo,
  secao,
  completudeMinima,
});

const algum = (rotulo: string, requisitos: readonly Requisito[]): Requisito => ({ tipo: 'algum', rotulo, requisitos });

export const DEFINICOES_DE_CAPACIDADES: readonly DefinicaoDeCapacidade[] = [
  {
    id: 'performance_de_anuncios',
    titulo: 'Desempenho da mídia paga',
    descricao: 'Investimento, resultado e custo por resultado das campanhas de Google Ads e Meta Ads.',
    perguntas: ['Quanto investimos e quanto retornou no mês?', 'Qual campanha tem o menor custo por conversão?'],
    requisitos: [tabela('dado de anúncios nos últimos 30 dias', ['fato_ads_diario'])],
    tags: ['anuncios'],
  },
  {
    id: 'criativos_e_anuncios',
    titulo: 'Criativos e anúncios',
    descricao: 'Quais anúncios e criativos entregam, engajam e convertem.',
    perguntas: ['Quais criativos devemos pausar?', 'Qual anúncio tem a melhor taxa de clique?'],
    requisitos: [
      algum('detalhe por anúncio', [
        tabela('entrega por anúncio da Meta', ['fato_meta_entrega_diaria', 'fato_meta_acoes_diarias']),
        tabela('anúncios do Google Ads', ['fato_google_anuncio_diario', 'fato_google_grupo_ativos_diario']),
      ]),
    ],
    tags: ['anuncios', 'criativos'],
  },
  {
    id: 'publico_dos_anuncios',
    titulo: 'Público que responde aos anúncios',
    descricao: 'Idade, gênero, região e posicionamento que trazem resultado na mídia paga.',
    perguntas: ['Qual faixa etária converte melhor?', 'Stories ou feed rende mais?'],
    requisitos: [
      tabela('recortes de público', [
        'fato_meta_recorte_idade_genero',
        'fato_meta_recorte_regiao',
        'fato_meta_recorte_posicionamento',
        'fato_google_idade_diario',
        'fato_google_genero_diario',
        'fato_google_geo_diario',
      ]),
    ],
    tags: ['anuncios', 'publico'],
  },
  {
    id: 'busca_paga',
    titulo: 'Busca paga (palavras-chave e termos)',
    descricao: 'Palavras-chave e termos de pesquisa que geram custo e conversão no Google Ads.',
    perguntas: ['Quais termos devemos negativar?', 'Quais palavras-chave têm índice de qualidade baixo?'],
    requisitos: [tabela('palavras-chave ou termos de pesquisa', ['fato_google_palavra_chave_diario', 'fato_google_termo_pesquisa_diario'])],
    tags: ['anuncios', 'pesquisa'],
  },
  {
    id: 'trafego_do_site',
    titulo: 'Tráfego do site',
    descricao: 'Origem, volume e conversão das visitas ao site (GA4).',
    perguntas: ['De onde vêm as visitas que convertem?', 'Qual campanha UTM trouxe mais sessões?'],
    requisitos: [tabela('Google Analytics com dado recente', ['fato_ga4_diario', 'fato_ga4_aquisicao_diario'])],
    tags: ['site'],
  },
  {
    id: 'conteudo_do_site',
    titulo: 'Conteúdo e páginas do site',
    descricao: 'Páginas e páginas de entrada que atraem e convertem.',
    perguntas: ['Qual landing page converte melhor?', 'Quais páginas têm mais visualizações?'],
    requisitos: [tabela('páginas do GA4', ['fato_ga4_pagina_diario', 'fato_ga4_pagina_entrada_diario'])],
    tags: ['site', 'conteudo'],
  },
  {
    id: 'ecommerce',
    titulo: 'Vendas do e-commerce',
    descricao: 'Itens vistos, adicionados ao carrinho e comprados, com receita.',
    perguntas: ['Quais produtos mais vendem?', 'Onde o funil da loja perde gente?'],
    requisitos: [tabela('itens do e-commerce no GA4', ['fato_ga4_item_diario'])],
    tags: ['site', 'ecommerce'],
  },
  {
    id: 'busca_organica',
    titulo: 'Busca orgânica (SEO)',
    descricao: 'Consultas, páginas, cliques e posição do site no Google.',
    perguntas: ['Por quais buscas o site aparece?', 'Quais páginas perderam posição?'],
    requisitos: [tabela('Search Console com dado recente', ['fato_search_console_diario', 'fato_search_console_consulta_pagina_diario'])],
    tags: ['seo'],
  },
  {
    id: 'leads_e_origem',
    titulo: 'Leads e origem dos leads',
    descricao: 'Quantos leads chegam e de qual canal ou campanha vieram, do anúncio ao CRM.',
    perguntas: ['Quantos leads tivemos por campanha?', 'Qual origem traz os negócios que fecham?'],
    requisitos: [
      tabela('CRM com negociações', ['fato_rd_negociacoes']),
      algum('captação medida', [
        tabela('leads do Lead Ads', ['fato_meta_leads_diario', 'fato_meta_formularios']),
        tabela('eventos do Pixel', ['fato_meta_eventos_dataset']),
      ]),
    ],
    tags: ['leads', 'crm'],
  },
  {
    id: 'funil_de_vendas',
    titulo: 'Funil de vendas',
    descricao: 'Negócios por etapa, tempo entre etapas, ganhos e perdas no CRM.',
    perguntas: ['Quantos negócios estão parados em cada etapa?', 'Quanto tempo leva para fechar?'],
    requisitos: [tabela('negociações do CRM', ['fato_rd_negociacoes']), tabela('passagem pelas etapas', ['fato_rd_negociacao_etapas'], 90)],
    tags: ['crm', 'vendas'],
  },
  {
    id: 'mensuracao_do_site',
    titulo: 'Saúde da mensuração',
    descricao: 'Se o site envia eventos ao Pixel e como as tags estão configuradas.',
    perguntas: ['O Pixel está recebendo os eventos de compra?', 'Quais tags disparam no site?'],
    requisitos: [
      algum('Pixel ou Tag Manager', [
        tabela('eventos do Pixel', ['fato_meta_eventos_dataset']),
        tabela('tags do Tag Manager', ['dim_gtm_tag_scd2', 'dim_gtm_versao_scd2'], 3650),
      ]),
    ],
    tags: ['mensuracao'],
  },
  {
    id: 'desempenho_no_youtube',
    titulo: 'Desempenho no YouTube',
    descricao: 'Crescimento do canal, vídeos de destaque e origem da audiência.',
    perguntas: ['Quais vídeos trouxeram mais inscritos?', 'De onde vem a audiência do canal?'],
    requisitos: [tabela('YouTube com dado recente', ['fato_youtube_diario', 'fato_youtube_video_diario'])],
    tags: ['video'],
  },
  {
    id: 'presenca_local',
    titulo: 'Presença local (Google Minha Empresa)',
    descricao: 'Visualizações, ligações, rotas e buscas que encontram o negócio no Google.',
    perguntas: ['Quantas ligações o perfil gerou?', 'Por quais termos o negócio é encontrado?'],
    requisitos: [tabela('Google Minha Empresa com dado recente', ['fato_gbp_diario'])],
    tags: ['local'],
  },
  {
    id: 'contexto_de_marca',
    titulo: 'Contexto de marca e negócio',
    descricao: 'Quem é a empresa, o que vende e como a marca se comunica, para orientar textos e estratégia.',
    perguntas: ['Qual o tom de voz da marca?', 'Quais são os diferenciais do negócio?'],
    requisitos: [contexto('seção Empresa preenchida', 'empresa', 0.6), contexto('seção Marca preenchida', 'marca', 0.6)],
    tags: ['contexto'],
  },
  {
    id: 'publico_e_personas',
    titulo: 'Público e personas',
    descricao: 'Para quem o cliente vende, com dores e objeções, para segmentar e escrever.',
    perguntas: ['Quem é a persona principal?', 'Quais objeções aparecem na venda?'],
    requisitos: [contexto('seção Público preenchida', 'publico', 0.5)],
    tags: ['contexto', 'publico'],
  },
  {
    id: 'objetivos_e_metas',
    titulo: 'Objetivos e metas',
    descricao: 'Metas do cliente para comparar resultado com o esperado.',
    perguntas: ['Estamos dentro da meta de leads?', 'Qual o custo por lead aceitável?'],
    requisitos: [contexto('seção Objetivos preenchida', 'objetivos', 0.5)],
    tags: ['contexto', 'metas'],
  },
  {
    id: 'retorno_sobre_midia',
    titulo: 'Retorno sobre a mídia',
    descricao: 'Liga investimento em anúncio a receita ou vendas, com a referência comercial do cliente.',
    perguntas: ['Qual o retorno do investimento em mídia?', 'Quanto custa cada venda?'],
    requisitos: [
      tabela('investimento em anúncios', ['fato_ads_diario']),
      algum('receita medida', [
        tabela('vendas no CRM', ['fato_rd_negociacoes']),
        tabela('receita no site', ['fato_ga4_diario', 'fato_ga4_item_diario']),
      ]),
      contexto('seção Comercial preenchida', 'comercial', 0.4),
    ],
    tags: ['anuncios', 'vendas'],
  },
];
