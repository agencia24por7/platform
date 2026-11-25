export const VERSAO_DO_CATALOGO = 3;

export const NIVEIS = ['essencial', 'aprofundar'] as const;
export type Nivel = (typeof NIVEIS)[number];

export const EPISTEMICOS = ['fato', 'hipotese', 'desejo'] as const;
export type Epistemico = (typeof EPISTEMICOS)[number];

export const FONTES = ['cliente', 'equipe', 'pesquisa', 'ia'] as const;
export type Fonte = (typeof FONTES)[number];

export const REVISOES = ['confirmado', 'sugerido'] as const;
export type Revisao = (typeof REVISOES)[number];

export const ROTULO_EPISTEMICO: Record<Epistemico, string> = {
  fato: 'Fato',
  hipotese: 'Hipótese',
  desejo: 'Desejo',
};

export const ROTULO_FONTE: Record<Fonte, string> = {
  cliente: 'cliente',
  equipe: 'equipe',
  pesquisa: 'pesquisa',
  ia: 'IA',
};

export const CATEGORIAS_DE_ARQUIVO = ['imagem', 'documento', 'planilha', 'video', 'fonte'] as const;
export type CategoriaDeArquivo = (typeof CATEGORIAS_DE_ARQUIVO)[number];

export type Opcao = { readonly valor: string; readonly rotulo: string };

export type TipoDeCampo =
  | { readonly tipo: 'texto'; readonly max: number; readonly formato: 'livre' | 'arroba' }
  | { readonly tipo: 'texto_longo'; readonly max: number }
  | { readonly tipo: 'selecao'; readonly opcoes: readonly Opcao[]; readonly permiteOutro: boolean }
  | {
      readonly tipo: 'multipla';
      readonly opcoes: readonly Opcao[];
      readonly permiteOutro: boolean;
      readonly maxEscolhas: number;
    }
  | {
      readonly tipo: 'numero';
      readonly min: number;
      readonly max: number;
      readonly inteiro: boolean;
      readonly unidade: string | null;
    }
  | { readonly tipo: 'dinheiro'; readonly maxCentavos: number }
  | { readonly tipo: 'escala'; readonly min: 1; readonly max: 5; readonly extremos: readonly [string, string] }
  | { readonly tipo: 'url' }
  | { readonly tipo: 'booleano' }
  | { readonly tipo: 'arquivo'; readonly categorias: readonly CategoriaDeArquivo[]; readonly maxArquivos: number };

export type TipoSimples = TipoDeCampo['tipo'];

type Comum = {
  readonly key: string;
  readonly rotulo: string;
  readonly ajuda: string | null;
  readonly exemplo: string | null;
  readonly nivel: Nivel;
  readonly visivelAoCliente: boolean;
  readonly epistemicoPadrao: Epistemico;
  readonly contaNaCompletude: boolean;
  readonly obrigatorio: boolean;
};

export type CampoSimples = Comum & TipoDeCampo;

export type CampoLista = Comum & {
  readonly tipo: 'lista';
  readonly item: readonly CampoSimples[];
  readonly minimo: number;
  readonly maximo: number;
  readonly rotuloDoItem: string;
  readonly campoTitulo: string;
  readonly arquivoBrain: string;
  readonly avisoDeDadoPessoal: string | null;
};

export type Campo = CampoSimples | CampoLista;

export const SECOES = [
  'empresa',
  'produtos',
  'publico',
  'mercado',
  'marca',
  'presenca_digital',
  'performance',
  'comercial',
  'comunidade',
  'objetivos',
  'restricoes',
] as const;
export type SecaoKey = (typeof SECOES)[number];

export type Secao = {
  readonly key: SecaoKey;
  readonly letra: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly campos: readonly Campo[];
};

type Opcoes = {
  readonly ajuda?: string;
  readonly exemplo?: string;
  readonly nivel?: Nivel;
  readonly cliente?: boolean;
  readonly epistemico?: Epistemico;
  readonly completude?: boolean;
  readonly obrigatorio?: boolean;
};

function comum(key: string, rotulo: string, o: Opcoes): Comum {
  return {
    key,
    rotulo,
    ajuda: o.ajuda ?? null,
    exemplo: o.exemplo ?? null,
    nivel: o.nivel ?? 'aprofundar',
    visivelAoCliente: o.cliente ?? true,
    epistemicoPadrao: o.epistemico ?? 'fato',
    contaNaCompletude: o.completude ?? true,
    obrigatorio: o.obrigatorio ?? false,
  };
}

const ESSENCIAL = { nivel: 'essencial' } as const;

function ops(pares: readonly (readonly [string, string])[]): readonly Opcao[] {
  return pares.map(([valor, rotulo]) => ({ valor, rotulo }));
}

const texto = (key: string, rotulo: string, o: Opcoes & { max?: number } = {}): CampoSimples => ({
  ...comum(key, rotulo, o),
  tipo: 'texto',
  max: o.max ?? 200,
  formato: 'livre',
});

