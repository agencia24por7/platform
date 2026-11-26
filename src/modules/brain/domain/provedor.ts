import type { EntradaDeConhecimento } from './conhecimento.ts';
import type { ContextoParaCatalogo } from './contexto.ts';
import type { DesempenhoMedido } from './desempenho.ts';
import type { EntradaDoCatalogo, EntradaSemSelo } from './entrada.ts';
import type { InventarioDoCliente } from './inventario.ts';
import type { RegrasParaCatalogo } from './regras.ts';
import { criarUrn } from './urn.ts';

export type ContextoDeDescoberta = {
  readonly organizationId: string;
  readonly clienteId: string;
  readonly agora: Date;
  readonly conjuntoDeDados: string;
  readonly bytesMaximosPorConsulta: number;
  readonly inventario: InventarioDoCliente;
  readonly contexto: ContextoParaCatalogo | null;
  readonly regras: RegrasParaCatalogo | null;
  readonly entradasPrimarias: readonly EntradaDoCatalogo[];
  readonly conhecimento: readonly EntradaDeConhecimento[] | null;
  readonly desempenho: readonly DesempenhoMedido[];
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
  base: Omit<ContextoDeDescoberta, 'urn' | 'entradasPrimarias' | 'regras' | 'conhecimento' | 'desempenho'> & {
    readonly entradasPrimarias?: readonly EntradaDoCatalogo[];
    readonly regras?: RegrasParaCatalogo | null;
    readonly conhecimento?: readonly EntradaDeConhecimento[] | null;
    readonly desempenho?: readonly DesempenhoMedido[];
  },
): ContextoDeDescoberta {
  return {
    ...base,
    entradasPrimarias: base.entradasPrimarias ?? [],
    regras: base.regras ?? null,
    conhecimento: base.conhecimento ?? null,
    desempenho: base.desempenho ?? base.inventario.desempenho ?? [],
    urn: (tipo, id) => criarUrn(base.organizationId, base.clienteId, tipo, id),
  };
}
