import Link from 'next/link';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { ROTULO_DA_NOTA } from '@/modules/strategy/interface/rotulosDoPlano';
import type { AfirmacaoNaTela, BlocoDaSecao, Celula, Marca } from '@/modules/strategy/interface/visaoDoPlano';

export function Marcas({ marcas }: { readonly marcas: readonly Marca[] }) {
  if (marcas.length === 0) return null;
  return (
    <ul className="marcas" aria-label="Evidências do Brain">
      {marcas.map((marca) => (
        <li key={`${marca.urn}-${marca.papel}`}>
          <Link className="marca" href={marca.href} title={marca.titulo}>
            <span className="marca__texto">{marca.rotulo}</span>
            <span className="marca__papel">{marca.papel}</span>
            {marca.indicacoes.map((indicacao) => (
              <span key={indicacao} className="marca__papel">
                {indicacao}
              </span>
            ))}
            {marca.nota ? (
              <span className={`marca__nota marca__nota--${marca.nota.toLowerCase()}`} title={ROTULO_DA_NOTA[marca.nota]} aria-label={ROTULO_DA_NOTA[marca.nota]}>
                {marca.nota}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Hipotese() {
  return (
    <span className="pill" title="Sem evidência no Brain: é uma aposta a ser testada">
      <Icone nome="orienta" tamanho={14} />
      hipótese
    </span>
  );
}

function Afirmacao({ afirmacao }: { readonly afirmacao: AfirmacaoNaTela }) {
  return (
    <div className="afirmacao">
      <p className="afirmacao__texto">
        {afirmacao.texto} {afirmacao.hipotese ? <Hipotese /> : null}
      </p>
      <Marcas marcas={afirmacao.marcas} />
    </div>
  );
}

function CelulaDaTabela({ celula }: { readonly celula: Celula }) {
  return typeof celula === 'string' ? <>{celula}</> : <Marcas marcas={celula} />;
}

export function Bloco({ bloco }: { readonly bloco: BlocoDaSecao }) {
  if (bloco.tipo === 'afirmacao') {
    return (
      <div className="bloco">
        {bloco.rotulo ? <p className="bloco__rotulo">{bloco.rotulo}</p> : null}
        <Afirmacao afirmacao={bloco.afirmacao} />
      </div>
    );
  }
  if (bloco.tipo === 'texto') {
    return (
      <div className="bloco">
        {bloco.rotulo ? <p className="bloco__rotulo">{bloco.rotulo}</p> : null}
        <p className="bloco__texto">{bloco.texto}</p>
      </div>
    );
  }
  if (bloco.tipo === 'lista') {
    return (
      <div className="bloco">
        <p className="bloco__rotulo">{bloco.rotulo}</p>
        <ul className="bloco__lista">
          {bloco.itens.map((item, indice) => (
            <li key={`${indice}-${item}`}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (bloco.tipo === 'tabela') {
    return (
      <div className="bloco">
        {bloco.rotulo ? <p className="bloco__rotulo">{bloco.rotulo}</p> : null}
        <div className="tabela-rolavel">
          <table className="tabela-plano">
            <caption className="sr-only">{bloco.rotulo ?? 'Tabela do plano'}</caption>
            <thead>
              <tr>
                {bloco.colunas.map((coluna) => (
                  <th key={coluna} scope="col">
                    {coluna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bloco.linhas.map((linha, indice) => (
                <tr key={indice}>
                  {linha.map((celula, posicao) => (
                    <td key={posicao}>
                      <CelulaDaTabela celula={celula} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return (
    <article className={bloco.destaque ? 'item-do-plano item-do-plano--destaque' : 'item-do-plano'}>
      <header className="item-do-plano__topo">
        <h4 className="item-do-plano__titulo">{bloco.titulo}</h4>
        {bloco.selo === 'hipótese' ? (
          <Hipotese />
        ) : bloco.selo ? (
          <span className={bloco.destaque ? 'pill pill--warn' : 'pill'}>
            {bloco.destaque ? <Icone nome="atencao" tamanho={14} /> : null}
            {bloco.selo}
          </span>
        ) : null}
      </header>
      {bloco.fatos.length > 0 ? (
        <dl className="item-do-plano__fatos">
          {bloco.fatos.map((fato) => (
            <div key={fato.rotulo}>
              <dt>{fato.rotulo}</dt>
              <dd>{fato.valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {bloco.afirmacoes.map((item, indice) => (
        <div className="bloco" key={indice}>
          {item.rotulo ? <p className="bloco__rotulo">{item.rotulo}</p> : null}
          <Afirmacao afirmacao={item.afirmacao} />
        </div>
      ))}
      <Marcas marcas={bloco.marcas} />
    </article>
  );
}