const arroba = (key: string, rotulo: string, o: Opcoes = {}): CampoSimples => ({
  ...comum(key, rotulo, o),
  tipo: 'texto',
  max: 100,
  formato: 'arroba',
});

const textoLongo = (key: string, rotulo: string, o: Opcoes & { max?: number } = {}): CampoSimples => ({
  ...comum(key, rotulo, o),
  tipo: 'texto_longo',
  max: o.max ?? 2000,
});

const selecao = (
  key: string,
  rotulo: string,
  opcoes: readonly Opcao[],
  o: Opcoes & { outro?: boolean } = {},
): CampoSimples => ({ ...comum(key, rotulo, o), tipo: 'selecao', opcoes, permiteOutro: o.outro ?? false });

const multipla = (
  key: string,
  rotulo: string,
  opcoes: readonly Opcao[],
  o: Opcoes & { outro?: boolean; maxEscolhas?: number } = {},
): CampoSimples => ({
  ...comum(key, rotulo, o),
  tipo: 'multipla',
  opcoes,
  permiteOutro: o.outro ?? false,
  maxEscolhas: o.maxEscolhas ?? opcoes.length + (o.outro ? 3 : 0),
});

const numero = (
  key: string,
  rotulo: string,
  o: Opcoes & { min?: number; max?: number; inteiro?: boolean; unidade?: string } = {},
): CampoSimples => ({
  ...comum(key, rotulo, o),
  tipo: 'numero',
  min: o.min ?? 0,
  max: o.max ?? 1_000_000_000,
  inteiro: o.inteiro ?? false,
  unidade: o.unidade ?? null,
});

const percentual = (key: string, rotulo: string, o: Opcoes = {}): CampoSimples =>
  numero(key, rotulo, { ...o, min: 0, max: 100, unidade: '%' });

const dinheiro = (key: string, rotulo: string, o: Opcoes = {}): CampoSimples => ({
  ...comum(key, rotulo, o),
  tipo: 'dinheiro',
  maxCentavos: 100_000_000_000,
});

const escala = (key: string, rotulo: string, extremos: readonly [string, string], o: Opcoes = {}): CampoSimples => ({
  ...comum(key, rotulo, o),
  tipo: 'escala',
  min: 1,
  max: 5,
  extremos,
});

const url = (key: string, rotulo: string, o: Opcoes = {}): CampoSimples => ({ ...comum(key, rotulo, o), tipo: 'url' });

const booleano = (key: string, rotulo: string, o: Opcoes = {}): CampoSimples => ({
  ...comum(key, rotulo, o),
  tipo: 'booleano',
});

const arquivo = (
  key: string,
  rotulo: string,
  categorias: readonly CategoriaDeArquivo[],
  o: Opcoes & { maxArquivos?: number } = {},
): CampoSimples => ({ ...comum(key, rotulo, o), tipo: 'arquivo', categorias, maxArquivos: o.maxArquivos ?? 10 });

const lista = (
  key: string,
  rotulo: string,
  definicao: {
    readonly item: readonly CampoSimples[];
    readonly rotuloDoItem: string;
    readonly campoTitulo: string;
    readonly arquivoBrain: string;
    readonly minimo?: number;
    readonly maximo?: number;
    readonly avisoDeDadoPessoal?: string;
  },
  o: Opcoes = {},
): CampoLista => ({
  ...comum(key, rotulo, o),
  tipo: 'lista',
  item: definicao.item,
  rotuloDoItem: definicao.rotuloDoItem,
  campoTitulo: definicao.campoTitulo,
  arquivoBrain: definicao.arquivoBrain,
  minimo: definicao.minimo ?? 1,
  maximo: definicao.maximo ?? 100,
  avisoDeDadoPessoal: definicao.avisoDeDadoPessoal ?? null,
});

const notasInternas = (secao: SecaoKey): CampoSimples =>
  textoLongo(`notas_internas_${secao}`, 'Notas internas da equipe', {
    ajuda: 'Só a equipe vê. Nunca aparece no formulário enviado ao cliente.',
    cliente: false,
    completude: false,
    epistemico: 'hipotese',
    max: 4000,
  });

const SIM_NAO = ops([
  ['sim', 'Sim'],
  ['nao', 'Não'],
  ['nao_sei', 'Não sei'],
]);

const FUNCIONA = ops([
  ['sim', 'Funciona'],
  ['nao', 'Não funciona'],
  ['nao_tem', 'Não temos'],
  ['nao_sei', 'Não sei'],
]);

export const REDES_SOCIAIS = ops([
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['tiktok', 'TikTok'],
  ['youtube', 'YouTube'],
  ['linkedin', 'LinkedIn'],
  ['x', 'X (Twitter)'],
  ['pinterest', 'Pinterest'],
  ['threads', 'Threads'],
  ['kwai', 'Kwai'],
  ['whatsapp_canal', 'Canal do WhatsApp'],
  ['spotify', 'Spotify / podcast'],
]);

