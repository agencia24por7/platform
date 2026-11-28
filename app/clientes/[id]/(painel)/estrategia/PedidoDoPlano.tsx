import Link from 'next/link';
import type { PedidoNaTela } from '@/modules/strategy/interface/pedidoDoPlano';

export function PedidoDoPlano({ pedido }: { readonly pedido: PedidoNaTela }) {
  return (
    <section className="card estrategia-bloco" aria-labelledby="titulo-do-pedido">
      <div className="card__head">
        <h3 className="card__title" id="titulo-do-pedido">
          {pedido.titulo}
        </h3>
        {pedido.editar ? (
          <Link className="btn" href={pedido.editar.href}>
            {pedido.editar.rotulo}
          </Link>
        ) : null}
      </div>
      <div className="card__body">
        <dl className="plano-revisao__itens">
          {pedido.itens.map((item) => (
            <div key={item.rotulo} className="plano-revisao__item">
              <dt>{item.rotulo}</dt>
              <dd className="plano-revisao__valor">{item.valor}</dd>
            </div>
          ))}
        </dl>
        {pedido.editar ? <p className="field__hint">{pedido.editar.nota}</p> : null}
      </div>
    </section>
  );
}
