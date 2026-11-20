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

type Objeto = Record<string, unknown>;

const objeto = (valor: unknown): Objeto | null =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Objeto) : null;

const lista = (valor: unknown): unknown[] => (Array.isArray(valor) ? valor : []);

const texto = (valor: unknown): string | null =>
  typeof valor === 'string' || typeof valor === 'number' ? String(valor) : null;

function pseudonimo(telefone: unknown, chave: string): string | null {
  const numero = texto(telefone)?.replace(/\D/g, '');
  return numero ? createHmac('sha256', chave).update(numero).digest('hex').slice(0, 32) : null;
}

function origemDoAnuncio(referencia: unknown): Objeto | null {
  const r = objeto(referencia);
  if (!r) return null;
  return {
    ctwaClid: texto(r['ctwa_clid'] ?? r['ctwaClid']),
    sourceId: texto(r['source_id'] ?? r['sourceId']),
    sourceType: texto(r['source_type'] ?? r['sourceType']),
    sourceUrl: texto(r['source_url'] ?? r['sourceUrl']),
  };
}

function resumoDaCloudApi(payload: Objeto, chave: string): Objeto {
  const mensagens = lista(payload['entry']).flatMap((entrada) =>
    lista(objeto(entrada)?.['changes']).flatMap((mudanca) =>
      lista(objeto(objeto(mudanca)?.['value'])?.['messages']).map((bruta) => {
        const m = objeto(bruta) ?? {};
        return {
          id: texto(m['id']),
          momento: texto(m['timestamp']),
          tipo: texto(m['type']),
          contato: pseudonimo(m['from'], chave),
          anuncio: origemDoAnuncio(m['referral']),
        };
      }),
    ),
  );
  return { formato: 'cloud_api', mensagens };
}

function resumoDaZapi(payload: Objeto, chave: string): Objeto {
  const anuncio = objeto(payload['externalAdReply']) ?? objeto(objeto(payload['referral'])) ?? null;
  return {
    formato: 'zapi',
    mensagens: [
      {
        id: texto(payload['messageId']),
        momento: texto(payload['momment'] ?? payload['moment']),
        tipo: texto(payload['type']),
        deMim: payload['fromMe'] === true,
        grupo: payload['isGroup'] === true,
        contato: pseudonimo(payload['phone'], chave),
        anuncio: origemDoAnuncio(anuncio),
      },
    ],
  };
}

export function resumirAvisoDoWhatsapp(payload: unknown, chaveDoPseudonimo: string): Objeto {
  const corpo = objeto(payload);
  if (!corpo) return { formato: 'desconhecido', mensagens: [] };
  return Array.isArray(corpo['entry']) ? resumoDaCloudApi(corpo, chaveDoPseudonimo) : resumoDaZapi(corpo, chaveDoPseudonimo);
}
