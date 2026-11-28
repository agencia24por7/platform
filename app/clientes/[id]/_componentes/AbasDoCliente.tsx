'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icone, type NomeDoIcone } from '@/../app/clientes/[id]/_componentes/Icones';
import { ABAS_DO_CLIENTE, ROTULO_DA_ABA, abaDoSegmento, rotaDoCliente, type AbaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import type { EstadoDoBloco, TomDoBloco } from '@/modules/clients/domain/painel/prontidao';

type Props = {
  readonly clienteId: string;
  readonly blocos: Readonly<Record<AbaDoCliente, EstadoDoBloco | null>>;
  readonly contadores?: Readonly<Partial<Record<AbaDoCliente, number>>>;
  readonly abasOcultas?: readonly AbaDoCliente[];
};

const ICONE_DO_TOM: Record<TomDoBloco, NomeDoIcone> = { ok: 'ok', atencao: 'atencao', critico: 'reautorizar', vazio: 'vazio' };
const CLASSE_DO_TOM: Record<TomDoBloco, string> = { ok: 'aba__estado--ok', atencao: 'aba__estado--warn', critico: 'aba__estado--danger', vazio: '' };

export function AbasDoCliente({ clienteId, blocos, contadores, abasOcultas = [] }: Props) {
  const segmento = useSelectedLayoutSegment();
  const ativa = abaDoSegmento(segmento);
  const trilho = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mostrarAtiva = () => {
      const faixa = trilho.current;
      const aba = faixa?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!faixa || !aba) return;
      const margem = 12;
      const f = faixa.getBoundingClientRect();
      const a = aba.getBoundingClientRect();
      if (a.right > f.right) faixa.scrollLeft += a.right - f.right + margem;
      else if (a.left < f.left) faixa.scrollLeft -= f.left - a.left + margem;
    };
    mostrarAtiva();
    void document.fonts?.ready.then(mostrarAtiva);
  }, [ativa]);

  return (
    <nav className="abas" aria-label="Blocos do cliente">
      <div className="abas__trilho" ref={trilho}>
        {ABAS_DO_CLIENTE.filter((aba) => !abasOcultas.includes(aba)).map((aba) => {
          const bloco = blocos[aba];
          return (
            <Link
              key={aba}
              href={rotaDoCliente(clienteId, aba)}
              className="aba"
              aria-current={aba === ativa ? 'page' : undefined}
              title={bloco?.proximoPasso ?? undefined}
              scroll={false}
            >
              <span className="aba__rotulo">{ROTULO_DA_ABA[aba]}</span>
              {bloco ? (
                <span className={`aba__estado ${CLASSE_DO_TOM[bloco.tom]}`}>
                  <Icone nome={ICONE_DO_TOM[bloco.tom]} tamanho={12} />
                  <span>{bloco.rotulo}</span>
                </span>
              ) : null}
              {contadores?.[aba] ? <span className="selo-contagem">{contadores[aba]}</span> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
