import { z } from 'zod';
import { hashEstavel } from './jsonEstavel.ts';
import { PADRAO_DO_ID, PADRAO_DO_TIPO, lerUrn } from './urn.ts';

export const VERSAO_DO_ESQUEMA_DO_CATALOGO = 1;

export const TIPOS_NATIVOS = [
  'conexao',
  'fonte',
  'tabela_de_dados',
  'contexto_secao',
  'contexto_lista',
  'arquivo',
  'capacidade',
] as const;

export const NIVEIS_DE_SENSIBILIDADE = ['publico', 'negocio', 'pessoal_possivel', 'restrito'] as const;
export const USOS_POR_AGENTE = ['permitido', 'restrito', 'negado'] as const;
export const STATUS_DE_FRESCOR = ['fresco', 'atrasado', 'parado', 'desconhecido'] as const;
export const FONTES_DA_MEDIDA = ['coletas', 'gov_cobertura_cliente', 'contexto', 'nao_se_aplica'] as const;
export const MARCAS_EPISTEMICAS = ['fato', 'hipotese', 'desejo', 'misto'] as const;
export const REVISOES = ['confirmado', 'sugerido', 'misto'] as const;

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const momentoIso = z.string().datetime({ offset: true });
const tipoDeEntrada = z.string().regex(PADRAO_DO_TIPO);
const texto = (max: number) => z.string().min(1).max(max);

export const colunaDoEsquema = z.object({
  nome: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/),
  tipo: texto(40),
  significado: texto(400),
  unidade: z.string().max(40).nullable(),
  anulavel: z.boolean(),
});

export const esquemaDaEntrada = z.object({
  colunas: z.array(colunaDoEsquema).max(400),
});

export const lacuna = z.object({ de: dataIso, ate: dataIso, dias: z.number().int().min(1) });

export const cobertura = z.object({
  desde: dataIso.nullable(),
  ate: dataIso.nullable(),
  linhas: z.number().int().min(0).nullable(),
  diasComDado: z.number().int().min(0).nullable(),
  diasEsperados: z.number().int().min(0).nullable(),
  lacunas: z.array(lacuna).max(20),
  diasFaltando: z.number().int().min(0).nullable(),
  fonteDaMedida: z.enum(FONTES_DA_MEDIDA),
  medidoEm: momentoIso.nullable(),
});

export const frescor = z.object({
  ultimaAtualizacao: momentoIso.nullable(),
  dadoAte: dataIso.nullable(),
  esperadoAte: dataIso.nullable(),
  cadenciaEsperada: texto(40),
  status: z.enum(STATUS_DE_FRESCOR),
});

export const qualidade = z.object({
  completude: z.number().min(0).max(1).nullable(),
  avisos: z.array(texto(300)).max(30),
});

export const exemploDeConsulta = z.object({
  descricao: texto(200),
  sql: texto(4000),
  parametros: z.record(z.string(), z.string()),
});

export const acessoBigQuery = z.object({
  tipo: z.literal('bigquery'),
  objeto: z.string().regex(/^[a-z][a-z0-9_]*$/),
  conjuntoDeDados: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  filtros: z.record(z.string(), z.string()),
  colunaDeData: z.string().nullable(),
  colunas: z.array(z.string()).max(400),
  exemplosDeConsulta: z.array(exemploDeConsulta).max(5),
  custoEstimado: z.object({ bytesMaximosPorConsulta: z.number().int().min(0), observacao: texto(300) }),
});

export const acessoContexto = z.object({
  tipo: z.literal('contexto'),
  caminho: z.string().nullable(),
  secao: z.string(),
  chaves: z.array(z.string()).max(200),
  formato: texto(40),
});

export const acessoArquivo = z.object({
  tipo: z.literal('arquivo'),
  caminho: z.string().nullable(),
  mime: texto(120),
  tamanhoBytes: z.number().int().min(0),
});

