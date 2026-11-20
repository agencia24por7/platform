const PREFIXO_FRACO = 'W/';

function semPrefixoFraco(etag: string): string {
  return etag.startsWith(PREFIXO_FRACO) ? etag.slice(PREFIXO_FRACO.length) : etag;
}

export function etagCasa(cabecalho: string | null, etag: string): boolean {
  if (!cabecalho) return false;
  return cabecalho
    .split(',')
    .map((parte) => semPrefixoFraco(parte.trim()))
    .some((parte) => parte === etag || parte === '*');
}
