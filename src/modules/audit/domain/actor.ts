export type Ator = {
  readonly userId: string | null;
  readonly requestId: string;
  readonly sourceIp: string | null;
};

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

export function primeiroEndereco(encaminhado: string | null | undefined): string | null {
  if (!encaminhado) return null;

  const primeiro = encaminhado.split(',')[0]?.trim() ?? '';
  if (primeiro.length === 0 || primeiro.length > 45) return null;

  const semPorta = IPV4.test(primeiro.split(':')[0] ?? '') ? (primeiro.split(':')[0] ?? '') : primeiro;
  return /^[0-9a-f.:]+$/i.test(semPorta) ? semPorta : null;
}

export function enderecoConfiavel(encaminhado: string | null | undefined): string | null {
  if (!encaminhado) return null;

  const partes = encaminhado.split(',');
  const ultimo = partes[partes.length - 1]?.trim() ?? '';
  if (ultimo.length === 0 || ultimo.length > 45) return null;

  const semPorta = IPV4.test(ultimo.split(':')[0] ?? '') ? (ultimo.split(':')[0] ?? '') : ultimo;
  return /^[0-9a-f.:]+$/i.test(semPorta) ? semPorta : null;
}
