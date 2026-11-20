import type { ContextoParaCatalogo } from './contexto.ts';
import type { EntradaDoCatalogo, EntradaSemSelo } from './entrada.ts';
import type { InventarioDoCliente } from './inventario.ts';
import { criarUrn } from './urn.ts';

export type ContextoDeDescoberta = {
  readonly organizationId: string;
  readonly clienteId: string;
  readonly agora: Date;
  readonly conjuntoDeDados: string;
  readonly bytesMaximosPorConsulta: number;
  readonly inventario: InventarioDoCliente;
  readonly contexto: ContextoParaCatalogo | null;
  readonly entradasPrimarias: readonly EntradaDoCatalogo[];
  urn(tipo: string, id: string): string;
};

export type StatusDoProvedor = 'ok' | 'degradado' | 'indisponivel';

export type SaudeDoProvedor = {
  readonly status: StatusDoProvedor;
  readonly motivo: string | null;
};

export type FaseDoProvedor = 'primaria' | 'derivada';

export type ProvedorDeCatalogo = {
  readonly id: string;
  readonly versao: number;
  readonly descricao: string;
  readonly fase: FaseDoProvedor;
  readonly tiposDeclarados: readonly string[];
  descobrir(ctx: ContextoDeDescoberta): Promise<readonly EntradaSemSelo[]> | readonly EntradaSemSelo[];
  saude(ctx: ContextoDeDescoberta): SaudeDoProvedor;
};

export const SAUDE_OK: SaudeDoProvedor = { status: 'ok', motivo: null };

export function contextoDeDescoberta(
  base: Omit<ContextoDeDescoberta, 'urn' | 'entradasPrimarias'> & { readonly entradasPrimarias?: readonly EntradaDoCatalogo[] },
): ContextoDeDescoberta {
  return {
    ...base,
    entradasPrimarias: base.entradasPrimarias ?? [],
    urn: (tipo, id) => criarUrn(base.organizationId, base.clienteId, tipo, id),
  };
}
