import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { IconeAuditoria, IconeClientes, IconeColetas, IconeConexoes } from '@/../app/_components/Icones';
import { ThemeToggle } from '@/../app/_components/ThemeToggle';
import type { Organization } from '@/modules/organizations/domain/organization';
import { modules } from '@/composition';
import { ORGANIZACAO_INTEIRA, escopoDeCliente } from '@/shared/db/escopo';
import { currentUser } from '@/shared/http/currentUser';

type NavEntry = { href: string; label: string; icone?: ComponentType<{ className?: string }> };

function navFor(organization: Organization | null, recortado: boolean): readonly NavEntry[] {
  const clientsLabel = organization?.type === 'advertiser' ? 'Negócios' : 'Clientes';

  if (recortado) {
    return [
      { href: '/clientes', label: clientsLabel, icone: IconeClientes },
      { href: '/automacoes', label: 'Coletas', icone: IconeColetas },
    ];
  }

  return [
    { href: '/clientes', label: clientsLabel, icone: IconeClientes },
    { href: '/integracoes', label: 'Conexões', icone: IconeConexoes },
    { href: '/automacoes', label: 'Coletas', icone: IconeColetas },
    { href: '/auditoria', label: 'Auditoria', icone: IconeAuditoria },
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
          <img className="side__logo" src="/orla/logo.png" alt="orla" />
          {organization ? (
            <span className="side__modo">
              {organization.type === 'agency' ? 'Modo agência' : 'Modo anunciante'}
            </span>
          ) : null}
        </div>
        <nav className="side__nav">
          {navFor(organization, recortado).map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="nav__item"
              aria-current={active === entry.href ? 'page' : undefined}
            >
              {entry.icone ? <entry.icone className="nav__icone" /> : null}
              {entry.label}
            </Link>
          ))}
        </nav>
        <div className="side__foot">
          {organization && organizacoes.length > 1 ? (
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
          ) : null}

          {session ? (
            <Link className="eu" href="/config" aria-current={active === '/config' ? 'page' : undefined}>
              <span className="eu__inicial" aria-hidden="true">
                {(session.user.name || session.user.email).trim().charAt(0).toUpperCase()}
              </span>
              <span className="eu__quem">
                <span className="eu__nome">{session.user.name}</span>
                <span className="eu__onde">
                  {organization ? organization.name : 'sem organização'}
                  {recortado ? ' · acesso restrito' : ''}
                </span>
              </span>
              <span className="eu__seta" aria-hidden="true">
                ›
              </span>
            </Link>
          ) : (
            <div>Nenhuma organização criada</div>
          )}

          <nav className="side__legal" aria-label="Privacidade">
            <Link href="/privacidade">Privacidade</Link>
            <Link href="/termos">Termos</Link>
            <a href="mailto:contato@agencia24por7.com" title="Encarregado pelo tratamento de dados">
              Encarregado
            </a>
          </nav>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="strong">{title}</span>
          <div className="sessao">
            <ThemeToggle />
          </div>
        </header>
        <div className="page" id="conteudo">
          {children}
        </div>
      </main>
    </div>
  );
}
