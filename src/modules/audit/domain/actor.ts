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