const empresa: Secao = {
  key: 'empresa',
  letra: 'A',
  titulo: 'Empresa',
  descricao: 'Quem é o cliente, o que faz e por que alguém compra dele.',
  campos: [
    texto('nome_empresa', 'Nome da empresa', { ...ESSENCIAL, ajuda: 'O nome pelo qual o público conhece a marca.' }),
    texto('segmento', 'Segmento', { ...ESSENCIAL, exemplo: 'Clínica odontológica, moda feminina, SaaS de RH…' }),
    url('site', 'Site', ESSENCIAL),
    texto('cidade', 'Cidade-sede', ESSENCIAL),
    selecao(
      'area_de_atuacao',
      'Área onde atua',
      ops([
        ['local', 'Local'],
        ['regional', 'Regional'],
        ['nacional', 'Nacional'],
        ['internacional', 'Internacional'],
        ['online', 'Só online'],
      ]),
      ESSENCIAL,
    ),
    multipla(
      'modelo_de_negocio',
      'Modelo de negócio',
      ops([
        ['b2b', 'B2B'],
        ['b2c', 'B2C'],
        ['d2c', 'D2C (vende direto da marca)'],
        ['marketplace', 'Marketplace'],
        ['servico', 'Serviço'],
        ['recorrencia', 'Recorrência / assinatura'],
      ]),
      { ...ESSENCIAL, ajuda: 'Como a empresa vende; marque todos que se aplicam. É diferente do tipo de operação (geração de leads ou e-commerce), que é definido no cadastro do cliente e não se edita aqui.' },
    ),
    selecao(
      'tempo_de_mercado',
      'Tempo de mercado',
      ops([
        ['menos_1', 'Menos de 1 ano'],
        ['1_3', '1 a 3 anos'],
        ['3_5', '3 a 5 anos'],
        ['5_10', '5 a 10 anos'],
        ['mais_10', 'Mais de 10 anos'],
      ]),
    ),
    selecao(
      'tamanho_do_time',
      'Tamanho do time',
      ops([
        ['1', 'Só eu'],
        ['2_5', '2 a 5 pessoas'],
        ['6_20', '6 a 20 pessoas'],
        ['21_50', '21 a 50 pessoas'],
        ['51_200', '51 a 200 pessoas'],
        ['mais_200', 'Mais de 200 pessoas'],
      ]),
    ),
    selecao(
      'faixa_de_faturamento',
      'Faixa de faturamento anual',
      ops([
        ['ate_360k', 'Até R$ 360 mil'],
        ['360k_4_8m', 'R$ 360 mil a R$ 4,8 milhões'],
        ['4_8m_20m', 'R$ 4,8 a R$ 20 milhões'],
        ['20m_100m', 'R$ 20 a R$ 100 milhões'],
        ['mais_100m', 'Mais de R$ 100 milhões'],
        ['prefiro_nao_dizer', 'Prefiro não dizer'],
      ]),
    ),
    textoLongo('descricao_do_cliente', 'Descrição do negócio', {
      ...ESSENCIAL,
      ajuda: 'O que faz, para quem, e por que alguém compra de vocês e não do concorrente.',
      max: 3000,
    }),
    textoLongo('historia_de_fundacao', 'História de fundação'),
    textoLongo('proposito', 'Propósito', { max: 800 }),
    textoLongo('missao', 'Missão', { max: 800 }),
    textoLongo('valores', 'Valores', { max: 1200 }),
    lista(
      'diferenciais',
      'Maiores diferenciais',
      {
        rotuloDoItem: 'Diferencial',
        campoTitulo: 'diferencial',
        arquivoBrain: 'diferenciais.jsonl',
        minimo: 3,
        maximo: 10,
        item: [
          texto('diferencial', 'Diferencial', { obrigatorio: true }),
          textoLongo('prova', 'Prova', { ajuda: 'Número, prêmio, depoimento ou fato que comprova.', max: 1000 }),
        ],
      },
      { ...ESSENCIAL, ajuda: 'Os 3 maiores diferenciais, cada um com a prova.' },
    ),
    notasInternas('empresa'),
  ],
};

