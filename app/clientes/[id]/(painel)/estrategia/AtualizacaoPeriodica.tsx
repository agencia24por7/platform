'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { proximoIntervalo } from '@/modules/strategy/interface/agendamentoDaAtualizacao';

type Props = { readonly ativa: boolean };

export function AtualizacaoPeriodica({ ativa }: Props) {
  const router = useRouter();
  const [parou, setParou] = useState(false);

  useEffect(() => {
    if (!ativa) return;
    const inicio = Date.now();
    let espera: ReturnType<typeof setTimeout> | undefined;

    const agendar = () => {
      const intervalo = proximoIntervalo(Date.now() - inicio);
      if (intervalo === null) {
        setParou(true);
        return;
      }
      espera = setTimeout(() => {
        if (document.visibilityState === 'visible') router.refresh();
        agendar();
      }, intervalo);
    };

    const aoVoltar = () => {
      if (document.visibilityState === 'visible' && proximoIntervalo(Date.now() - inicio) !== null) router.refresh();
    };

    setParou(false);
    agendar();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      if (espera !== undefined) clearTimeout(espera);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [ativa, router]);

  if (!parou) return null;
  return (
    <p className="field__hint" role="status">
      A atualização automática parou.{' '}
      <button type="button" className="btn btn--compacto" onClick={() => router.refresh()}>
        Atualizar agora
      </button>
    </p>
  );
}
