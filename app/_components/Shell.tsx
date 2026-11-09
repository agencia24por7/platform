import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/../app/_components/ThemeToggle';
import type { Organization } from '@/modules/organizations/domain/organization';
import { modules } from '@/composition';
import { ORGANIZACAO_INTEIRA, escopoDeCliente } from '@/shared/db/escopo';
import { currentUser } from '@/shared/http/currentUser';

type NavEntry = { group: string } | { href: string; label: string };

function navFor(organization: Organization | null, recortado: boolean): readonly NavEntry[] {
  const clientsLabel = organization?.type === 'advertiser' ? 'Negócios' : 'Clientes';

  if (recortado) {
    return [
      { group: 'Operação' },
      { href: '/clientes', label: clientsLabel },
      { group: 'Dados' },
      { href: '/automacoes', label: 'Coletas' },
    ];
  }

  return [
    { group: 'Operação' },
    { href: '/clientes', label: clientsLabel },
    { href: '/integracoes', label: 'Contas e conexões' },
    { href: '/equipe', label: 'Equipe' },
    { href: '/organizacao', label: 'Organização' },
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
  const vinculos = session ? session.memberships : [];
  const organizacoes = vinculos.length > 1 ? await modules().organizations.ofUser(session!.user.id) : [];
  const recortado = organization ? (await escopoDeCliente(organization.id)) !== ORGANIZACAO_INTEIRA : false;

  return (
    <div className="shell">
      <a className="pular-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <aside className="side">
        <div className="side__brand">
          <img className="side__logo" src="/orla/logo.svg" alt="orla" />
        </div>
        <nav className="side__nav">
          {navFor(organization, recortado).map((entry) =>
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
              {organizacoes.length > 1 ? (
                <form className="trocador" action="/api/organizacao" method="post">
                  <input type="hidden" name="voltarPara" value={active} />
                  <label className="trocador__rotulo" htmlFor="trocador-organizacao">
                    Organização
                  </label>
                  <select
                    className="select select--compacto"
                    id="trocador-organizacao"
                    name="organizationId"
                    defaultValue={organization.id}
                  >
                    {organizacoes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn--compacto" type="submit">
                    Trocar
                  </button>
                </form>
              ) : (
                <div className="strong small" style={{ color: 'var(--fg)' }}>
                  {organization.name}
                </div>
              )}
              <div>{organization.type === 'agency' ? 'Opera contas de clientes' : 'Opera as próprias contas'}</div>
              {recortado ? <div>Acesso restrito aos seus clientes</div> : null}
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
