import type { Metadata } from 'next';
import { EstadoDoLink, PaginaPublica } from '@/../app/contexto/_publico/PaginaPublica';
import { tokenBemFormado } from '@/modules/clients/domain/contexto/link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mapa de contexto',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function FormularioPeloLink({ params }: { readonly params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!tokenBemFormado(token)) {
    return <EstadoDoLink titulo="Link incompleto" texto="Confira se o endereço foi copiado inteiro. Se continuar assim, peça um novo link à equipe." />;
  }
  return <PaginaPublica credencial={{ tipo: 'link', token }} />;
}
