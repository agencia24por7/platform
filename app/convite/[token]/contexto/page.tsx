import type { Metadata } from 'next';
import { EstadoDoLink, PaginaPublica } from '@/../app/contexto/_publico/PaginaPublica';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mapa de contexto',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function FormularioPeloConvite({ params }: { readonly params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (token.length < 16 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return <EstadoDoLink titulo="Link incompleto" texto="Confira se o endereço foi copiado inteiro." />;
  }
  return <PaginaPublica credencial={{ tipo: 'convite', token }} voltarPara={`/convite/${token}`} />;
}
