import type { DiscoveredAccount } from '@/modules/connections/domain/discovery';

export type ContaAlcancavel = DiscoveredAccount & {
  readonly id: string;
  readonly state: 'discovered' | 'linked' | 'ignored' | 'lost';
};

export type CaminhoDeAcesso = {
  readonly administradora: string | null;
  readonly contas: readonly ContaAlcancavel[];
  readonly vinculadas: number;
  readonly disponiveis: number;
};

export function agruparPorAdministradora(
  contas: readonly ContaAlcancavel[],
): readonly CaminhoDeAcesso[] {
  const porCaminho = new Map<string, ContaAlcancavel[]>();

  for (const conta of contas) {
    const caminho =
      conta.managerExternalId && conta.managerExternalId !== conta.externalId
        ? conta.managerExternalId
        : '';

    porCaminho.set(caminho, [...(porCaminho.get(caminho) ?? []), conta]);
  }

  return [...porCaminho.entries()]
    .map(([administradora, lista]) => ({
      administradora: administradora === '' ? null : administradora,
      contas: lista,
      vinculadas: lista.filter((conta) => conta.state === 'linked').length,
      disponiveis: lista.filter((conta) => conta.state === 'discovered' && !conta.inactive).length,
    }))
    .sort((a, b) => {
      if ((a.administradora === null) !== (b.administradora === null)) {
        return a.administradora === null ? 1 : -1;
      }
      return (a.administradora ?? '').localeCompare(b.administradora ?? '');
    });
}