const produtos: Secao = {
  key: 'produtos',
  letra: 'B',
  titulo: 'Produtos e serviços',
  descricao: 'O que é vendido, por quanto e para quem. Cadastre um a um ou envie a planilha/feed.',
  campos: [
    lista(
      'produtos',
      'Produtos e serviços',
      {
        rotuloDoItem: 'Produto ou serviço',
        campoTitulo: 'nome',
        arquivoBrain: 'produtos.jsonl',
        minimo: 1,
        maximo: 500,
        item: [
          texto('nome', 'Nome', { obrigatorio: true }),
          texto('categoria', 'Categoria'),
          textoLongo('descricao', 'Descrição', { max: 2000 }),
          url('link', 'Link'),
          arquivo('foto', 'Foto', ['imagem'], { maxArquivos: 5 }),
          dinheiro('preco', 'Preço'),
          percentual('margem_aproximada', 'Margem aproximada'),
          dinheiro('ticket_medio', 'Ticket médio'),
          multipla(
            'papel',
            'Papel no negócio',
            ops([
              ['carro_chefe', 'Carro-chefe'],
              ['porta_de_entrada', 'Porta de entrada'],
              ['recompra', 'Recompra'],
              ['lucro', 'Dá lucro'],
            ]),
          ),
          textoLongo('para_quem', 'Para quem é', { max: 800 }),
          textoLongo('problema_que_resolve', 'Problema que resolve', { max: 800 }),
          textoLongo('objecoes', 'Principais objeções e como responde', { max: 1500 }),
          texto('sazonalidade', 'Sazonalidade'),
          texto('estoque', 'Estoque / capacidade'),
          selecao(
            'recorrencia',
            'Recorrência',
            ops([
              ['unica', 'Compra única'],
              ['recorrente', 'Recompra frequente'],
              ['assinatura', 'Assinatura'],
            ]),
          ),
        ],
      },
      ESSENCIAL,
    ),
    texto('produto_para_vender_mais', 'Qual produto quer vender mais?', ESSENCIAL),
    texto('produto_mais_lucrativo', 'Qual dá mais lucro?'),
    texto('produto_porta_de_entrada', 'Qual traz o cliente pela primeira vez?'),
    arquivo('catalogo_arquivo', 'Planilha ou feed de produtos', ['planilha'], {
      ajuda: 'CSV ou XLSX com nome, preço, link e descrição.',
      maxArquivos: 3,
    }),
    url('feed_url', 'Endereço do feed de produtos', { ajuda: 'Feed do Google Merchant, Meta Catalog ou da loja.' }),
    notasInternas('produtos'),
  ],
};

const AVISO_PERSONA =
  'Persona é um arquétipo. Não use nome, foto ou dado de um cliente real; descreva o tipo de pessoa.';

const publico: Secao = {
  key: 'publico',
  letra: 'C',
  titulo: 'Público e personas',
  descricao: 'Para quem a comunicação fala, o que essas pessoas sentem e como decidem.',
  campos: [
    lista(
      'personas',
      'Personas',
      {
        rotuloDoItem: 'Persona',
        campoTitulo: 'nome',
        arquivoBrain: 'personas.jsonl',
        minimo: 1,
        maximo: 12,
        avisoDeDadoPessoal: AVISO_PERSONA,
        item: [
          texto('nome', 'Nome da persona', { obrigatorio: true, exemplo: 'Ana, a gestora sobrecarregada', max: 80 }),
          texto('idade', 'Faixa de idade', { exemplo: '30 a 45 anos', max: 40 }),
          texto('renda', 'Faixa de renda', { max: 80 }),
          texto('regiao', 'Região', { max: 120 }),
          texto('cargo', 'Cargo (se B2B)', { max: 120 }),
          textoLongo('dores', 'Dores', { max: 1200 }),
          textoLongo('desejos', 'Desejos', { max: 1200 }),
          textoLongo('medos', 'Medos', { max: 1200 }),
          textoLongo('objecoes', 'Objeções', { max: 1200 }),
          textoLongo('gatilho_de_compra', 'O que dispara a compra', { max: 800 }),
          texto('quem_decide', 'Quem decide'),
          texto('quem_influencia', 'Quem influencia'),
          textoLongo('onde_consome_conteudo', 'Onde consome conteúdo', { max: 800 }),
          textoLongo('como_fala', 'Como fala (gírias, termos)', { max: 800 }),
          textoLongo('jornada_descobre', 'Jornada: como descobre', { max: 800 }),
          textoLongo('jornada_pesquisa', 'Jornada: como pesquisa', { max: 800 }),
          textoLongo('jornada_compra', 'Jornada: como compra', { max: 800 }),
          textoLongo('jornada_recompra', 'Jornada: como recompra', { max: 800 }),
        ],
      },
      { ...ESSENCIAL, ajuda: AVISO_PERSONA },
    ),
    textoLongo('melhor_cliente_hoje', 'Quem é o melhor cliente hoje?', { ...ESSENCIAL, max: 1200 }),
    textoLongo('quem_nao_quer_atender', 'Quem vocês não querem atender?', { max: 1200 }),
    notasInternas('publico'),
  ],
};

