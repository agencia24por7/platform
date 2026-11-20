export const PADRAO_DO_TIPO = /^[a-z][a-z0-9_]{1,47}$/;
export const PADRAO_DO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const URN = /^orla:([0-9a-f-]{36}):([0-9a-f-]{36}):([a-z][a-z0-9_]{1,47}):([A-Za-z0-9][A-Za-z0-9._-]{0,159})$/;

export type PartesDaUrn = {
  readonly organizationId: string;
  readonly clienteId: string;
  readonly tipo: string;
  readonly id: string;
};

export class UrnInvalidaError extends Error {
  constructor(motivo: string) {
    super(`URN inválida: ${motivo}`);
    this.name = 'UrnInvalidaError';
  }
}

export function idSeguro(bruto: string): string {
  const limpo = bruto
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 160);
  if (!PADRAO_DO_ID.test(limpo)) throw new UrnInvalidaError(`id "${bruto}" não vira identificador estável`);
  return limpo;
}

export function criarUrn(organizationId: string, clienteId: string, tipo: string, id: string): string {
  if (!UUID.test(organizationId)) throw new UrnInvalidaError('organização não é UUID em minúsculas');
  if (!UUID.test(clienteId)) throw new UrnInvalidaError('cliente não é UUID em minúsculas');
  if (!PADRAO_DO_TIPO.test(tipo)) throw new UrnInvalidaError(`tipo "${tipo}" fora do padrão`);
  if (!PADRAO_DO_ID.test(id)) throw new UrnInvalidaError(`id "${id}" fora do padrão`);
  return `orla:${organizationId}:${clienteId}:${tipo}:${id}`;
}

export function lerUrn(urn: string): PartesDaUrn | null {
  const partes = URN.exec(urn);
  if (!partes) return null;
  const [, organizationId, clienteId, tipo, id] = partes as unknown as [string, string, string, string, string];
  if (!UUID.test(organizationId) || !UUID.test(clienteId)) return null;
  return { organizationId, clienteId, tipo, id };
}

export function urnDoCliente(urn: string, organizationId: string, clienteId: string): boolean {
  const partes = lerUrn(urn);
  return partes !== null && partes.organizationId === organizationId && partes.clienteId === clienteId;
}

export function nomeDeArquivoDaUrn(urn: string): string {
  const partes = lerUrn(urn);
  if (!partes) throw new UrnInvalidaError(urn);
  return `${partes.tipo}--${partes.id}.json`;
}
