export function normalizeMetadata(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return normalizeMetadata(JSON.parse(raw));
    } catch {
      return { valor: raw };
    }
  }

  if (Array.isArray(raw)) return { valor: raw };
  if (typeof raw !== 'object' || raw === null) {
    return raw === undefined ? {} : { valor: raw };
  }

  return raw as Record<string, unknown>;
}
