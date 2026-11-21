import Link from 'next/link';
import type { ReactNode } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { Shell } from '@/../app/_components/Shell';
import { AbasDoCliente } from '@/../app/clientes/[id]/_componentes/AbasDoCliente';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { MenuMais } from '@/../app/clientes/[id]/_componentes/MenuMais';
import { carregarContexto, carregarPainel, carregarProntidao } from '@/../app/clientes/[id]/_dados';
import { mudarSituacao } from '@/../app/clientes/[id]/(painel)/conexoes/acoes';
import { EFEITO_DA_SITUACAO, ROTULO_DA_SITUACAO, SITUACOES, mudancaPermitida } from '@/modules/clients/domain/ciclo';
import { tamanhoLegivel } from '@/modules/clients/domain/painel/formato';
import { acaoPrincipal, ROTULO_DO_VEREDITO, type Veredito } from '@/modules/clients/domain/painel/prontidao';
import { podeCadastrarCliente } from '@/modules/clients/domain/painel/permissoes';
import { noVocabularioDe, vocabularioDe } from '@/modules/organizations/domain/vocabulario';

export const dynamic = 'force-dynamic';

const TOM_DA_SITUACAO = { active: 'pill--ok', paused: 'pill--warn', archived: '' } as const;
const CLASSE_DO_VEREDITO: Record<Veredito, string> = { sim: 'pill--ok', parcial: 'pill--warn', nao: 'pill--danger' };

const ROTULO_DO_BRAIN: Record<string, string> = {
  desativado: 'Armazenamento não configurado',
  nunca_publicado: 'Ainda não publicado',
  em_dia: 'Publicado e em dia',
  pendente: 'Publicação pendente',
  com_erro: 'Última publicação falhou',
};

export default async function LayoutDoCliente({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx, cliente, podeEditar, podeAdministrar, organizacaoInteira } = await carregarPainel(id);
  const [prontidao, contexto] = await Promise.all([carregarProntidao(ctx.organization.id, cliente.id), carregarContexto(ctx.organization.id, cliente.id)]);
  const principal = prontidao ? acaoPrincipal(prontidao.acoes, cliente.id, { podeEditar, organizacaoInteira, tipo: ctx.organization.type }) : null;
  const vocabulario = vocabularioDe(ctx.organization.type);
  const opcoes = SITUACOES.filter((valor) => mudancaPermitida(ctx.role, valor) === null);

  return (
    <Shell title={cliente.name} organization={ctx.organization} active="/clientes">
      <header className="cliente-topo">
        <nav className="migalhas" aria-label="Você está em">
          <Link href="/clientes">{vocabulario.clientes}</Link>
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
              <ul className="cliente-topo__fatos" aria-label={vocabulario.resumoDoCliente}>
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
            {principal ? (
              <Link className="btn btn--primary" href={principal.href} title={principal.titulo}>
                {principal.rotulo}
              </Link>
            ) : null}
            {ctx.organization.type === 'advertiser' && organizacaoInteira && podeCadastrarCliente(ctx.organization.type, ctx.role) ? (
              <Link className="btn" href="/clientes/novo">
                Novo negócio
              </Link>
            ) : null}
            <MenuMais rotulo="Situação e arquivos">
              {podeEditar ? (
                <form className="menu-mais__bloco" action={mudarSituacao}>
                  <input type="hidden" name="clientId" value={cliente.id} />
                  <label className="field">
                    <span className="field__label">Situação</span>
                    <select className="select" name="situacao" defaultValue={cliente.status}>
                      {opcoes.map((valor) => (
                        <option key={valor} value={valor}>
                          {ROTULO_DA_SITUACAO[valor]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="field__hint">{noVocabularioDe(ctx.organization.type, EFEITO_DA_SITUACAO[cliente.status])}</p>
                  <BotaoDeEnvio className="btn" pendente="Aplicando…">
                    Aplicar
                  </BotaoDeEnvio>
                  <p className="field__hint">Excluir é lógico (ADR 0022) e fica com quem administra: arquive aqui.</p>
                </form>
              ) : null}
                <dl className="menu-mais__bloco fatos">
                  <div className="fatos__item">
                    <dt className="fatos__rotulo">Arquivos</dt>
                    <dd>{contexto ? `${tamanhoLegivel(contexto.usoDeArquivosBytes)} de ${tamanhoLegivel(contexto.cotaDeArquivosBytes)}` : '—'}</dd>
                  </div>
                  <div className="fatos__item">
                    <dt className="fatos__rotulo">Brain publicado</dt>
                    <dd>{contexto ? (ROTULO_DO_BRAIN[contexto.brain.situacao] ?? contexto.brain.situacao) : '—'}</dd>
                  </div>
                  {contexto?.brain.exportadoEm ? (
                    <div className="fatos__item">
                      <dt className="fatos__rotulo">Última publicação</dt>
                      <dd>{contexto.brain.exportadoEm.toLocaleString('pt-BR')}</dd>
                    </div>
                  ) : null}
                </dl>
              </MenuMais>
          </div>
        </div>
        {cliente.status !== 'active' ? (
          <div className={`faixa-de-estado faixa-de-estado--${cliente.status}`} role="status">
            <strong>{noVocabularioDe(ctx.organization.type, 'Cliente')} {ROTULO_DA_SITUACAO[cliente.status].toLowerCase()}.</strong> {noVocabularioDe(ctx.organization.type, EFEITO_DA_SITUACAO[cliente.status])}
          </div>
        ) : null}
        {prontidao ? (
          <section className="prontidao" aria-label="Pronto para planejar">
            <span className="prontidao__titulo">Pronto para planejar</span>
            <span className={`pill ${CLASSE_DO_VEREDITO[prontidao.veredito]}`}>
              <Icone nome={prontidao.veredito === 'sim' ? 'ok' : prontidao.veredito === 'parcial' ? 'parcial' : 'nao'} tamanho={14} />
              {ROTULO_DO_VEREDITO[prontidao.veredito]}
            </span>
            {prontidao.veredito !== 'sim' && prontidao.lacunas.length > 0 ? (
              <ul className="prontidao__lacunas" aria-label="O que falta">
                {prontidao.lacunas.map((lacuna) => (
                  <li key={lacuna.id}>{lacuna.titulo}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </header>
      <AbasDoCliente clienteId={cliente.id} blocos={{ conexoes: prontidao?.conexoes ?? null, contexto: prontidao?.contexto ?? null }} />
      <div className="cliente-aba">{children}</div>
    </Shell>
  );
}