const mercado: Secao = {
  key: 'mercado',
  letra: 'D',
  titulo: 'Mercado e concorrência',
  descricao: 'Com quem o cliente disputa atenção e quem ele usa como referência.',
  campos: [
    lista(
      'concorrentes',
      'Concorrentes',
      {
        rotuloDoItem: 'Concorrente',
        campoTitulo: 'nome',
        arquivoBrain: 'concorrentes.jsonl',
        minimo: 2,
        maximo: 30,
        item: [
          texto('nome', 'Nome', { obrigatorio: true }),
          url('site', 'Site'),
          textoLongo('redes', 'Redes sociais', { max: 500, exemplo: '@concorrente no Instagram' }),
          textoLongo('faz_bem', 'O que faz bem', { max: 1000 }),
          textoLongo('onde_falha', 'Onde falha', { max: 1000 }),
          selecao(
            'preco_comparado',
            'Preço comparado ao nosso',
            ops([
              ['mais_barato', 'Mais barato'],
              ['parecido', 'Parecido'],
              ['mais_caro', 'Mais caro'],
              ['nao_sei', 'Não sei'],
            ]),
          ),
        ],
      },
      ESSENCIAL,
    ),
    lista('marcas_admiradas', 'Marcas que admira', {
      rotuloDoItem: 'Marca',
      campoTitulo: 'marca',
      arquivoBrain: 'marcas-admiradas.jsonl',
      minimo: 1,
      maximo: 20,
      item: [
        texto('marca', 'Marca', { obrigatorio: true }),
        texto('setor', 'Setor'),
        textoLongo('por_que', 'Por quê', { max: 800 }),
      ],
    }),
    textoLongo('tendencias_e_ameacas', 'Tendências e ameaças do setor', { epistemico: 'hipotese' }),
    notasInternas('mercado'),
  ],
};

const marca: Secao = {
  key: 'marca',
  letra: 'E',
  titulo: 'Marca',
  descricao: 'Como a marca quer ser percebida, como fala e o que nunca diz.',
  campos: [
    textoLongo('posicionamento_atual', 'Posicionamento atual', { ...ESSENCIAL, max: 1200 }),
    textoLongo('posicionamento_desejado', 'Posicionamento desejado', { max: 1200, epistemico: 'desejo' }),
    texto('promessa_da_marca', 'Promessa da marca', { max: 300 }),
    texto('tagline', 'Tagline', { max: 120 }),
    escala('tom_formal_informal', 'Tom: formal ou informal?', ['Formal', 'Informal'], ESSENCIAL),
    escala('tom_serio_divertido', 'Tom: sério ou divertido?', ['Sério', 'Divertido'], ESSENCIAL),
    escala('tom_tecnico_simples', 'Tom: técnico ou simples?', ['Técnico', 'Simples'], ESSENCIAL),
    textoLongo('palavras_que_usa', 'Palavras que a marca usa', { max: 1000 }),
    textoLongo('palavras_proibidas', 'Palavras proibidas', { ...ESSENCIAL, max: 1000 }),
    arquivo('manual_de_marca', 'Manual de marca', ['documento'], { maxArquivos: 3 }),
    arquivo('logo', 'Logo', ['imagem'], { maxArquivos: 5 }),
    texto('cores', 'Cores', { exemplo: '#0A3D62, #F6B93B', max: 200 }),
    texto('fontes', 'Fontes', { max: 200 }),
    arquivo('arquivos_de_fonte', 'Arquivos das fontes', ['fonte'], { ajuda: 'TTF, OTF ou WOFF2.', maxArquivos: 10 }),
    arquivo('referencias_visuais', 'Referências visuais', ['imagem'], {
      ajuda: 'Imagens de peças, sites ou campanhas, da marca ou de outras, que mostram o visual que o cliente quer seguir.',
      maxArquivos: 20,
    }),
    arquivo('identidade_visual', 'Identidade visual', ['imagem'], {
      ajuda: 'Paleta, padrões, aplicações da marca e exemplos de uso. O logo e o manual têm campos próprios acima.',
      maxArquivos: 20,
    }),
    arquivo('criativos_historicos', 'Criativos históricos da marca', ['imagem', 'video'], {
      ajuda: 'Anúncios e posts que a marca já publicou, principalmente os que mais funcionaram. Evite imagens com pessoas identificáveis sem autorização de uso.',
      maxArquivos: 30,
    }),
    selecao(
      'arquetipo',
      'Arquétipo',
      ops([
        ['inocente', 'Inocente'],
        ['explorador', 'Explorador'],
        ['sabio', 'Sábio'],
        ['heroi', 'Herói'],
        ['fora_da_lei', 'Fora da lei'],
        ['mago', 'Mago'],
        ['cara_comum', 'Cara comum'],
        ['amante', 'Amante'],
        ['bobo_da_corte', 'Bobo da corte'],
        ['cuidador', 'Cuidador'],
        ['criador', 'Criador'],
        ['governante', 'Governante'],
      ]),
      { outro: true },
    ),
    textoLongo('personalidade', 'Se a marca fosse uma pessoa…', { max: 1200 }),
    textoLongo('lembrado_em_3_anos', 'Como quer ser lembrado daqui a 3 anos?', {
      ...ESSENCIAL,
      epistemico: 'desejo',
      max: 1200,
    }),
    notasInternas('marca'),
  ],
};

