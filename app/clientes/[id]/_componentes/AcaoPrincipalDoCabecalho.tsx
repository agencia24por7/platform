'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';

type Props = { readonly href: string; readonly rotulo: string; readonly titulo: string };

const ABAS_COM_ACAO = new Set<string | null>([null, 'conexoes', 'contexto']);

export function AcaoPrincipalDoCabecalho({ href, rotulo, titulo }: Props) {
  const segmento = useSelectedLayoutSegment();
  if (!ABAS_COM_ACAO.has(segmento)) return null;
  return (
    <Link className="btn btn--primary" href={href} title={titulo}>
      {rotulo}
    </Link>
  );
}
