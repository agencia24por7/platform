import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import type { ItemDoIndicador } from '@/modules/strategy/interface/passosDoNovoPlano';

type Props = { readonly itens: readonly ItemDoIndicador[]; readonly progresso: string; readonly aoEscolher: (indice: number) => void };

export function IndicadorDePassos({ itens, progresso, aoEscolher }: Props) {
  return (
    <nav className="plano-passos" aria-label="Passos do novo plano">
      <p className="plano-passos__progresso">{progresso}</p>
      <ol className="plano-passos__lista">
        {itens.map((item) => (
          <li key={item.chave} className={`plano-passos__item plano-passos__item--${item.estado}${item.comErro ? ' plano-passos__item--erro' : ''}`}>
            <button type="button" className="plano-passos__botao" aria-current={item.estado === 'atual' ? 'step' : undefined} onClick={() => aoEscolher(item.indice)}>
              <span className="plano-passos__marca" aria-hidden="true">
                {item.comErro ? <Icone nome="erro" tamanho={14} /> : item.estado === 'concluido' ? <Icone nome="ok" tamanho={14} /> : item.numero}
              </span>
              <span className="plano-passos__rotulo">{item.rotulo}</span>
              <span className="plano-passos__estado">{item.textoDoEstado}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
