export type EscopoDoVinculo = 'organizacao' | 'clientes';

export type ModoDoRecorte =
  | { readonly modo: 'organizacao' }
  | { readonly modo: 'clientes'; readonly clientIds: readonly string[] };

export const MOTIVO_RECORTE = {
  modo_ausente: 'Escolha se a pessoa enxerga a organização inteira ou só alguns clientes.',
  recorte_vazio: 'Escolha ao menos um cliente, ou dê acesso à organização inteira.',
  cliente_invalido: 'Algum cliente escolhido não existe nesta organização.',
} as const;

export type MotivoDoRecorte = keyof typeof MOTIVO_RECORTE;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recorteDoFormulario(modo: string, clientIds: readonly string[]): ModoDoRecorte | null {
  if (modo === 'organizacao') return { modo: 'organizacao' };
  if (modo === 'clientes') return { modo: 'clientes', clientIds };
  return null;
}

export function idsDoRecorte(recorte: ModoDoRecorte): readonly string[] {
  return recorte.modo === 'clientes' ? [...new Set(recorte.clientIds)] : [];
}

export function validarRecorte(recorte: ModoDoRecorte): MotivoDoRecorte | null {
  if (recorte.modo === 'organizacao') return null;
  const ids = idsDoRecorte(recorte);
  if (ids.length === 0) return 'recorte_vazio';
  if (!ids.every((id) => UUID.test(id))) return 'cliente_invalido';
  return null;
}

export function membroSemAcessoAClientes(membro: { readonly escopo: EscopoDoVinculo; readonly clientIds: readonly string[] }): boolean {
  return membro.escopo === 'clientes' && membro.clientIds.length === 0;
}
