const REDES_PRIVADAS: readonly RegExp[] = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i,
  /^fe80:/i,
];

const semPrefixoIpv4Mapeado = (endereco: string) => endereco.replace(/^::ffff:/i, '');

export function enderecoPrivado(endereco: string): boolean {
  const limpo = semPrefixoIpv4Mapeado(endereco.trim());
  return limpo.length > 0 && REDES_PRIVADAS.some((rede) => rede.test(limpo));
}

export type Cabecalhos = { get(nome: string): string | null };

export function veioDeFora(cabecalhos: Cabecalhos): boolean {
  if (cabecalhos.get('forwarded') !== null || cabecalhos.get('x-real-ip') !== null) return true;
  if ((cabecalhos.get('x-forwarded-proto') ?? '').toLowerCase().includes('https')) return true;
  const cadeia = cabecalhos.get('x-forwarded-for');
  if (cadeia === null) return false;
  const saltos = cadeia.split(',').map((salto) => salto.trim()).filter(Boolean);
  if (saltos.length !== 1) return true;
  return !enderecoPrivado(saltos[0]!);
}
