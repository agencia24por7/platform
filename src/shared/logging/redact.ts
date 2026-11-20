const SENSITIVE_KEYS = [
  'token',
  'secret',
  'password',
  'authorization',
  'credential',
  'key',
  'chave',
  'senha',
  'segredo',
  'credencial',
];

export function redact(input: unknown): unknown {
  if (typeof input === 'string') return redactText(input);
  if (Array.isArray(input)) return input.map(redact);
  if (input === null || typeof input !== 'object') return input;

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => {
      const isSensitive = SENSITIVE_KEYS.some((word) => key.toLowerCase().includes(word));
      return [key, isSensitive ? '[redigido]' : redact(value)];
    }),
  );
}

const SECRET_SHAPES = [
  /"(access_token|refresh_token|id_token|client_secret|developer[-_]token)"\s*:\s*"[^"]*"/gi,
  /\b(ya29|1\/\/|GOCSPX-|EAA)[A-Za-z0-9._\-/+]{10,}/g,
  /\bapify_api_[A-Za-z0-9]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._\-~+/=]{8,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

const EMAIL = /\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

export function redactText(input: string): string {
  const semSegredos = SECRET_SHAPES.reduce(
    (texto, forma) =>
      texto.replace(forma, (trecho) =>
        trecho.includes('"') ? trecho.replace(/:\s*"[^"]*"/, ': "[redigido]"') : '[redigido]',
      ),
    input,
  );
  return semSegredos.replace(EMAIL, '$1***@$2');
}
