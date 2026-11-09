import Link from 'next/link';

export default function NaoEncontrado() {
  return (
    <div className="erro">
      <div className="erro__caixa">
        <img className="erro__icone" src="/orla/icone.png" alt="" width={44} height={44} />
        <h1 className="erro__titulo">Não achamos essa página</h1>
        <p className="erro__texto">
          O endereço pode ter mudado ou nunca existiu. Confira o link ou volte para o início.
        </p>
        <div className="erro__acoes">
          <Link className="btn btn--primary" href="/">
            Voltar para o início
          </Link>
        </div>
      </div>
    </div>
  );
}
