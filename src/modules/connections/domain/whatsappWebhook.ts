import { createHmac, timingSafeEqual } from 'node:crypto';

export function assinaturaDaMetaValida(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const esperada = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const recebida = header.slice('sha256='.length);
  const bufferEsperado = Buffer.from(esperada, 'hex');
  const bufferRecebido = Buffer.from(recebida, 'hex');
  if (bufferEsperado.length !== bufferRecebido.length) return false;
  return timingSafeEqual(bufferEsperado, bufferRecebido);
}

export function referenciaExternaDoWhatsapp(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const entry = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const primeiro = entry[0] as { id?: unknown; changes?: unknown };

  const changes = primeiro.changes;
  if (Array.isArray(changes) && changes.length > 0) {
    const metadata = (changes[0] as { value?: { metadata?: { phone_number_id?: unknown } } }).value
      ?.metadata;
    if (typeof metadata?.phone_number_id === 'string') return metadata.phone_number_id;
  }

  return typeof primeiro.id === 'string' ? primeiro.id : null;
}
