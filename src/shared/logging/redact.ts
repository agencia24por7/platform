const SENSITIVE_KEYS = ['token', 'secret', 'password', 'authorization', 'credential', 'key'];

export function redact(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redact);
  if (input === null || typeof input !== 'object') return input;

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => {
      const isSensitive = SENSITIVE_KEYS.some((word) => key.toLowerCase().includes(word));
      return [key, isSensitive ? '[redigido]' : redact(value)];
    }),
  );
}
