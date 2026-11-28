import { Icone, type NomeDoIcone } from '@/../app/clientes/[id]/_componentes/Icones';
import type { TomDoIndicador } from '@/modules/clients/domain/painel/indicadores';

type Props = {
  readonly tom: TomDoIndicador;
  readonly rotulo: string;
  readonly icone?: NomeDoIcone;
};

export function Indicador({ tom, rotulo, icone }: Props) {
  return (
    <span className={`marcador marcador--${tom}`}>
      {icone ? <Icone nome={icone} tamanho={14} /> : <span className="marcador__ponto" aria-hidden="true" />}
      {rotulo}
    </span>
  );
}