const presencaDigital: Secao = {
  key: 'presenca_digital',
  letra: 'F',
  titulo: 'Presença digital',
  descricao: 'Onde a marca está hoje e quem cuida de cada canal.',
  campos: [
    lista(
      'redes_sociais',
      'Redes sociais',
      {
        rotuloDoItem: 'Rede',
        campoTitulo: 'perfil',
        arquivoBrain: 'redes.jsonl',
        minimo: 1,
        maximo: 30,
        item: [
          selecao('rede', 'Rede', REDES_SOCIAIS, { outro: true, obrigatorio: true }),
          arroba('perfil', 'Perfil (@)', { obrigatorio: true }),
          url('link', 'Link do perfil'),
          numero('seguidores', 'Seguidores', { inteiro: true }),
          selecao(
            'frequencia_posts',
            'Frequência de posts',
            ops([
              ['diaria', 'Diária'],
              ['varias_por_semana', 'Várias por semana'],
              ['semanal', 'Semanal'],
              ['quinzenal', 'Quinzenal'],
              ['mensal', 'Mensal'],
              ['irregular', 'Irregular'],
            ]),
          ),
          selecao(
            'quem_cuida',
            'Quem cuida',
            ops([
              ['interno', 'Time interno'],
              ['agencia', 'Agência'],
              ['freelancer', 'Freelancer'],
              ['ninguem', 'Ninguém'],
            ]),
            { outro: true },
          ),
          multipla(
            'formatos',
            'Formatos que funcionam melhor',
            ops([
              ['reels', 'Reels / vídeo curto'],
              ['stories', 'Stories'],
              ['carrossel', 'Carrossel'],
              ['imagem', 'Imagem'],
              ['video_longo', 'Vídeo longo'],
              ['live', 'Live'],
              ['texto', 'Texto'],
            ]),
            { outro: true },
          ),
          selecao(
            'status',
            'Situação',
            ops([
              ['ativo', 'Ativo'],
              ['parado', 'Parado'],
            ]),
          ),
        ],
      },
      ESSENCIAL,
    ),
    selecao(
      'plataforma_ecommerce',
      'Plataforma do site / e-commerce',
      ops([
        ['shopify', 'Shopify'],
        ['nuvemshop', 'Nuvemshop'],
        ['vtex', 'VTEX'],
        ['woocommerce', 'WooCommerce'],
        ['tray', 'Tray'],
        ['loja_integrada', 'Loja Integrada'],
        ['wordpress', 'WordPress (sem loja)'],
        ['nenhuma', 'Não temos loja online'],
      ]),
      { outro: true },
    ),
    url('google_meu_negocio', 'Perfil no Google Meu Negócio'),
    multipla(
      'marketplaces',
      'Marketplaces',
      ops([
        ['mercado_livre', 'Mercado Livre'],
        ['amazon', 'Amazon'],
        ['shopee', 'Shopee'],
        ['magalu', 'Magalu'],
        ['ifood', 'iFood'],
      ]),
      { outro: true },
    ),
    selecao('whatsapp_business', 'Usa WhatsApp Business?', SIM_NAO),
    numero('base_de_emails', 'Tamanho da base de e-mails', { inteiro: true, unidade: 'contatos' }),
    selecao(
      'crm',
      'CRM',
      ops([
        ['rd_station', 'RD Station'],
        ['hubspot', 'HubSpot'],
        ['pipedrive', 'Pipedrive'],
        ['salesforce', 'Salesforce'],
        ['kommo', 'Kommo'],
        ['planilha', 'Planilha'],
        ['nenhum', 'Não usamos'],
      ]),
      { outro: true },
    ),
    notasInternas('presenca_digital'),
  ],
};

