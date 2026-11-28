import { z } from 'zod';
import { validarUrlDeDestino } from '../../clients/domain/destino/urlDeDestino.ts';
import { failure, type Failure } from '../../../shared/result/failure.ts';
import { err, ok, type Result } from '../../../shared/result/result.ts';
import { NOTAS_DE_EVIDENCIA } from './entrada.ts';
import { procurarPii } from './privacidade.ts';
import { diasEntre, hojeEmSaoPaulo, somarDias } from './tempo.ts';

export const TIPOS_DE_SINAL = ['tendencia', 'meme', 'conversa', 'comunidade', 'referencia_criativa', 'anti_referencia'] as const;
export type TipoDeSinal = (typeof TIPOS_DE_SINAL)[number];

export const ORIGENS_DO_SINAL = ['manual', 'coletor'] as const;
export type OrigemDoSinal = (typeof ORIGENS_DO_SINAL)[number];

export const TIPO_NO_CATALOGO: Readonly<Record<TipoDeSinal, string>> = {
  tendencia: 'culture_tendencia',
  meme: 'culture_meme',
  conversa: 'culture_conversa',
  comunidade: 'culture_comunidade',
  referencia_criativa: 'culture_referencia',
  anti_referencia: 'culture_anti_referencia',
};

export const TIPOS_NO_CATALOGO_DE_CULTURA: readonly string[] = TIPOS_DE_SINAL.map((tipo) => TIPO_NO_CATALOGO[tipo]);

export const PLATAFORMAS_DE_SINAL = [
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'kwai',
  'reddit',
  'linkedin',
  'pinterest',
  'twitch',
  'whatsapp',
  'google_trends',
  'outra',
] as const;

export const LIMITES_DO_SINAL = {
  titulo: 160,
  resumo: 600,
  fonteNome: 120,
  fonteUrl: 2048,
  plataforma: 48,
  diasDeValidade: 90,
  tamanhoDoLote: 50,
} as const;

export type SinalDeCultura = {
  readonly id: string;
  readonly tipo: TipoDeSinal;
  readonly titulo: string;
  readonly resumo: string;
  readonly fonteUrl: string;
  readonly fonteNome: string;
  readonly plataforma: string | null;
  readonly observadoEm: string;
  readonly validoAte: string;
  readonly nota: (typeof NOTAS_DE_EVIDENCIA)[number];
  readonly origem: OrigemDoSinal;
  readonly criadoEm: Date;
};

export type NovoSinalDeCultura = Omit<SinalDeCultura, 'id' | 'origem' | 'criadoEm'>;

const PADRAO_DE_HANDLE = /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.]{2,}/u;
const PADRAO_DA_PLATAFORMA = /^[a-z][a-z0-9_]{1,47}$/;
const PADRAO_DA_DATA = /^\d{4}-\d{2}-\d{2}$/;

