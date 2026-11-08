import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/../app/_components/ThemeToggle';
import type { Organization } from '@/modules/organizations/domain/organization';
import { currentUser } from '@/shared/http/currentUser';

type NavEntry = { group: string } | { href: string; label: string };

function navFor(organization: Organization | null): readonly NavEntry[] {
  const clientsLabel = organization?.type === 'advertiser' ? 'Negócios' : 'Clientes';

  return [
    { group: 'Operação' },
    { href: '/clientes', label: clientsLabel },
    { href: '/integracoes', label: 'Contas e conexões' },
    { group: 'Dados' },
    { href: '/automacoes', label: 'Coletas' },
    { href: '/auditoria', label: 'Auditoria' },
  ];
}

type Props = {
  readonly title: string;
  readonly organization: Organization | null;
  readonly active: string;
  readonly children: ReactNode;
};

export async function Shell({ title, organization, active, children }: Props) {
  const session = await currentUser();

  return (
    <div className="shell">
      <a className="pular-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <aside className="side">
        <div className="side__brand">
          <span className="mark">õ</span>
          <span className="brand">
            orla
            <small>Um oceano azul para seus anúncios</small>
          </span>
        </div>
        <nav className="side__nav">
          {navFor(organization).map((entry) =>
            'group' in entry ? (
              <div key={entry.group} className="nav__group">
                {entry.group}
              </div>
            ) : (
              <Link
                key={entry.href}
                href={entry.href}
                className="nav__item"
                aria-current={active === entry.href ? 'page' : undefined}
              >
                {entry.label}
              </Link>
            ),
          )}
        </nav>
        <div className="side__foot">
          {organization ? (
            <>
              <div className="strong small" style={{ color: 'var(--rail-fg-strong)' }}>
                {organization.name}
              </div>
              <div>{organization.type === 'agency' ? 'Opera contas de clientes' : 'Opera as próprias contas'}</div>
            </>
          ) : (
            <div>Nenhuma organização criada</div>
          )}
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="strong">{title}</span>
          <div className="sessao">
            <ThemeToggle />
            {session ? (
              <>
                <span className="sessao__quem">{session.user.email}</span>
                <form action="/api/auth/sair" method="post">
                  <button className="sessao__sair" type="submit">
                    Sair
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </header>
        <div className="page" id="conteudo">
          {children}
        </div>
      </main>
    </div>
  );
}