const performance: Secao = {
  key: 'performance',
  letra: 'G',
  titulo: 'Performance e dados',
  descricao: 'Quanto investe, o que mede e o que já funcionou.',
  campos: [
    lista(
      'canais_pagos',
      'Canais pagos atuais',
      {
        rotuloDoItem: 'Canal',
        campoTitulo: 'canal',
        arquivoBrain: 'canais-pagos.jsonl',
        minimo: 1,
        maximo: 20,
        item: [
          selecao(
            'canal',
            'Canal',
            ops([
              ['meta_ads', 'Meta Ads'],
              ['google_ads', 'Google Ads'],
              ['tiktok_ads', 'TikTok Ads'],
              ['linkedin_ads', 'LinkedIn Ads'],
              ['youtube_ads', 'YouTube Ads'],
              ['influenciadores', 'Influenciadores'],
            ]),
            { outro: true, obrigatorio: true },
          ),
          dinheiro('investimento_mensal', 'Investimento mensal'),
        ],
      },
      ESSENCIAL,
    ),
    dinheiro('cac', 'CAC (custo por cliente)'),
    dinheiro('ltv', 'LTV (valor do cliente no tempo)'),
    numero('roas', 'ROAS', { max: 1000, unidade: 'x' }),
    percentual('taxa_de_conversao', 'Taxa de conversão'),
    dinheiro('ticket_medio_geral', 'Ticket médio'),
    numero('leads_por_mes', 'Leads por mês', { inteiro: true }),
    selecao('rastreamento_ga4', 'GA4 funciona?', FUNCIONA, ESSENCIAL),
    selecao('rastreamento_pixel_capi', 'Pixel / API de Conversões funciona?', FUNCIONA, ESSENCIAL),
    selecao('rastreamento_gtm', 'Google Tag Manager funciona?', FUNCIONA),
    selecao('rastreamento_utms', 'UTMs são usadas?', FUNCIONA),
    multipla(
      'acessos_concedidos',
      'Acessos já concedidos à agência',
      ops([
        ['gerenciador_de_anuncios', 'Gerenciador de anúncios (Meta)'],
        ['google_ads', 'Google Ads'],
        ['analytics', 'Google Analytics'],
        ['gtm', 'Google Tag Manager'],
        ['search_console', 'Search Console'],
      ]),
    ),
    lista('historico_campanhas', 'Campanhas e criativos que funcionaram (e que não)', {
      rotuloDoItem: 'Campanha ou criativo',
      campoTitulo: 'nome',
      arquivoBrain: 'campanhas.jsonl',
      minimo: 1,
      maximo: 100,
      item: [
        texto('nome', 'Nome', { obrigatorio: true }),
        texto('canal', 'Canal'),
        texto('periodo', 'Quando', { exemplo: 'Black Friday 2025', max: 80 }),
        selecao(
          'resultado',
          'Resultado',
          ops([
            ['funcionou', 'Funcionou'],
            ['nao_funcionou', 'Não funcionou'],
            ['neutro', 'Neutro'],
          ]),
          { obrigatorio: true },
        ),
        textoLongo('por_que', 'Por quê', { max: 1200 }),
        url('link', 'Link do criativo'),
        arquivo('criativo', 'Arquivo do criativo', ['imagem', 'video'], { maxArquivos: 3 }),
      ],
    }),
    textoLongo('maior_gargalo_do_funil', 'Onde está o maior gargalo do funil hoje?', { ...ESSENCIAL, max: 1200 }),
    notasInternas('performance'),
  ],
};

const comercial: Secao = {
  key: 'comercial',
  letra: 'H',
  titulo: 'Comercial',
  descricao: 'O que acontece depois que o lead chega.',
  campos: [
    textoLongo('processo_de_venda', 'Processo de venda', { ...ESSENCIAL, max: 2000 }),
    texto('time_comercial', 'Time comercial', { exemplo: '2 vendedores e 1 SDR' }),
    texto('ciclo_de_venda', 'Ciclo de venda', { exemplo: '15 dias do primeiro contato ao fechamento', max: 120 }),
    percentual('taxa_de_fechamento', 'Taxa de fechamento'),
    textoLongo('atendimento_do_lead', 'O que acontece com um lead depois que chega', {
      ...ESSENCIAL,
      ajuda: 'Em quanto tempo é atendido, por quem, com qual roteiro.',
      max: 2000,
    }),
    textoLongo('pos_venda_e_recompra', 'Pós-venda e recompra', { max: 1500 }),
    notasInternas('comercial'),
  ],
};

const comunidade: Secao = {
  key: 'comunidade',
  letra: 'I',
  titulo: 'Comunidade',
  descricao: 'Quem defende a marca e em torno de que interesse os clientes se juntam.',
  campos: [
    selecao('tem_clientes_fas', 'Existem clientes fãs, que indicam ou postam espontaneamente?', SIM_NAO, ESSENCIAL),
    textoLongo('sobre_os_fas', 'Conte sobre eles', { max: 1200 }),
    lista('depoimentos', 'Depoimentos, cases e avaliações', {
      rotuloDoItem: 'Depoimento',
      campoTitulo: 'origem',
      arquivoBrain: 'depoimentos.jsonl',
      minimo: 1,
      maximo: 200,
      avisoDeDadoPessoal:
        'Só inclua nome, foto ou vídeo de quem autorizou o uso. Na dúvida, descreva sem identificar (ex.: "cliente de Recife, 2025").',
      item: [
        texto('origem', 'De quem / onde', { obrigatorio: true, exemplo: 'Avaliação no Google, 2025', max: 120 }),
        textoLongo('texto', 'Depoimento', { max: 2000 }),
        url('link', 'Link'),
        arquivo('anexo', 'Imagem ou vídeo', ['imagem', 'video'], { maxArquivos: 3 }),
        booleano('autorizado', 'Quem aparece autorizou o uso?'),
      ],
    }),
    numero('nps', 'NPS', { min: -100, max: 100, inteiro: true }),
    textoLongo('avaliacoes', 'Avaliações (nota e onde)', { max: 800 }),
    textoLongo('grupos_eventos_fidelidade', 'Grupos, eventos, programa de fidelidade ou indicação', { max: 1200 }),
    textoLongo('causas_parcerias_influenciadores', 'Causas, parcerias, influenciadores e criadores ligados à marca', {
      max: 1200,
    }),
    textoLongo('interesse_em_comum', 'Em torno de que interesse ou identidade seus clientes se juntariam?', {
      ...ESSENCIAL,
      max: 1200,
    }),
    notasInternas('comunidade'),
  ],
};