export function dataIsoValida(texto: string): boolean {
  if (!PADRAO_DA_DATA.test(texto)) return false;
  const [ano, mes, dia] = texto.split('-').map(Number) as [number, number, number];
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

export const PADROES_DO_BANCO: readonly RegExp[] = [
  /(^|[^\p{L}\p{N}_])@[\p{L}\p{N}_.]{2,}/u,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/u,
  /\+55\s?\(?[0-9]{2}\)?\s?9?[0-9]{4}[-\s]?[0-9]{4}/,
  /\([0-9]{2}\)\s?9?[0-9]{4}[-\s]?[0-9]{4}/,
  /(^|[^0-9])[0-9]{2}\s9?[0-9]{4}-[0-9]{4}([^0-9]|$)/,
  /(^|[^0-9])[1-9][0-9]9[0-9]{8}([^0-9]|$)/,
  /[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}/,
];

export function mencionaPessoa(texto: string): boolean {
  return PADRAO_DE_HANDLE.test(texto) || PADROES_DO_BANCO.some((padrao) => padrao.test(texto)) || procurarPii(texto).length > 0;
}

function decodificarUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

export const normalizarTexto = (texto: string): string => texto.normalize('NFC').replace(/\s+/g, ' ').trim();

const dataDoSinal = z.string().refine(dataIsoValida, 'Use uma data válida (AAAA-MM-DD).');
const textoDoSinal = (rotulo: string, maximo: number) =>
  z
    .string()
    .transform(normalizarTexto)
    .pipe(
      z
        .string()
        .min(1, `Informe ${rotulo}.`)
        .max(maximo, `${rotulo} passa de ${maximo} caracteres.`)
        .refine((texto) => !mencionaPessoa(texto), 'O sinal descreve um fenômeno público: sem @perfil, e-mail, telefone ou CPF.'),
    );

export const esquemaDoSinal = z
  .object({
    tipo: z.enum(TIPOS_DE_SINAL, { message: 'Escolha o tipo do sinal.' }),
    titulo: textoDoSinal('o título', LIMITES_DO_SINAL.titulo),
    resumo: textoDoSinal('o resumo', LIMITES_DO_SINAL.resumo),
    fonteNome: textoDoSinal('o nome da fonte', LIMITES_DO_SINAL.fonteNome),
    fonteUrl: z.string().max(LIMITES_DO_SINAL.fonteUrl, 'URL longa demais.'),
    plataforma: z.union([z.string().regex(PADRAO_DA_PLATAFORMA, 'Plataforma inválida.'), z.null(), z.literal('')]).optional(),
    observadoEm: dataDoSinal,
    validoAte: dataDoSinal,
    nota: z.enum(NOTAS_DE_EVIDENCIA, { message: 'Escolha a nota da evidência (A a D).' }),
  })
  .strict();

export const esquemaDoLoteDeSinais = z
  .object({ sinais: z.array(z.unknown()).min(1, 'Envie ao menos um sinal.').max(LIMITES_DO_SINAL.tamanhoDoLote, `Até ${LIMITES_DO_SINAL.tamanhoDoLote} sinais por lote.`) })
  .strict();

function detalhesDoZod(erro: z.ZodError, prefixo = ''): Record<string, string> {
  return Object.fromEntries(erro.issues.map((item) => [`${prefixo}${item.path.join('.') || '(raiz)'}`, item.message]));
}

export function validarJanela(sinal: { readonly observadoEm: string; readonly validoAte: string }, hoje: string): Record<string, string> {
  const problemas: Record<string, string> = {};
  if (sinal.validoAte < sinal.observadoEm) problemas['validoAte'] = 'A validade não pode ser anterior à observação.';
  else if (diasEntre(sinal.observadoEm, sinal.validoAte) - 1 > LIMITES_DO_SINAL.diasDeValidade) {
    problemas['validoAte'] = `A validade passa de ${LIMITES_DO_SINAL.diasDeValidade} dias da observação.`;
  }
  if (sinal.observadoEm > somarDias(hoje, 1)) problemas['observadoEm'] = 'A observação não pode estar no futuro.';
  if (sinal.validoAte < hoje) problemas['validoAte'] = 'O sinal já nasceria vencido: ajuste a validade.';
  return problemas;
}

export function normalizarSinal(bruto: unknown, agora: Date, prefixo = ''): Result<NovoSinalDeCultura, Failure> {
  const analise = esquemaDoSinal.safeParse(bruto);
  if (!analise.success) return err(failure('validation', 'Sinal inválido.', detalhesDoZod(analise.error, prefixo)));
  const dados = analise.data;
  const url = validarUrlDeDestino(dados.fonteUrl);
  if (!url.ok) return err(failure('validation', 'Sinal inválido.', { [`${prefixo}fonteUrl`]: url.error.message }));
  if (mencionaPessoa(decodificarUrl(url.value))) {
    return err(failure('validation', 'Sinal inválido.', { [`${prefixo}fonteUrl`]: 'A fonte descreve um fenômeno público: a URL não pode apontar para perfil ou pessoa.' }));
  }
  const janela = validarJanela(dados, hojeEmSaoPaulo(agora));
  if (Object.keys(janela).length > 0) {
    return err(failure('validation', 'Sinal inválido.', Object.fromEntries(Object.entries(janela).map(([campo, mensagem]) => [`${prefixo}${campo}`, mensagem]))));
  }
  return ok({
    tipo: dados.tipo,
    titulo: dados.titulo,
    resumo: dados.resumo,
    fonteUrl: url.value,
    fonteNome: dados.fonteNome,
    plataforma: dados.plataforma ? dados.plataforma : null,
    observadoEm: dados.observadoEm,
    validoAte: dados.validoAte,
    nota: dados.nota,
  });
}

export function normalizarLote(bruto: unknown, agora: Date): Result<readonly NovoSinalDeCultura[], Failure> {
  const lote = esquemaDoLoteDeSinais.safeParse(bruto);
  if (!lote.success) return err(failure('validation', 'Lote inválido.', detalhesDoZod(lote.error)));
  const normalizados: NovoSinalDeCultura[] = [];
  const detalhes: Record<string, string> = {};
  lote.data.sinais.forEach((item, indice) => {
    const resultado = normalizarSinal(item, agora, `sinais.${indice}.`);
    if (resultado.ok) normalizados.push(resultado.value);
    else Object.assign(detalhes, resultado.error.details ?? {});
  });
  if (Object.keys(detalhes).length > 0) return err(failure('validation', 'Lote inválido.', detalhes));
  return ok(normalizados);
}

export function chaveDeIdempotencia(sinal: Pick<NovoSinalDeCultura, 'fonteUrl' | 'observadoEm'>): string {
  return `${sinal.fonteUrl.toLowerCase()}|${sinal.observadoEm}`;
}

export function semRepetidosNoLote(sinais: readonly NovoSinalDeCultura[]): readonly NovoSinalDeCultura[] {
  const vistos = new Map<string, NovoSinalDeCultura>();
  for (const sinal of sinais) if (!vistos.has(chaveDeIdempotencia(sinal))) vistos.set(chaveDeIdempotencia(sinal), sinal);
  return [...vistos.values()];
}

export const estaVigente = (sinal: Pick<SinalDeCultura, 'validoAte'>, hoje: string): boolean => sinal.validoAte >= hoje;

export const vigentes = <T extends Pick<SinalDeCultura, 'validoAte'>>(sinais: readonly T[], hoje: string): readonly T[] =>
  sinais.filter((sinal) => estaVigente(sinal, hoje));

export const radarSemSinalVigente = (sinais: readonly Pick<SinalDeCultura, 'validoAte'>[], hoje: string): boolean =>
  vigentes(sinais, hoje).length === 0;

export const notaSustentaAfirmacao = (nota: SinalDeCultura['nota']): boolean => nota !== 'D';

export const diasParaVencer = (sinal: Pick<SinalDeCultura, 'validoAte'>, hoje: string): number => diasEntre(hoje, sinal.validoAte) - 1;

export class SinalRecusadoPeloBanco extends Error {
  readonly indice: number;

  constructor(indice: number) {
    super('sinal_recusado_pelo_banco');
    this.indice = indice;
  }
}
