export class CorpoAcimaDoLimite extends Error {
  constructor() {
    super('corpo_acima_do_limite');
  }
}

export function declaradoAcimaDoLimite(contentLength: string | null, limite: number): boolean {
  if (contentLength === null || contentLength.trim() === '') return false;
  const declarado = Number(contentLength);
  return !Number.isFinite(declarado) || declarado < 0 || declarado > limite;
}

export async function lerCorpoLimitado(corpo: ReadableStream<Uint8Array> | null, limite: number): Promise<string> {
  if (!corpo) return '';
  const leitor = corpo.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => undefined);
      throw new CorpoAcimaDoLimite();
    }
    pedacos.push(value);
  }
  return Buffer.concat(pedacos).toString('utf8');
}