const objetivos: Secao = {
  key: 'objetivos',
  letra: 'J',
  titulo: 'Objetivos e metas',
  descricao: 'Aonde o cliente quer chegar e quando. Limites de orçamento ficam na aba Regras.',
  campos: [
    textoLongo('objetivo_90_dias', 'Objetivo principal para os próximos 90 dias', {
      ...ESSENCIAL,
      epistemico: 'desejo',
      max: 1000,
    }),
    textoLongo('objetivo_12_meses', 'Objetivo principal para 12 meses', { ...ESSENCIAL, epistemico: 'desejo', max: 1000 }),
    texto('indicador_principal', 'Indicador principal', { ...ESSENCIAL, exemplo: 'Leads qualificados por mês' }),
    textoLongo('metas_em_numeros', 'Metas em números', { epistemico: 'desejo', max: 1000 }),
    percentual('orcamento_marca_pct', 'Parte do orçamento em marca'),
    percentual('orcamento_performance_pct', 'Parte do orçamento em performance'),
    percentual('orcamento_comunidade_pct', 'Parte do orçamento em comunidade'),
    lista('datas_chave', 'Datas-chave, lançamentos e sazonalidade', {
      rotuloDoItem: 'Data',
      campoTitulo: 'o_que',
      arquivoBrain: 'datas-chave.jsonl',
      minimo: 1,
      maximo: 60,
      item: [
        texto('quando', 'Quando', { obrigatorio: true, exemplo: 'Março, ou 15/11', max: 80 }),
        texto('o_que', 'O quê', { obrigatorio: true }),
        selecao(
          'tipo',
          'Tipo',
          ops([
            ['lancamento', 'Lançamento'],
            ['sazonalidade', 'Sazonalidade'],
            ['data_comemorativa', 'Data comemorativa'],
            ['evento', 'Evento'],
          ]),
          { outro: true },
        ),
      ],
    }),
    notasInternas('objetivos'),
  ],
};

const restricoes: Secao = {
  key: 'restricoes',
  letra: 'K',
  titulo: 'Restrições e operação',
  descricao: 'O que já existe internamente: recursos e mídia. Regras e limites ficam na aba Regras.',
  campos: [
    multipla(
      'recursos_internos',
      'O que existe internamente',
      ops([
        ['foto', 'Produção de foto'],
        ['video', 'Produção de vídeo'],
        ['designer', 'Designer'],
        ['social_media', 'Social media'],
        ['redator', 'Redator'],
        ['trafego', 'Gestor de tráfego'],
      ]),
      { outro: true },
    ),
    arquivo('banco_de_midia', 'Banco de imagens, vídeos e depoimentos', ['imagem', 'video', 'documento'], {
      maxArquivos: 50,
    }),
    textoLongo('links_de_midia', 'Links de pastas com mídia', {
      ajuda: 'Drive, Dropbox ou outro lugar com arquivos grandes.',
      max: 1000,
    }),
    notasInternas('restricoes'),
  ],
};

export const CATALOGO: readonly Secao[] = [
  empresa,
  produtos,
  publico,
  mercado,
  marca,
  presencaDigital,
  performance,
  comercial,
  comunidade,
  objetivos,
  restricoes,
];

type Localizado = { readonly secao: Secao; readonly campo: Campo };

const POR_CHAVE: ReadonlyMap<string, Localizado> = new Map(
  CATALOGO.flatMap((secao) => secao.campos.map((campo) => [campo.key, { secao, campo }] as const)),
);

export function localizarCampo(key: string): Localizado | null {
  return POR_CHAVE.get(key) ?? null;
}

export function campoSimples(key: string): (Localizado & { readonly campo: CampoSimples }) | null {
  const achado = POR_CHAVE.get(key);
  return achado && achado.campo.tipo !== 'lista' ? (achado as Localizado & { readonly campo: CampoSimples }) : null;
}

export function campoLista(key: string): (Localizado & { readonly campo: CampoLista }) | null {
  const achado = POR_CHAVE.get(key);
  return achado && achado.campo.tipo === 'lista' ? (achado as Localizado & { readonly campo: CampoLista }) : null;
}

export function secao(key: string): Secao | null {
  return CATALOGO.find((s) => s.key === key) ?? null;
}

export function ehSecao(key: string): key is SecaoKey {
  return (SECOES as readonly string[]).includes(key);
}

export function camposVisiveisAoCliente(secoes: readonly string[]): readonly Campo[] {
  return CATALOGO.filter((s) => secoes.includes(s.key)).flatMap((s) => s.campos.filter((c) => c.visivelAoCliente));
}

export function catalogoParaCliente(secoes: readonly string[]): readonly Secao[] {
  return CATALOGO.filter((s) => secoes.includes(s.key)).map((s) => ({
    ...s,
    campos: s.campos.filter((c) => c.visivelAoCliente),
  }));
}
