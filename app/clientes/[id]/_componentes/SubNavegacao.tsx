import Link from 'next/link';

type Item = { readonly chave: string; readonly rotulo: string; readonly href: string; readonly contador?: number | null };

export function SubNavegacao({ itens, ativa, rotulo }: { readonly itens: readonly Item[]; readonly ativa: string; readonly rotulo: string }) {
  return (
    <nav className="subnav" aria-label={rotulo}>
      <ul className="subnav__lista">
        {itens.map((item) => (
          <li key={item.chave}>
            <Link className="subnav__link" href={item.href} aria-current={item.chave === ativa ? 'page' : undefined} scroll={false}>
              {item.rotulo}
              {item.contador ? <span className="selo-contagem">{item.contador}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
