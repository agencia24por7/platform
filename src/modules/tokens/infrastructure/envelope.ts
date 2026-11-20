import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { aadDe } from '@/modules/tokens/domain/token';
import type { ChaveMestra, CifraDeTokens } from '@/modules/tokens/application/portas';

const VERSAO_DO_FORMATO = 1;
const TAMANHO_DO_IV = 12;
const TAMANHO_DA_ETIQUETA = 16;
const TAMANHO_DA_CHAVE_DE_DADOS = 32;
const ALGORITMO_LOCAL = 'aes-256-gcm';

export class EnvelopeInvalido extends Error {
  constructor() {
    super('Envelope de token inválido ou adulterado.');
  }
}

export function selar(chave: Buffer, texto: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(TAMANHO_DO_IV);
  const cifra = createCipheriv(ALGORITMO_LOCAL, chave, iv);
  cifra.setAAD(aad);
  const corpo = Buffer.concat([cifra.update(texto), cifra.final()]);
  return Buffer.concat([iv, cifra.getAuthTag(), corpo]);
}

export function abrir(chave: Buffer, selado: Buffer, aad: Buffer): Buffer {
  if (selado.length < TAMANHO_DO_IV + TAMANHO_DA_ETIQUETA) throw new EnvelopeInvalido();
  const iv = selado.subarray(0, TAMANHO_DO_IV);
  const etiqueta = selado.subarray(TAMANHO_DO_IV, TAMANHO_DO_IV + TAMANHO_DA_ETIQUETA);
  const corpo = selado.subarray(TAMANHO_DO_IV + TAMANHO_DA_ETIQUETA);
  try {
    const decifra = createDecipheriv(ALGORITMO_LOCAL, chave, iv);
    decifra.setAAD(aad);
    decifra.setAuthTag(etiqueta);
    return Buffer.concat([decifra.update(corpo), decifra.final()]);
  } catch {
    throw new EnvelopeInvalido();
  }
}

export function montarEnvelope(embrulhada: Buffer, selado: Buffer): Buffer {
  const tamanho = Buffer.alloc(2);
  tamanho.writeUInt16BE(embrulhada.length);
  return Buffer.concat([Buffer.from([VERSAO_DO_FORMATO]), tamanho, embrulhada, selado]);
}

export function desmontarEnvelope(bytes: Buffer): { readonly embrulhada: Buffer; readonly selado: Buffer } {
  if (bytes.length < 3 || bytes[0] !== VERSAO_DO_FORMATO) throw new EnvelopeInvalido();
  const tamanho = bytes.readUInt16BE(1);
  if (tamanho === 0 || bytes.length < 3 + tamanho + TAMANHO_DO_IV + TAMANHO_DA_ETIQUETA) throw new EnvelopeInvalido();
  return { embrulhada: bytes.subarray(3, 3 + tamanho), selado: bytes.subarray(3 + tamanho) };
}

export function createCifraEnvelope(chaveMestra: ChaveMestra): CifraDeTokens {
  return {
    async cifrar(texto, contexto) {
      const aad = aadDe(contexto);
      const chaveDeDados = randomBytes(TAMANHO_DA_CHAVE_DE_DADOS);
      try {
        const selado = selar(chaveDeDados, Buffer.from(texto, 'utf8'), aad);
        const { embrulhada, versao } = await chaveMestra.embrulhar(chaveDeDados, aad);
        return { bytes: montarEnvelope(embrulhada, selado), versaoDaChave: versao, algoritmo: chaveMestra.algoritmo };
      } finally {
        chaveDeDados.fill(0);
      }
    },

    async decifrar(bytes, contexto) {
      const aad = aadDe(contexto);
      const { embrulhada, selado } = desmontarEnvelope(bytes);
      const chaveDeDados = await chaveMestra.desembrulhar(embrulhada, aad);
      try {
        if (chaveDeDados.length !== TAMANHO_DA_CHAVE_DE_DADOS) throw new EnvelopeInvalido();
        return abrir(chaveDeDados, selado, aad).toString('utf8');
      } finally {
        chaveDeDados.fill(0);
      }
    },
  };
}
