'use client';

import Link from 'next/link';
import { useSelectedLayoutSegment } from 'next/navigation';
import { Icone, type NomeDoIcone } from '@/../app/clientes/[id]/_componentes/Icones';
import { ROTULO_DA_ABA, rotaDoCliente, type AbaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import type { EstadoDoBloco, TomDoBloco } from '@/modules/clients/domain/painel/prontidao';

type Props = {
  readonly clienteId: string;
  readonly blocos: Readonly<Record<AbaDoCliente, EstadoDoBloco | null>>;
};

const ICONE_DO_TOM: Record<TomDoBloco, NomeDoIcone> = { ok: 'ok', atencao: 'atencao', critico: 'reautorizar', vazio: 'vazio' };
const CLASSE_DO_TOM: Record<TomDoBloco, string> = { ok: 'pill--ok', atencao: 'pill--warn', critico: 'pill--danger', vazio: '' };
const ABAS: readonly AbaDoCliente[] = ['conexoes', 'contexto', 'regras'];

export function AbasDoCliente({ clienteId, blocos }: Props) {
  const segmento = useSelectedLayoutSegment();
  const ativa: AbaDoCliente = segmento === 'contexto' || segmento === 'regras' ? segmento : 'conexoes';

  return (
    <nav className="abas" aria-label="Blocos do cliente">
      <div className="abas__trilho">
        {ABAS.map((aba) => {
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
                <span className={`pill ${CLASSE_DO_TOM[bloco.tom]}`}>
                  <Icone nome={ICONE_DO_TOM[bloco.tom]} tamanho={14} />
                  {bloco.rotulo}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
