'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { ABAS_DO_CLIENTE, ROTULO_DA_ABA, rotaDoCliente, type AbaDoCliente } from '@/modules/clients/domain/painel/enderecos';

type Props = {
  readonly clienteId: string;
  readonly contadores?: Partial<Record<AbaDoCliente, string>>;
};

export function AbasDoCliente({ clienteId, contadores = {} }: Props) {
  const segmento = useSelectedLayoutSegment();
  const ativa: AbaDoCliente = (ABAS_DO_CLIENTE as readonly string[]).includes(segmento ?? '')
    ? (segmento as AbaDoCliente)
    : 'visao';

  return (
    <nav className="abas" aria-label="Seções do cliente">
      <div className="abas__trilho">
        {ABAS_DO_CLIENTE.map((aba) => (
          <Link
            key={aba}
            href={rotaDoCliente(clienteId, aba)}
            className={`aba${aba === 'configuracoes' ? ' aba--discreta' : ''}`}
            aria-current={aba === ativa ? 'page' : undefined}
            scroll={false}
          >
            {aba === 'configuracoes' ? (
              <svg className="aba__icone" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="10" cy="10" r="2.6" />
                <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" strokeLinecap="round" />
              </svg>
            ) : null}
            <span className={aba === 'configuracoes' ? 'aba__texto--discreto' : undefined}>{ROTULO_DA_ABA[aba]}</span>
            {contadores[aba] ? <span className="aba__contador">{contadores[aba]}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}
