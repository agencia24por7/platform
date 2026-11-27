import Link from 'next/link';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import type { CardNaTela } from '@/modules/strategy/interface/cardsDePlano';

export function CartaoDePlano({ card }: { readonly card: CardNaTela }) {
  return (
    <li className="plano-card">
      <Link className="plano-card__link" href={card.href}>
        <span className="plano-card__titulo">{card.titulo}</span>
        <span className="plano-card__fatos">
          <span>{card.tipoRotulo}</span>
          {card.plataformas.length > 0 ? <span>{card.plataformas.join(', ')}</span> : null}
          <time dateTime={card.atualizadoEm.toISOString()}>Atualizado em {card.atualizadoEmTexto}</time>
        </span>
        {card.progresso ? (
          <span className="plano-card__progresso">
            <progress value={card.progresso.percentual} max={100} aria-label={`Progresso: ${card.progresso.etapa}`} />
            <span>{card.progresso.etapa}</span>
          </span>
        ) : null}
      </Link>
      <span className={`pill ${card.classe}`}>
        <Icone nome={card.icone} tamanho={14} />
        {card.rotulo}
      </span>
    </li>
  );
}
