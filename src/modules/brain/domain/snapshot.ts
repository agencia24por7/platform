import type { AvaliacaoDeCapacidade } from './capacidades.ts';
import type { Diagnostico } from './diagnostico.ts';
import type { EntradaDoCatalogo } from './entrada.ts';
import type { StatusDoProvedor } from './provedor.ts';

export type EstadoDoProvedor = {
  readonly id: string;
  readonly versao: number;
  readonly status: StatusDoProvedor;
  readonly motivo: string | null;
  readonly entradas: number;
  readonly descartadas: number;
};

export type Snapshot = {
  readonly schemaVersion: number;
  readonly organizationId: string;
  readonly clienteId: string;
  readonly nomeDoCliente: string;
  readonly geradoEm: string;
  readonly entradas: readonly EntradaDoCatalogo[];
  readonly omitidasPelaPolitica: number;
  readonly restritasPelaPolitica: number;
  readonly capacidades: readonly AvaliacaoDeCapacidade[];
  readonly diagnostico: Diagnostico;
  readonly provedores: readonly EstadoDoProvedor[];
  readonly catalogHash: string;
};
