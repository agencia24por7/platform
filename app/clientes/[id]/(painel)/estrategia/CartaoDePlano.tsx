import Link from 'next/link';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { apagarPlanoAcao } from '@/../app/clientes/[id]/(painel)/estrategia/acoes';
import type { CardNaTela } from '@/modules/strategy/interface/cardsDePlano';

export function CartaoDePlano({ card, clienteId }: { readonly card: CardNaTela; readonly clienteId: string }) {
  return (
    <li className="plano-card">
      <Link className="plano-card__link" href={card.href}>
        <span className="plano-card__titulo">{card.titulo}</span>
        <span className="plano-card__fatos">
          <span>{card.tipoRotulo}</span>
          {card.foco ? <span>Foco: {card.foco}</span> : null}
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
      {card.apagar ? (
        card.apagar.habilitado ? (
          <ConfirmarAcao
            gatilho="Apagar plano"
            rotuloDoGatilho={`Apagar o plano: ${card.titulo}`}
            titulo="Apagar o plano?"
            descricao="O plano sai da lista e não pode ser recuperado por aqui. O histórico fica guardado para auditoria."
            confirmar="Apagar plano"
            pendente="Apagando…"
            action={apagarPlanoAcao}
          >
            <input type="hidden" name="clienteId" value={clienteId} />
            <input type="hidden" name="planoId" value={card.planoId} />
          </ConfirmarAcao>
        ) : (
          <button type="button" className="btn btn--compacto" disabled title={card.apagar.motivo ?? undefined}>
            Apagar plano
          </button>
        )
      ) : null}
    </li>
  );
}
