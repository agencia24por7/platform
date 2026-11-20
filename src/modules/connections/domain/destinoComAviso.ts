import { isSafeReturnPath } from './oauth.ts';

const ORIGEM_INTERNA = 'https://interno.invalid';
const DESTINO_PADRAO = '/integracoes';

export function destinoComAviso(destino: string, aviso: string): string {
  const seguro = isSafeReturnPath(destino) ? destino : DESTINO_PADRAO;
  const url = new URL(seguro, ORIGEM_INTERNA);
  url.searchParams.set('aviso', aviso);
  return `${url.pathname}${url.search}${url.hash}`;
}
