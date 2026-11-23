import { redactText } from '../logging/redact.ts';
import { mascararTokensEmTexto } from './caminhoSemToken.ts';

export function textoDoCliente(valor: unknown, limite?: number): string | null {
  if (typeof valor !== 'string' || valor.length === 0) return null;
  const limpo = redactText(mascararTokensEmTexto(valor));
  return limite === undefined ? limpo : limpo.slice(0, limite);
}

export function caminhoDaOrigem(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return mascararTokensEmTexto(new URL(referer).pathname);
  } catch {
    return null;
  }
}
