import type { Result } from '@/shared/result/result';
import {
  CARREGADOR_DE_REGRAS_INDISPONIVEL,
  LIMITE_DE_DECISOES_NO_CATALOGO,
  type CarregadorDeRegras,
  type DecisaoParaCatalogo,
  type DefinicaoParaCatalogo,
  type NaturezaDaRegra,
  type RegrasParaCatalogo,
  type StatusDaDecisao,
  type ValorDoLimite,
} from '../domain/regras.ts';

type DecisaoCompativel = {
  readonly id: string;
  readonly numero: number;
  readonly categoria: string;
  readonly natureza: NaturezaDaRegra;
  readonly origem: string;
  readonly forca: string;
  readonly chave: string | null;
  readonly escopo: string;
  readonly titulo: string;
  readonly contexto: string | null;
  readonly texto: string | null;
  readonly valor: ValorDoLimite | null;
  readonly vigenciaInicio: Date;
  readonly vigenciaFim: Date | null;
  readonly status: StatusDaDecisao;
  readonly supersedesId: string | null;
  readonly decididoPor: string | null;
  readonly emNomeDe: string | null;
  readonly semConfirmacaoDoAnunciante: boolean;
  readonly definicaoChave: string | null;
  readonly definicaoVersao: number | null;
  readonly revisarEConverterEmLimite: boolean;
  readonly criadoEm: Date;
};

type DefinicaoCompativel = {
  readonly key: string;
  readonly version: number;
  readonly nome: string;
  readonly categoria: string;
  readonly unidade: string;
  readonly periodo: string;
  readonly sentido: string;
  readonly escoposAceitos: readonly string[];
  readonly essencial: boolean;
  readonly ativo: boolean;
};

type Escopo = { readonly organizationId: string; readonly clientId: string };
type Falha = { readonly message?: string };

export type ServicoDeRegrasCompativel = {
  conjuntoParaAgente(escopo: Escopo): Promise<
    Result<
      {
        readonly decisoes: readonly DecisaoCompativel[];
        readonly conflitos: readonly DecisaoCompativel[];
        readonly definicoes: readonly DefinicaoCompativel[];
      },
      Falha
    >
  >;
  linhaDoTempo(
    escopo: Escopo,
    filtros: { readonly limite: number; readonly cursor?: number | null },
  ): Promise<Result<{ readonly itens: readonly DecisaoCompativel[]; readonly proximoCursor: number | null }, Falha>>;
};

const TAMANHO_DA_PAGINA = 100;

function definicaoDe(definicao: DefinicaoCompativel): DefinicaoParaCatalogo {
  return {
    chave: definicao.key,
    versao: definicao.version,
    nome: definicao.nome,
    categoria: definicao.categoria,
    unidade: definicao.unidade,
    periodo: definicao.periodo,
    sentido: definicao.sentido,
    escoposAceitos: definicao.escoposAceitos,
    essencial: definicao.essencial,
    ativo: definicao.ativo,
  };
}

export function decisoesParaCatalogo(
  decisoes: readonly DecisaoCompativel[],
  idsVigentes: ReadonlySet<string>,
): readonly DecisaoParaCatalogo[] {
  const numeroPorId = new Map(decisoes.map((d) => [d.id, d.numero]));
  const substituidaPor = new Map<number, number>();
  for (const decisao of decisoes) {
    const anterior = decisao.supersedesId ? numeroPorId.get(decisao.supersedesId) : undefined;
    if (anterior !== undefined) substituidaPor.set(anterior, decisao.numero);
  }
  return [...decisoes]
    .sort((a, b) => a.numero - b.numero)
    .map((d) => ({
      numero: d.numero,
      categoria: d.categoria,
      natureza: d.natureza,
      origem: d.origem,
      forca: d.forca,
      chave: d.chave,
      escopo: d.escopo,
      titulo: d.titulo,
      contexto: d.contexto,
      texto: d.texto,
      valor: d.valor,
      vigenciaInicio: d.vigenciaInicio.toISOString(),
      vigenciaFim: d.vigenciaFim ? d.vigenciaFim.toISOString() : null,
      status: d.status,
      vigente: idsVigentes.has(d.id),
      substituiNumero: d.supersedesId ? (numeroPorId.get(d.supersedesId) ?? null) : null,
      substituidaPorNumero: substituidaPor.get(d.numero) ?? null,
      definicaoChave: d.definicaoChave,
      definicaoVersao: d.definicaoVersao,
      registradaEmNomeDeTerceiro: d.emNomeDe !== null,
      decididaPorPessoa: d.decididoPor !== null,
      semConfirmacaoDoAnunciante: d.semConfirmacaoDoAnunciante,
      aRevisar: d.revisarEConverterEmLimite,
      criadaEm: d.criadoEm.toISOString(),
    }));
}

export function carregadorDoServicoDeRegras(servico: ServicoDeRegrasCompativel | null | undefined): CarregadorDeRegras {
  if (!servico) return CARREGADOR_DE_REGRAS_INDISPONIVEL;
  return {
    disponivel: true,
    async carregar(escopo): Promise<RegrasParaCatalogo | null> {
      const conjunto = await servico.conjuntoParaAgente(escopo);
      if (!conjunto.ok) return null;
      const todas = new Map<string, DecisaoCompativel>();
      let cursor: number | null = null;
      let truncado = false;
      do {
        const pagina: Awaited<ReturnType<ServicoDeRegrasCompativel['linhaDoTempo']>> = await servico.linhaDoTempo(escopo, {
          limite: TAMANHO_DA_PAGINA,
          cursor,
        });
        if (!pagina.ok) return null;
        for (const item of pagina.value.itens) todas.set(item.id, item);
        cursor = pagina.value.proximoCursor;
        if (cursor !== null && todas.size >= LIMITE_DE_DECISOES_NO_CATALOGO) {
          truncado = true;
          cursor = null;
        }
      } while (cursor !== null);
      for (const vigente of conjunto.value.decisoes) todas.set(vigente.id, vigente);
      const idsVigentes = new Set(conjunto.value.decisoes.map((d) => d.id));
      return {
        definicoes: conjunto.value.definicoes.map(definicaoDe),
        decisoes: decisoesParaCatalogo([...todas.values()], idsVigentes),
        conflitos: conjunto.value.conflitos.length,
        truncado,
      };
    },
  };
}
