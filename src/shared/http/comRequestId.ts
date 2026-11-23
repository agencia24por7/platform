import { logger } from '../logging/logger.ts';
import { CABECALHO_DO_REQUEST_ID } from './requestId.ts';

type LogDeErro = { error(mensagem: string, contexto?: Record<string, unknown>): void };

const MENSAGEM_DE_FALHA = 'Falha inesperada ao processar o pedido.';

export async function comRequestId<R extends Response>(id: string, resposta: Promise<R>, log: LogDeErro = logger): Promise<Response> {
  let pronta: Response;
  try {
    pronta = await resposta;
  } catch (erro) {
    log.error('http.falha_inesperada', { requestId: id, erro: erro instanceof Error ? erro.name : 'desconhecido' });
    pronta = Response.json({ ok: false, erro: MENSAGEM_DE_FALHA }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  pronta.headers.set(CABECALHO_DO_REQUEST_ID, id);
  return pronta;
}
