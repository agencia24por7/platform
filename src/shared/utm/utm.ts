export const PADRAO_DE_UTM = {
  chaves: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'],
  tamanhoMaximo: 50,
  plataformas: {
    google: { medium: 'cpc', busca: true },
    meta: { medium: 'paid_social', busca: false },
    tiktok: { medium: 'paid_social', busca: false },
    linkedin: { medium: 'paid_social', busca: false },
    youtube: { medium: 'cpc', busca: false },
    microsoft: { medium: 'cpc', busca: true },
    x: { medium: 'paid_social', busca: false },
    pinterest: { medium: 'paid_social', busca: false },
    kwai: { medium: 'paid_social', busca: false },
    whatsapp: { medium: 'mensageria', busca: false },
    email: { medium: 'email', busca: false },
    rd_station: { medium: 'email', busca: false },
    outra: { medium: 'paid', busca: false },
  },
} as const;

export type Plataforma = keyof typeof PADRAO_DE_UTM.plataformas;

export type Utm = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content?: string;
  utm_term?: string;
};

export type EntradaUtm = {
  plataforma: string;
  tipoDePlano: string;
  slugDoPlano: string;
  periodo: string;
  content?: string;
  term?: string;
};

export type ItemDePrevia = {
  plataforma: Plataforma;
  url: string;
};

export type CodigoErroUtm =
  | 'plataforma_desconhecida'
  | 'valor_vazio'
  | 'valor_invalido'
  | 'valor_longo'
  | 'periodo_invalido'
  | 'termo_nao_permitido'
  | 'url_invalida'
  | 'url_nao_https';

export class ErroUtm extends Error {
  readonly codigo: CodigoErroUtm;

  constructor(codigo: CodigoErroUtm, mensagem: string) {
    super(mensagem);
    this.name = 'ErroUtm';
    this.codigo = codigo;
  }
}

const REGEX_PERIODO = /^(\d{4})-?(0[1-9]|1[0-2])$/;
const REGEX_VALOR_VALIDO = /^[a-z0-9_-]+$/;

function configDaPlataforma(plataforma: string) {
  if (!Object.hasOwn(PADRAO_DE_UTM.plataformas, plataforma)) {
    throw new ErroUtm('plataforma_desconhecida', `plataforma sem padrão de UTM: ${plataforma}`);
  }
  return PADRAO_DE_UTM.plataformas[plataforma as Plataforma];
}

export function sanitizar(valor: string, campo: string): string {
  const limpo = valor
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (limpo === '') {
    throw new ErroUtm('valor_vazio', `${campo} ficou vazio após normalização`);
  }
  return limpo;
}

function validarTamanho(valor: string, campo: string): string {
  if (valor.length > PADRAO_DE_UTM.tamanhoMaximo) {
    throw new ErroUtm(
      'valor_longo',
      `${campo} excede ${PADRAO_DE_UTM.tamanhoMaximo} caracteres: ${valor.length}`,
    );
  }
  return valor;
}

function normalizarPeriodo(periodo: string): string {
  const casamento = REGEX_PERIODO.exec(periodo.trim());
  if (casamento === null) {
    throw new ErroUtm('periodo_invalido', 'periodo deve ser AAAAMM ou AAAA-MM');
  }
  return `${casamento[1]}${casamento[2]}`;
}

export function montarUtm(entrada: EntradaUtm): Utm {
  const config = configDaPlataforma(entrada.plataforma);
  const tipo = sanitizar(entrada.tipoDePlano, 'tipoDePlano');
  const slug = sanitizar(entrada.slugDoPlano, 'slugDoPlano');
  const periodo = normalizarPeriodo(entrada.periodo);
  const campanha = validarTamanho(`${tipo}-${slug}-${periodo}`, 'utm_campaign');

  if (entrada.term !== undefined && !config.busca) {
    throw new ErroUtm('termo_nao_permitido', `utm_term só é permitido em busca paga, não em ${entrada.plataforma}`);
  }

  const conteudo =
    entrada.content === undefined
      ? undefined
      : validarTamanho(sanitizar(entrada.content, 'content'), 'utm_content');
  const termo =
    entrada.term === undefined ? undefined : validarTamanho(sanitizar(entrada.term, 'term'), 'utm_term');

  return {
    utm_source: entrada.plataforma,
    utm_medium: config.medium,
    utm_campaign: campanha,
    ...(conteudo === undefined ? {} : { utm_content: conteudo }),
    ...(termo === undefined ? {} : { utm_term: termo }),
  };
}

function paresDoUtm(utm: Utm): Array<[string, string]> {
  const pares: Array<[string, string]> = [
    ['utm_source', utm.utm_source],
    ['utm_medium', utm.utm_medium],
    ['utm_campaign', utm.utm_campaign],
  ];
  if (utm.utm_content !== undefined) pares.push(['utm_content', utm.utm_content]);
  if (utm.utm_term !== undefined) pares.push(['utm_term', utm.utm_term]);
  for (const [, valor] of pares) {
    if (!REGEX_VALOR_VALIDO.test(valor)) {
      throw new ErroUtm('valor_invalido', `valor de UTM fora de [a-z0-9_-]: ${valor}`);
    }
    validarTamanho(valor, 'valor de UTM');
  }
  return pares;
}

export function aplicarUtm(urlHttps: string, utm: Utm): string {
  let url: URL;
  try {
    url = new URL(urlHttps);
  } catch {
    throw new ErroUtm('url_invalida', 'URL inválida');
  }
  if (url.protocol !== 'https:') {
    throw new ErroUtm('url_nao_https', `apenas URL https é aceita, recebido ${url.protocol}`);
  }

  const pares = paresDoUtm(utm);
  const chavesDoUtm: readonly string[] = PADRAO_DE_UTM.chaves;
  const queryExistente = url.search
    .replace(/^\?/, '')
    .split('&')
    .filter((segmento) => segmento !== '')
    .filter((segmento) => !chavesDoUtm.includes(segmento.split('=')[0] ?? ''));

  const novosParametros = pares.map(([chave, valor]) => `${chave}=${encodeURIComponent(valor)}`);
  url.search = [...queryExistente, ...novosParametros].join('&');
  return url.toString();
}

export function previaDeUtm(
  entrada: Omit<EntradaUtm, 'plataforma'> & {
    urlHttps: string;
    plataformas?: readonly string[];
  },
): ItemDePrevia[] {
  const plataformas = entrada.plataformas ?? Object.keys(PADRAO_DE_UTM.plataformas);
  return plataformas.map((plataforma) => {
    const config = configDaPlataforma(plataforma);
    const utm = montarUtm({
      plataforma,
      tipoDePlano: entrada.tipoDePlano,
      slugDoPlano: entrada.slugDoPlano,
      periodo: entrada.periodo,
      content: entrada.content,
      term: config.busca ? entrada.term : undefined,
    });
    return { plataforma: plataforma as Plataforma, url: aplicarUtm(entrada.urlHttps, utm) };
  });
}
