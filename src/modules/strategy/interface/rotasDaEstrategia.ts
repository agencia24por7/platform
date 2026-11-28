import { rotaDoCliente } from '../../clients/domain/painel/enderecos.ts';

export function rotaDaListaDePlanos(clienteId: string, busca: Readonly<Record<string, string | null | undefined>> = {}): string {
  return rotaDoCliente(clienteId, 'estrategia', busca);
}

export function rotaDoPlano(clienteId: string, planoId: string): string {
  return `${rotaDoCliente(clienteId, 'estrategia')}/${encodeURIComponent(planoId)}`;
}

export function rotaDaMemoriaDoPlano(clienteId: string, planoId: string): string {
  return `${rotaDoPlano(clienteId, planoId)}/memoria`;
}
