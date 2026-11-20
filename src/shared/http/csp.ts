export const CABECALHO_DO_NONCE = 'x-nonce';

export function novoNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

export function politicaDeSeguranca(nonce: string, desenvolvimento: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${desenvolvimento ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    desenvolvimento ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}
