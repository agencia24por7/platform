import Link from 'next/link';
import type { ReactNode } from 'react';
import { Shell } from '@/../app/_components/Shell';
import { AbasDoCliente } from '@/../app/clientes/[id]/_componentes/AbasDoCliente';
import { Anel } from '@/../app/clientes/[id]/_componentes/Anel';
import { carregarContexto, carregarPainel } from '@/../app/clientes/[id]/_dados';
import { modules } from '@/composition';
import { EFEITO_DA_SITUACAO, ROTULO_DA_SITUACAO } from '@/modules/clients/domain/ciclo';
import { rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';

export const dynamic = 'force-dynamic';

const TOM_DA_SITUACAO = { active: 'pill--ok', paused: 'pill--warn', archived: '' } as const;

export default async function LayoutDoCliente({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx, cliente, podeEditar, organizacaoInteira } = await carregarPainel(id);
  const [contexto, convites] = await Promise.all([
    carregarContexto(ctx.organization.id, cliente.id),
    organizacaoInteira ? modules().connectionInvites.listByClient(ctx.organization.id, cliente.id) : Promise.resolve([]),
  ]);
  const agora = new Date();
  const pendentes = convites.filter((c) => c.status === 'pending' && c.expiresAt > agora).length;
  const completude = contexto?.completude.geral ?? 0;

  return (
    <Shell title={cliente.name} organization={ctx.organization} active="/clientes">
      <header className="cliente-topo">
        <nav className="migalhas" aria-label="Você está em">
          <Link href="/clientes">{ctx.organization.type === 'advertiser' ? 'Negócios' : 'Clientes'}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{cliente.name}</span>
        </nav>
        <div className="cliente-topo__linha">
          <div className="cliente-topo__quem">
            <span className="cliente-topo__monograma" aria-hidden="true">
              {cliente.name.trim().charAt(0).toUpperCase()}
            </span>
            <div className="cliente-topo__textos">
              <h1 className="page__title">{cliente.name}</h1>
              <ul className="cliente-topo__fatos" aria-label="Resumo do cliente">
                <li>
                  <span className={`pill ${TOM_DA_SITUACAO[cliente.status]}`}>
                    <span className="dot" />
                    {ROTULO_DA_SITUACAO[cliente.status]}
                  </span>
                </li>
                <li>{cliente.businessModel === 'ecommerce' ? 'E-commerce' : 'Geração de leads'}</li>
                <li>{cliente.segment ?? 'Sem segmento'}</li>
                {cliente.parentClientId ? <li>Unidade de uma rede</li> : null}
              </ul>
            </div>
          </div>
          <div className="cliente-topo__direita">
            <Link className="cliente-topo__anel" href={rotaDoCliente(cliente.id, 'contexto')} title="Abrir o mapa de contexto">
              <Anel valor={completude} rotulo="Contexto" detalhe={contexto?.completude.essenciaisCompletos ? 'essencial completo' : 'completude geral'} tom={completude >= 60 ? 'ok' : 'acento'} />
            </Link>
            {podeEditar && organizacaoInteira ? (
              <div className="cliente-topo__acoes">
                <Link className="btn btn--primary" href={rotaDoCliente(cliente.id, 'acessos', { enviar: 'contexto' })}>
                  Enviar mapa de contexto
                </Link>
                <Link className="btn" href={`/clientes/${cliente.id}/contas/nova`}>
                  Conectar conta
                </Link>
              </div>
            ) : null}
          </div>
        </div>
        {cliente.status !== 'active' ? (
          <div className={`faixa-de-estado faixa-de-estado--${cliente.status}`} role="status">
            <strong>Cliente {ROTULO_DA_SITUACAO[cliente.status].toLowerCase()}.</strong> {EFEITO_DA_SITUACAO[cliente.status]}{' '}
            <Link href={rotaDoCliente(cliente.id, 'configuracoes')}>Mudar situação</Link>
          </div>
        ) : null}
      </header>
      <AbasDoCliente clienteId={cliente.id} contadores={{ contexto: `${completude}%`, ...(pendentes > 0 ? { acessos: String(pendentes) } : {}) }} />
      <div className="cliente-aba">{children}</div>
    </Shell>
  );
}
