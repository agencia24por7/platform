import { avaliarCapacidades, type AvaliacaoDeCapacidade, type DefinicaoDeCapacidade } from '../../domain/capacidades.ts';
import type { EntradaDoCatalogo, EntradaSemSelo } from '../../domain/entrada.ts';
import type { RegrasParaCatalogo } from '../../domain/regras.ts';
import { SAUDE_OK, type ContextoDeDescoberta, type ProvedorDeCatalogo } from '../../domain/provedor.ts';
import { DEFINICOES_DE_CAPACIDADES } from '../../dados/capacidades.ts';
import { plataformasDaTabela } from '../../dados/registro.ts';

const VERSAO = 1;
const ID = 'capacidades';

const ROTULO: Readonly<Record<AvaliacaoDeCapacidade['status'], string>> = {
  disponivel: 'Disponível',
  parcial: 'Parcial',
  indisponivel: 'Indisponível',
};

export function avaliar(
  entradas: readonly EntradaDoCatalogo[],
  agora: Date,
  definicoes: readonly DefinicaoDeCapacidade[] = DEFINICOES_DE_CAPACIDADES,
  regras: RegrasParaCatalogo | null = null,
): readonly AvaliacaoDeCapacidade[] {
  return avaliarCapacidades(definicoes, entradas, agora, plataformasDaTabela, regras);
}

function entradaDaCapacidade(ctx: ContextoDeDescoberta, avaliacao: AvaliacaoDeCapacidade, definicao: DefinicaoDeCapacidade): EntradaSemSelo {
  const atendidos = avaliacao.requisitos.filter((r) => r.status === 'atendido').length;
  return {
    urn: ctx.urn('capacidade', avaliacao.id),
    tipo: 'capacidade',
    id: avaliacao.id,
    titulo: `Capacidade: ${avaliacao.titulo}`,
    descricao: `${avaliacao.descricao} Exemplos: ${avaliacao.perguntas.join(' ')}`.slice(0, 600),
    provedor: ID,
    plataforma: null,
    referencia: { sistema: 'derivado', local: `src/modules/brain/dados/capacidades.ts#${avaliacao.id}` },
    esquema: null,
    grao: null,
    cobertura: null,
    frescor: null,
    qualidade: {
      completude: avaliacao.requisitos.length > 0 ? atendidos / avaliacao.requisitos.length : null,
      avisos: avaliacao.faltando.map((f) => f.slice(0, 300)).slice(0, 30),
    },
    acesso: { tipo: 'derivado', de: [...avaliacao.evidencias] },
    sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido', retencao: 'Recalculada a cada construção do catálogo.' },
    epistemico: null,
    valorResumido: ROTULO[avaliacao.status],
    tags: ['capacidade', `status:${avaliacao.status}`, ...definicao.tags],
    relacoes: avaliacao.evidencias.map((urn) => ({ tipo: 'evidencia', urn })),
    versao: VERSAO,
  };
}

export const provedorDeCapacidades: ProvedorDeCatalogo = {
  id: ID,
  versao: VERSAO,
  descricao: 'Capacidades derivadas: que perguntas os dados e o contexto do cliente conseguem responder, com evidências e o que falta.',
  fase: 'derivada',
  tiposDeclarados: ['capacidade'],
  descobrir(ctx) {
    const porId = new Map(DEFINICOES_DE_CAPACIDADES.map((d) => [d.id, d]));
    return avaliar(ctx.entradasPrimarias, ctx.agora, DEFINICOES_DE_CAPACIDADES, ctx.regras).map((avaliacao) => entradaDaCapacidade(ctx, avaliacao, porId.get(avaliacao.id)!));
  },
  saude: () => SAUDE_OK,
};
