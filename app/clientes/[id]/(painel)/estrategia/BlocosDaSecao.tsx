import Link from 'next/link';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { ROTULO_DA_NOTA } from '@/modules/strategy/interface/rotulosDoPlano';
import type { AfirmacaoNaTela, BlocoDoResumo, Marca } from '@/modules/strategy/interface/visaoDoPlano';

export function Marcas({ marcas }: { readonly marcas: readonly Marca[] }) {
  if (marcas.length === 0) return null;
  return (
    <ul className="marcas" aria-label="Evidências do contexto do cliente">
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

function Afirmacao({ afirmacao }: { readonly afirmacao: AfirmacaoNaTela }) {
  return (
    <div className="afirmacao">
      <p className="afirmacao__texto">
        {afirmacao.texto}{' '}
        {afirmacao.hipotese ? (
          <span className="pill" title="Sem evidência no contexto do cliente: é uma aposta a ser testada">
            <Icone nome="orienta" tamanho={14} />
            hipótese
          </span>
        ) : null}
      </p>
      <Marcas marcas={afirmacao.marcas} />
    </div>
  );
}

export function Bloco({ bloco }: { readonly bloco: BlocoDoResumo }) {
  return (
    <div className="bloco">
      <p className="bloco__rotulo">{bloco.rotulo}</p>
      {bloco.tipo === 'texto' ? <p className="bloco__texto">{bloco.texto}</p> : <Afirmacao afirmacao={bloco.afirmacao} />}
    </div>
  );
}
