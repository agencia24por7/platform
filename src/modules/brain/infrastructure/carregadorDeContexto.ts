import type { Result } from '@/shared/result/result';
import {
  CARREGADOR_DE_CONTEXTO_INDISPONIVEL,
  type CarregadorDeContexto,
  type ContextoParaCatalogo,
  type EscopoDoContexto,
} from '../domain/contexto.ts';

export type ServicoDeContextoCompativel = {
  carregar(escopo: EscopoDoContexto): Promise<Result<ContextoParaCatalogo, unknown>>;
};

export function carregadorDoServicoDeContexto(servico: ServicoDeContextoCompativel | null | undefined): CarregadorDeContexto {
  if (!servico) return CARREGADOR_DE_CONTEXTO_INDISPONIVEL;
  return {
    disponivel: true,
    async carregar(escopo) {
      const resultado = await servico.carregar(escopo);
      return resultado.ok ? resultado.value : null;
    },
  };
}
