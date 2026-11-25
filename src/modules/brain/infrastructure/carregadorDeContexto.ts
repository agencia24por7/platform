import type { Result } from '@/shared/result/result';
import {
  CARREGADOR_DE_CONTEXTO_INDISPONIVEL,
  type CarregadorDeContexto,
  type ContextoParaCatalogo,
  type EscopoDoContexto,
  type VisaoDoContexto,
} from '../domain/contexto.ts';

export type ServicoDeContextoCompativel = {
  carregarNaVisao(escopo: EscopoDoContexto, visao: VisaoDoContexto): Promise<Result<ContextoParaCatalogo, unknown>>;
};

export function carregadorDoServicoDeContexto(servico: ServicoDeContextoCompativel | null | undefined): CarregadorDeContexto {
  if (!servico) return CARREGADOR_DE_CONTEXTO_INDISPONIVEL;
  return {
    disponivel: true,
    async carregar(escopo, visao) {
      const resultado = await servico.carregarNaVisao(escopo, visao);
      return resultado.ok ? resultado.value : null;
    },
  };
}
