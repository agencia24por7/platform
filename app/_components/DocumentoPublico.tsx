import Link from 'next/link';
import type { ReactNode } from 'react';

type Props = {
  readonly titulo: string;
  readonly resumo: string;
  readonly atualizadoEm?: string;
  readonly children: ReactNode;
};

const LINKS = [
  { href: '/sobre', rotulo: 'Sobre a orla' },
  { href: '/privacidade', rotulo: 'Privacidade' },
  { href: '/termos', rotulo: 'Termos de serviço' },
  { href: '/exclusao-de-dados', rotulo: 'Exclusão de dados' },
];

export function DocumentoPublico({ titulo, resumo, atualizadoEm, children }: Props) {
  return (
    <div className="documento">
      <header className="documento__topo">
        <Link className="documento__marca" href="/sobre">
          <img src="/orla/icone.png" alt="" width={28} height={28} />
          orla
        </Link>
        <Link className="btn btn--primary" href="/entrar">
          Entrar
        </Link>
      </header>

      <main className="documento__corpo">
        <h1 className="documento__titulo">{titulo}</h1>
        <p className="documento__resumo">{resumo}</p>
        {atualizadoEm ? <p className="documento__data">Última atualização: {atualizadoEm}.</p> : null}
        {children}
      </main>

      <footer className="documento__rodape">
        <nav aria-label="Documentos">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.rotulo}
            </Link>
          ))}
        </nav>
        <p>
          orla é um produto da Agência 24/7 · <a href="mailto:contato@agencia24por7.com">contato@agencia24por7.com</a>
        </p>
      </footer>
    </div>
  );
}
