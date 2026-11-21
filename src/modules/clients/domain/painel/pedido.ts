import { z } from 'zod';

const secoes = z.array(z.string().min(1).max(64)).max(40);
const prazo = z.number().int().min(1).max(365);
const nota = z.string().max(500);
const convite = z.string().min(1).max(64).nullable();

const PedidoDeLink = z.object({ secoes, expiraEmDias: prazo, nota, conviteDeIntegracaoId: convite }).strict();

const PedidoAoCliente = z
  .object({
    plataformas: z.array(z.string().min(1).max(32)).max(20),
    incluirMapa: z.boolean(),
    secoes,
    expiraEmDias: prazo,
    nota,
    conviteDeIntegracaoId: convite,
  })
  .strict();

export type PedidoDeLinkLido = z.infer<typeof PedidoDeLink>;
export type PedidoAoClienteLido = z.infer<typeof PedidoAoCliente>;

export type Leitura<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false };

function ler<T>(esquema: z.ZodType<T>, bruto: unknown): Leitura<T> {
  const resultado = esquema.safeParse(bruto);
  return resultado.success ? { ok: true, valor: resultado.data } : { ok: false };
}

export const lerPedidoDeLink = (bruto: unknown): Leitura<PedidoDeLinkLido> => ler(PedidoDeLink, bruto);
export const lerPedidoAoCliente = (bruto: unknown): Leitura<PedidoAoClienteLido> => ler(PedidoAoCliente, bruto);
