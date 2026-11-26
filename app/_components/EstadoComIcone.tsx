import type { ReactNode } from 'react';
import type { ApresentacaoDeEstado, IconeDeEstado } from '@/modules/ia/interface/apresentacao';
import { IconeAlerta, IconeBloqueio, IconeCheck, IconePausa, IconeRelogio } from '@/../app/_components/Icones';

const ICONES: Record<IconeDeEstado, (props: { readonly className?: string }) => ReactNode> = {
  check: IconeCheck,
  relogio: IconeRelogio,
  bloqueio: IconeBloqueio,
  alerta: IconeAlerta,
  pausa: IconePausa,
};

export function IconeDeEstadoSvg({ icone, className = 'pill__icone' }: { readonly icone: IconeDeEstado; readonly className?: string }) {
  const Icone = ICONES[icone];
  return <Icone className={className} />;
}

export function EstadoComIcone({ estado, rotulo }: { readonly estado: ApresentacaoDeEstado; readonly rotulo?: string }) {
  const classe = estado.tom === 'neutral' ? 'pill' : `pill pill--${estado.tom}`;
  return (
    <span className={classe}>
      <IconeDeEstadoSvg icone={estado.icone} />
      {rotulo ?? estado.rotulo}
    </span>
  );
}
