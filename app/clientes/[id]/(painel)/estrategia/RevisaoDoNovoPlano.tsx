import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import type { RevisaoDoNovoPlano as Modelo } from '@/modules/strategy/interface/revisaoDoNovoPlano';

type Props = { readonly revisao: Modelo; readonly aoEditar: (passo: number) => void };

export function RevisaoDoNovoPlano({ revisao, aoEditar }: Props) {
  return (
    <div className="plano-revisao">
      {revisao.pendencias > 0 ? (
        <p className="alert alert--warn" role="status">
          <Icone nome="atencao" />
          <span>{revisao.pendencias === 1 ? 'Falta 1 informação.' : `Faltam ${revisao.pendencias} informações.`} Use Editar para completar antes de pedir o plano.</span>
        </p>
      ) : null}
      {revisao.bloqueio ? (
        <p className="alert alert--warn" role="status">
          <Icone nome="atencao" />
          <span>
            {revisao.bloqueio.texto}{' '}
            <button type="button" className="plano-revisao__editar" onClick={() => aoEditar(revisao.bloqueio?.passo ?? 0)}>
              Ver avisos
            </button>
          </span>
        </p>
      ) : null}
      {revisao.grupos.map((grupo) => (
        <section key={grupo.chave} className="plano-revisao__grupo" aria-label={grupo.titulo}>
          <div className="plano-revisao__topo">
            <h4 className="plano-revisao__titulo">{grupo.titulo}</h4>
            <button type="button" className="plano-revisao__editar" onClick={() => aoEditar(grupo.passo)}>
              Editar<span className="sr-only"> {grupo.titulo}</span>
            </button>
          </div>
          <dl className="plano-revisao__itens">
            {grupo.itens.map((item) => (
              <div key={item.rotulo} className="plano-revisao__item">
                <dt>{item.rotulo}</dt>
                <dd className={item.vazio ? 'plano-revisao__valor plano-revisao__valor--vazio' : 'plano-revisao__valor'}>
                  {item.vazio ? <Icone nome="atencao" tamanho={14} /> : null} {item.valor}
                  {item.nota ? <span className="field__hint">{item.nota}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
