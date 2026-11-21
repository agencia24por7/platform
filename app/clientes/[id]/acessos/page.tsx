import { redirecionarRotaLegada, type BuscaDaRota } from '@/../app/clientes/[id]/_legado';

export const dynamic = 'force-dynamic';

export default async function Rota({ params, searchParams }: { readonly params: Promise<{ id: string }>; readonly searchParams: BuscaDaRota }) {
  return redirecionarRotaLegada(params, searchParams, 'acessos');
}
