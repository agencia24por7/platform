import { newRequestId } from '../security/tokens.ts';

export const CABECALHO_DO_REQUEST_ID = 'x-request-id';

const FORMATO_VALIDO = /^[A-Za-z0-9-]{8,64}$/;

export function resolverRequestId(entrante: string | null | undefined, gerar: () => string = newRequestId): string {
  if (entrante && FORMATO_VALIDO.test(entrante)) return entrante;
  return gerar();
}
