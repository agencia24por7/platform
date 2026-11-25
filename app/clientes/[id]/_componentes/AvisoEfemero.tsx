'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  SEGUNDOS_DO_AVISO_DE_SUCESSO,
  semParametrosDeAviso,
  temParametroDeAviso,
} from '@/modules/clients/domain/painel/avisos';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';

type Props = {
  readonly erro?: string | undefined;
  readonly feito?: string | undefined;
};

type Tipo = 'erro' | 'feito';

export function AvisoEfemero({ erro, feito }: Props) {
  const busca = useSearchParams().toString();
  const [fechados, setFechados] = useState<readonly Tipo[]>([]);

  useEffect(() => {
    if (!temParametroDeAviso(busca)) return;
    setFechados([]);
    const atual = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', semParametrosDeAviso(atual));
  }, [busca]);

  const feitoVisivel = Boolean(feito) && !fechados.includes('feito');

  useEffect(() => {
    if (!feitoVisivel) return;
    const espera = setTimeout(() => setFechados((atuais) => [...atuais, 'feito']), SEGUNDOS_DO_AVISO_DE_SUCESSO * 1000);
    return () => clearTimeout(espera);
  }, [feitoVisivel, feito, busca]);

  const fechar = (tipo: Tipo) => setFechados((atuais) => [...atuais, tipo]);

  return (
    <>
      {erro && !fechados.includes('erro') ? (
        <div className="alert alert--error aviso-efemero" role="alert">
          <Icone nome="erro" />
          <span className="aviso-efemero__texto">{erro}</span>
          <button type="button" className="aviso-efemero__fechar" aria-label="Fechar aviso" onClick={() => fechar('erro')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ) : null}
      {feito && feitoVisivel ? (
        <div className="alert alert--ok aviso-efemero" role="status">
          <Icone nome="ok" />
          <span className="aviso-efemero__texto">{feito}</span>
          <button type="button" className="aviso-efemero__fechar" aria-label="Fechar aviso" onClick={() => fechar('feito')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      ) : null}
    </>
  );
}
