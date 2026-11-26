import { enderecoDoPedido, type CabecalhosDoPedido } from '@/modules/audit/domain/actor';
import { criarAvisoLimitado } from '@/shared/logging/avisoLimitado';
import { logger } from '@/shared/logging/logger';

const avisarProducaoSemSegredo = criarAvisoLimitado({
  janelaMs: 60_000,
  emitir: (contexto) => logger.warn('proxy.segredo_de_borda_ausente', contexto),
});

export function enderecoDoCliente(cabecalhos: CabecalhosDoPedido): string | null {
  const segredo = process.env.TRIA_PROXY_SECRET?.trim() || undefined;
  const producao = process.env.NODE_ENV === 'production';
  if (!segredo && producao) avisarProducaoSemSegredo();
  return enderecoDoPedido(cabecalhos, { segredo, producao });
}
