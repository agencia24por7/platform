import Link from 'next/link';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import type { AvisoDaVisao } from '@/modules/strategy/interface/visaoDoPlano';

const CLASSE_DO_AVISO = { info: 'alert--info', warn: 'alert--warn', danger: 'alert--error' } as const;
const ICONE_DO_AVISO = { info: 'orienta', warn: 'atencao', danger: 'erro' } as const;

export function Avisos({ avisos }: { readonly avisos: readonly AvisoDaVisao[] }) {
  if (avisos.length === 0) return null;
  return (
    <div className="pilha estrategia-avisos">
      {avisos.map((aviso) => (
        <div key={aviso.chave} className={`alert ${CLASSE_DO_AVISO[aviso.tom]}`} role={aviso.tom === 'danger' ? 'alert' : 'status'}>
          <Icone nome={ICONE_DO_AVISO[aviso.tom]} />
          <div className="estrategia-aviso">
            <p className="estrategia-aviso__titulo">{aviso.titulo}</p>
            {aviso.texto ? <p>{aviso.texto}</p> : null}
            {aviso.itens.length > 0 ? (
              <ul className="estrategia-aviso__itens">
                {aviso.itens.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {aviso.link ? (
              <Link className="btn btn--compacto" href={aviso.link.href}>
                {aviso.link.rotulo}
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
