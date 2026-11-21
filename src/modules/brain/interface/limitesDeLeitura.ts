export const LIMITE_DE_LEITURAS_POR_MINUTO = 300;
export const TETO_DE_LEITURAS_POR_MINUTO = 3_000;

export type LimitesDeLeitura = { readonly porCliente: number; readonly teto: number };

export type PedidoDeLeitura = { readonly key: string; readonly limit: number };

export function limitesDeLeitura(config: {
  readonly BRAIN_LEITURAS_POR_MINUTO?: number | undefined;
  readonly BRAIN_TETO_DE_LEITURAS_POR_MINUTO?: number | undefined;
}): LimitesDeLeitura {
  const teto = config.BRAIN_TETO_DE_LEITURAS_POR_MINUTO ?? TETO_DE_LEITURAS_POR_MINUTO;
  return { porCliente: Math.min(config.BRAIN_LEITURAS_POR_MINUTO ?? LIMITE_DE_LEITURAS_POR_MINUTO, teto), teto };
}

export function pedidosDeLeitura(fingerprint: string, clienteId: string | null, limites: LimitesDeLeitura): PedidoDeLeitura[] {
  const pedidos: PedidoDeLeitura[] = [{ key: `brain:${fingerprint}`, limit: limites.teto }];
  if (clienteId) pedidos.push({ key: `brain:${fingerprint}:${clienteId}`, limit: limites.porCliente });
  return pedidos;
}
