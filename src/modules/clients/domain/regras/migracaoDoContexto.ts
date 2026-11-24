import type { Categoria } from './categoria.ts';
import type { Forca } from './forca.ts';

export const CAMPOS_MIGRADOS = [
  'orcamento_mensal_total',
  'regras_regulatorias',
  'o_que_nao_pode_ser_dito',
  'quem_aprova',
  'prazo_de_aprovacao',
] as const;
export type CampoMigrado = (typeof CAMPOS_MIGRADOS)[number];

export const REVIEW_FLAG_CONVERTER_EM_LIMITE = 'revisar_e_converter_em_limite';

const MAXIMO_EM_CENTAVOS = 100_000_000_000;
const MAXIMO_DO_TEXTO = 4000;
const FUSO = 'America/Sao_Paulo';

type PlanoDoCampo =
  | { readonly natureza: 'limite'; readonly chave: 'investimento.teto_mensal'; readonly titulo: string }
  | {
      readonly natureza: 'regra';
      readonly categoria: Categoria;
      readonly chave: string;
      readonly titulo: string;
      readonly forca: Forca;
    };

const PLANO: Record<CampoMigrado, PlanoDoCampo> = {
  orcamento_mensal_total: {
    natureza: 'limite',
    chave: 'investimento.teto_mensal',
    titulo: 'Teto de investimento mensal (migrado do Contexto)',
  },
  regras_regulatorias: {
    natureza: 'regra',
    categoria: 'segmento',
    chave: 'segmento.regras_regulatorias',
    titulo: 'Regras jurídicas ou regulatórias (migrado do Contexto)',
    forca: 'dura',
  },
  o_que_nao_pode_ser_dito: {
    natureza: 'regra',
    categoria: 'etica_marca',
    chave: 'etica_marca.o_que_nao_pode_ser_dito',
    titulo: 'O que não pode ser dito (migrado do Contexto)',
    forca: 'dura',
  },
  quem_aprova: {
    natureza: 'regra',
    categoria: 'governanca',
    chave: 'governanca.quem_aprova',
    titulo: 'Quem aprova as peças (migrado do Contexto)',
    forca: 'orientacao',
  },
  prazo_de_aprovacao: {
    natureza: 'regra',
    categoria: 'governanca',
    chave: 'governanca.prazo_de_aprovacao',
    titulo: 'Prazo de aprovação (migrado do Contexto)',
    forca: 'orientacao',
  },
};

export type LinhaDoContexto = {
  readonly fieldKey: string;
  readonly valor: unknown;
  readonly source: string;
  readonly review: string;
  readonly updatedBy: string | null;
  readonly updatedAt: Date;
};

export type DecisaoMigrada = {
  readonly campo: CampoMigrado;
  readonly categoria: Categoria;
  readonly natureza: 'limite' | 'regra';
  readonly origem: 'agencia';
  readonly forca: Forca;
  readonly chave: string;
  readonly escopo: 'cliente';
  readonly titulo: string;
  readonly contexto: string;
  readonly texto: string | null;
  readonly valor: { readonly valor: string; readonly unidade: 'brl_centavos' } | null;
  readonly vigenciaInicio: string;
  readonly criadaEm: Date;
  readonly decididoPor: string;
  readonly evidencia: string;
  readonly definicaoChave: string | null;
  readonly definicaoVersao: number | null;
  readonly reviewFlag: typeof REVIEW_FLAG_CONVERTER_EM_LIMITE | null;
};

export type ResultadoDoMapeamento =
  | { readonly ok: true; readonly decisao: DecisaoMigrada }
  | { readonly ok: false; readonly motivo: string };

export function ehCampoMigrado(chave: string): chave is CampoMigrado {
  return (CAMPOS_MIGRADOS as readonly string[]).includes(chave);
}

export const MOTIVO_SEM_AUTOR = 'ignorada_sem_autor';

const INFORMADO_PELO_CLIENTE = 'informado pelo cliente';

export function marcaDaMigracao(campo: CampoMigrado, fonte: string): string {
  return fonte === 'cliente'
    ? `Migrado do Contexto (campo ${campo}; ${INFORMADO_PELO_CLIENTE})`
    : `Migrado do Contexto (campo ${campo})`;
}

export function dataLocal(instante: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

function centavosDe(valor: unknown): string | null {
  if (typeof valor === 'number') {
    return Number.isSafeInteger(valor) && valor >= 0 && valor <= MAXIMO_EM_CENTAVOS ? String(valor) : null;
  }
  if (typeof valor === 'string' && /^[0-9]{1,12}$/.test(valor)) {
    return Number(valor) <= MAXIMO_EM_CENTAVOS ? String(Number(valor)) : null;
  }
  return null;
}

function contextoDaMigracao(linha: LinhaDoContexto, autor: string): string {
  const fonte = linha.source === 'cliente' ? `${INFORMADO_PELO_CLIENTE}, confirmado pela agência` : `fonte original: ${linha.source}`;
  return (
    `Migrado do Contexto (campo ${linha.fieldKey}, catálogo versão 1). ` +
    `Registrado originalmente em ${dataLocal(linha.updatedAt)} por usuário ${autor}; ${fonte}.`
  );
}

export function mapearLinhaDoContexto(linha: LinhaDoContexto): ResultadoDoMapeamento {
  if (!ehCampoMigrado(linha.fieldKey)) return { ok: false, motivo: 'campo_fora_da_migracao' };
  if (linha.review !== 'confirmado') return { ok: false, motivo: 'sugestao_nao_confirmada' };
  if (!linha.updatedBy) return { ok: false, motivo: MOTIVO_SEM_AUTOR };

  const plano = PLANO[linha.fieldKey];
  const base = {
    campo: linha.fieldKey,
    origem: 'agencia' as const,
    escopo: 'cliente' as const,
    titulo: plano.titulo,
    contexto: contextoDaMigracao(linha, linha.updatedBy),
    vigenciaInicio: dataLocal(linha.updatedAt),
    criadaEm: linha.updatedAt,
    decididoPor: linha.updatedBy,
    evidencia: marcaDaMigracao(linha.fieldKey, linha.source),
  };

  if (plano.natureza === 'limite') {
    const centavos = centavosDe(linha.valor);
    if (centavos === null) return { ok: false, motivo: 'valor_de_dinheiro_invalido' };
    return {
      ok: true,
      decisao: {
        ...base,
        categoria: 'investimento',
        natureza: 'limite',
        forca: 'dura',
        chave: plano.chave,
        texto: null,
        valor: { valor: centavos, unidade: 'brl_centavos' },
        definicaoChave: plano.chave,
        definicaoVersao: 1,
        reviewFlag: null,
      },
    };
  }

  if (typeof linha.valor !== 'string') return { ok: false, motivo: 'texto_invalido' };
  const texto = linha.valor.trim();
  if (texto === '') return { ok: false, motivo: 'texto_vazio' };
  if (texto.length > MAXIMO_DO_TEXTO) return { ok: false, motivo: 'texto_acima_do_limite' };

  return {
    ok: true,
    decisao: {
      ...base,
      categoria: plano.categoria,
      natureza: 'regra',
      forca: plano.forca,
      chave: plano.chave,
      texto,
      valor: null,
      definicaoChave: null,
      definicaoVersao: null,
      reviewFlag: /\d/.test(texto) ? REVIEW_FLAG_CONVERTER_EM_LIMITE : null,
    },
  };
}
