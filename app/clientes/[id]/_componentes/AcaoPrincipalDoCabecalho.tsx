'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { abaComAcaoNoCabecalho } from '@/modules/clients/domain/painel/enderecos';

type Props = { readonly href: string; readonly rotulo: string; readonly titulo: string; readonly ehConexao: boolean };

export function AcaoPrincipalDoCabecalho({ href, rotulo, titulo, ehConexao }: Props) {
  const segmento = useSelectedLayoutSegment();
  if (!abaComAcaoNoCabecalho(segmento, ehConexao)) return null;
  return (
    <Link className="btn btn--primary" href={href} title={titulo}>
      {rotulo}
    </Link>
  );
}