export const acessoStatus = z.object({ tipo: z.literal('status') });
export const acessoDerivado = z.object({ tipo: z.literal('derivado'), de: z.array(z.string()).max(200) });
export const acessoRestrito = z.object({ tipo: z.literal('restrito'), motivo: texto(200) });
export const acessoExterno = z.object({ tipo: z.literal('externo'), sistema: texto(60), instrucoes: texto(500) });

export const acesso = z.discriminatedUnion('tipo', [
  acessoBigQuery,
  acessoContexto,
  acessoArquivo,
  acessoStatus,
  acessoDerivado,
  acessoRestrito,
  acessoExterno,
]);

export const sensibilidade = z.object({
  nivel: z.enum(NIVEIS_DE_SENSIBILIDADE),
  piiPossivel: z.boolean(),
  usoPorAgente: z.enum(USOS_POR_AGENTE),
  retencao: texto(200),
});

export const epistemico = z.object({
  marca: z.enum(MARCAS_EPISTEMICAS),
  fonte: z.string().max(40).nullable(),
  revisao: z.enum(REVISOES),
  sugestoesPendentes: z.number().int().min(0),
});

export const relacao = z.object({
  tipo: z.string().regex(PADRAO_DO_TIPO),
  urn: z.string().refine((valor) => lerUrn(valor) !== null, 'urn inválida'),
});

export const referencia = z.object({
  sistema: texto(40),
  local: texto(400),
});

export const entradaSemSelo = z.object({
  urn: z.string().refine((valor) => lerUrn(valor) !== null, 'urn inválida'),
  tipo: tipoDeEntrada,
  id: z.string().regex(PADRAO_DO_ID),
  titulo: texto(160),
  descricao: texto(600),
  provedor: z.string().regex(PADRAO_DO_TIPO),
  plataforma: z.string().regex(PADRAO_DO_TIPO).nullable(),
  referencia,
  esquema: esquemaDaEntrada.nullable(),
  grao: z.array(z.string()).max(20).nullable(),
  cobertura: cobertura.nullable(),
  frescor: frescor.nullable(),
  qualidade,
  acesso,
  sensibilidade,
  epistemico: epistemico.nullable(),
  valorResumido: z.string().max(600).nullable(),
  tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9_:-]{0,47}$/)).max(30),
  relacoes: z.array(relacao).max(200),
  versao: z.number().int().min(1),
});

export const entradaDoCatalogo = entradaSemSelo.extend({
  schemaVersion: z.literal(VERSAO_DO_ESQUEMA_DO_CATALOGO),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ColunaDoEsquema = z.infer<typeof colunaDoEsquema>;
export type Cobertura = z.infer<typeof cobertura>;
export type Frescor = z.infer<typeof frescor>;
export type StatusDeFrescor = Frescor['status'];
export type Acesso = z.infer<typeof acesso>;
export type AcessoBigQuery = z.infer<typeof acessoBigQuery>;
export type Sensibilidade = z.infer<typeof sensibilidade>;
export type Epistemico = z.infer<typeof epistemico>;
export type Relacao = z.infer<typeof relacao>;
export type EntradaSemSelo = z.infer<typeof entradaSemSelo>;
export type EntradaDoCatalogo = z.infer<typeof entradaDoCatalogo>;

export function selar(entrada: EntradaSemSelo): EntradaDoCatalogo {
  const ordenada: EntradaSemSelo = {
    ...entrada,
    tags: [...new Set(entrada.tags)].sort(),
    relacoes: [...new Map(entrada.relacoes.map((r) => [`${r.tipo}|${r.urn}`, r])).values()].sort((a, b) =>
      `${a.tipo}|${a.urn}`.localeCompare(`${b.tipo}|${b.urn}`),
    ),
  };
  return { ...ordenada, schemaVersion: VERSAO_DO_ESQUEMA_DO_CATALOGO, hash: hashEstavel(ordenada) };
}

export function hashDaEntrada(entrada: EntradaDoCatalogo): string {
  const { hash: _hash, schemaVersion: _versao, ...resto } = entrada;
  return hashEstavel(resto);
}
