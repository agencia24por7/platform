import { z } from 'zod';
import { CATEGORIAS, FORCAS, LIMITES_DE_TAMANHO, type Unidade } from '@/modules/clients/domain/regras/index';
import { chaveDaRegra, valorDoCampo } from '@/modules/clients/domain/painel/regras';
import type {
  EntradaDeDecisaoDeProposta,
  EntradaDeRegistro,
  EntradaDeRevogacao,
  EntradaDeSuperacao,
} from '@/modules/clients/application/regrasEntradas';
import { err, ok, type Result } from '@/shared/result/result';

export type CamposBrutos = Readonly<Record<string, string>>;
export type ErrosDoFormulario = Readonly<Record<string, string>>;

export type DefinicaoDoFormulario = {
  readonly key: string;
  readonly nome: string;
  readonly categoria: 'investimento' | 'eficiencia';
  readonly unidade: Unidade;
  readonly ativo: boolean;
  readonly tiposDeEscopo: readonly ('cliente' | 'plataforma')[];
};

const MENSAGEM_DE_VALOR: Readonly<Record<Unidade, string>> = {
  brl_centavos: 'Informe o valor em reais, por exemplo 10.000,00.',
  razao: 'Informe um número, por exemplo 3,5.',
  percentual: 'Informe um percentual, por exemplo 25,5.',
};

const vazioParaNulo = (bruto: string | undefined): string | undefined => {
  const texto = bruto?.trim();
  return texto ? texto : undefined;
};

const textoCurto = (maximo: number, mensagem: string) => z.string().trim().max(maximo, mensagem);

const dataOpcional = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use uma data válida.')
  .optional();

const Comum = {
  forca: z.enum(FORCAS, { message: 'Escolha entre bloqueia e orienta.' }).optional(),
  evidencia: textoCurto(LIMITES_DE_TAMANHO.evidencia, 'A evidência é longa demais.').optional(),
  emNomeDe: textoCurto(LIMITES_DE_TAMANHO.identificador, 'O nome é longo demais.').optional(),
  vigenciaInicio: dataOpcional,
  vigenciaFim: dataOpcional,
};

const Registro = z.object({
  natureza: z.enum(['limite', 'regra', 'decisao'], { message: 'Escolha o tipo.' }),
  categoria: z.enum(CATEGORIAS, { message: 'Escolha a categoria.' }).optional(),
  definicao: z.string().trim().optional(),
  escopo: z.string().trim().optional(),
  valor: z.string().trim().optional(),
  titulo: textoCurto(LIMITES_DE_TAMANHO.titulo, 'O título passa de 120 caracteres.').optional(),
  texto: textoCurto(LIMITES_DE_TAMANHO.texto, 'O texto é longo demais.').optional(),
  contexto: textoCurto(LIMITES_DE_TAMANHO.contexto, 'O contexto é longo demais.').optional(),
  ...Comum,
});

const Alteracao = z.object({
  decisaoId: z.string().uuid('Decisão inválida.'),
  motivo: z.string().trim().min(3, 'Explique o porquê da mudança (mínimo 3 caracteres).').max(LIMITES_DE_TAMANHO.motivo, 'O motivo é longo demais.'),
  valor: z.string().trim().optional(),
  titulo: textoCurto(LIMITES_DE_TAMANHO.titulo, 'O título passa de 120 caracteres.').optional(),
  texto: textoCurto(LIMITES_DE_TAMANHO.texto, 'O texto é longo demais.').optional(),
  ...Comum,
});

const Revogacao = z.object({
  decisaoId: z.string().uuid('Decisão inválida.'),
  motivo: z.string().trim().min(3, 'Explique o motivo (mínimo 3 caracteres).').max(LIMITES_DE_TAMANHO.motivo, 'O motivo é longo demais.'),
});

const Proposta = z.object({
  decisaoId: z.string().uuid('Decisão inválida.'),
  motivo: z.string().trim().max(LIMITES_DE_TAMANHO.motivo, 'O motivo é longo demais.').optional(),
});

function limpar(campos: CamposBrutos): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(campos).map(([chave, valor]) => [chave, vazioParaNulo(valor)]));
}

function errosDoZod(erro: z.ZodError): ErrosDoFormulario {
  const erros: Record<string, string> = {};
  for (const problema of erro.issues) {
    erros[String(problema.path[0] ?? 'formulario')] ??= problema.message;
  }
  return erros;
}

export function lerRegistro(campos: CamposBrutos, definicoes: readonly DefinicaoDoFormulario[]): Result<EntradaDeRegistro, ErrosDoFormulario> {
  const parse = Registro.safeParse(limpar(campos));
  if (!parse.success) return err(errosDoZod(parse.error));
  const dados = parse.data;
  const escopo = dados.escopo ?? 'cliente';
  const comum = {
    forca: dados.forca,
    evidencia: dados.evidencia ?? null,
    emNomeDe: dados.emNomeDe ?? null,
    vigenciaInicio: dados.vigenciaInicio ?? null,
    vigenciaFim: dados.vigenciaFim ?? null,
    contexto: dados.contexto ?? null,
    escopo,
  };

  if (dados.natureza === 'limite') {
    const definicao = definicoes.find((d) => d.key === dados.definicao && d.ativo);
    if (!definicao) return err({ definicao: 'Escolha um tipo de limite disponível.' });
    const tipoDoEscopo = escopo === 'cliente' ? 'cliente' : 'plataforma';
    if (!definicao.tiposDeEscopo.includes(tipoDoEscopo)) return err({ escopo: 'Este limite não vale para o escopo escolhido.' });
    const valor = valorDoCampo(definicao.unidade, dados.valor ?? '');
    if (valor === null) return err({ valor: MENSAGEM_DE_VALOR[definicao.unidade] });
    return ok({
      ...comum,
      natureza: 'limite',
      categoria: definicao.categoria,
      chave: definicao.key,
      titulo: dados.titulo ?? definicao.nome,
      texto: dados.texto ?? null,
      valor,
    });
  }

  if (!dados.titulo) return err({ titulo: 'Dê um título curto.' });
  if (dados.natureza === 'regra') {
    if (!dados.categoria) return err({ categoria: 'Escolha a categoria.' });
    if (dados.categoria === 'processo') return err({ categoria: 'Decisões de processo não são regras.' });
    if (!dados.texto) return err({ texto: 'Escreva a regra.' });
    const chave = chaveDaRegra(dados.categoria, dados.titulo);
    if (chave === null) return err({ titulo: 'Use letras ou números no título.' });
    return ok({ ...comum, natureza: 'regra', categoria: dados.categoria, chave, titulo: dados.titulo, texto: dados.texto, valor: null });
  }
  return ok({
    ...comum,
    natureza: 'decisao',
    categoria: 'processo',
    chave: null,
    titulo: dados.titulo,
    texto: dados.texto ?? null,
    valor: null,
  });
}

export function lerAlteracao(campos: CamposBrutos, unidadeDoLimite: Unidade | null): Result<EntradaDeSuperacao, ErrosDoFormulario> {
  const parse = Alteracao.safeParse(limpar(campos));
  if (!parse.success) return err(errosDoZod(parse.error));
  const dados = parse.data;
  let valor = null;
  if (unidadeDoLimite !== null) {
    valor = valorDoCampo(unidadeDoLimite, dados.valor ?? '');
    if (valor === null) return err({ valor: MENSAGEM_DE_VALOR[unidadeDoLimite] });
  }
  return ok({
    decisaoId: dados.decisaoId,
    motivo: dados.motivo,
    forca: dados.forca,
    titulo: dados.titulo ?? null,
    texto: dados.texto ?? null,
    valor,
    evidencia: dados.evidencia ?? null,
    emNomeDe: dados.emNomeDe ?? null,
    vigenciaInicio: dados.vigenciaInicio ?? null,
    vigenciaFim: dados.vigenciaFim ?? null,
  });
}

export function lerRevogacao(campos: CamposBrutos): Result<EntradaDeRevogacao, ErrosDoFormulario> {
  const parse = Revogacao.safeParse(limpar(campos));
  return parse.success ? ok(parse.data) : err(errosDoZod(parse.error));
}

export function lerDecisaoDeProposta(campos: CamposBrutos, motivoObrigatorio: boolean): Result<EntradaDeDecisaoDeProposta, ErrosDoFormulario> {
  const parse = (motivoObrigatorio ? Revogacao : Proposta).safeParse(limpar(campos));
  if (!parse.success) return err(errosDoZod(parse.error));
  return ok({ decisaoId: parse.data.decisaoId, motivo: parse.data.motivo ?? null });
}
