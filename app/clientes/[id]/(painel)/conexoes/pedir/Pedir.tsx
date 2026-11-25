import Link from 'next/link';
import { CopyButton } from '@/../app/_components/CopyButton';
import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import { Marca } from '@/../app/_components/Marca';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { podeVerConviteDeIntegracao } from '@/modules/connections/domain/visibilidadeDoConvite';
import { pedirAcessoMetaPartner, revogarConviteDeIntegracao } from '@/../app/clientes/[id]/acoes';
import { carregarPainel } from '@/../app/clientes/[id]/_dados';
import { revogarLinkDeContexto } from '@/../app/clientes/[id]/(painel)/conexoes/pedir/acoes';
import { PedirAoCliente } from '@/../app/clientes/[id]/(painel)/conexoes/pedir/PedirAoCliente';
import { RegenerarLink } from '@/../app/clientes/[id]/(painel)/conexoes/pedir/RegenerarLink';
import { modules } from '@/composition';
import { CATALOGO } from '@/modules/clients/domain/contexto/catalogo';
import { ROTULO_DA_PLATAFORMA } from '@/modules/connections/domain/connection';
import { PLATAFORMAS_CONVIDAVEIS } from '@/modules/connections/domain/integrationInvite';
import { enderecoDoConvite } from '@/modules/clients/domain/painel/enderecos';
import { tempoRelativo } from '@/modules/clients/domain/painel/resumo';
import { vocabularioDe } from '@/modules/organizations/domain/vocabulario';
import { env } from '@/shared/config/env';

const ROTULO_DO_CONVITE: Record<string, string> = {
  pending: 'Pendente',
  completed: 'Concluído',
  expired: 'Expirado',
  revoked: 'Revogado',
};

const ROTULO_DO_PEDIDO: Record<string, { readonly rotulo: string; readonly classe: string }> = {
  done: { rotulo: 'Concluído', classe: 'pill--ok' },
  failed: { rotulo: 'Falhou', classe: 'pill--danger' },
};
const PEDIDO_EM_ANDAMENTO = { rotulo: 'Em andamento', classe: 'pill--info' };

function secoesPorExtenso(total: number): string {
  return `${total} ${total === 1 ? 'seção' : 'seções'}`;
}

const ROTULO_DO_LINK: Record<string, string> = { ativo: 'Ativo', expirado: 'Expirado', revogado: 'Revogado' };

export async function Pedir({ clienteId, abrirMapa }: { readonly clienteId: string; readonly abrirMapa: boolean }) {
  const { ctx, cliente, podeEditar, podeAdministrar, organizacaoInteira } = await carregarPainel(clienteId);
  const vocabulario = vocabularioDe(ctx.organization.type);
  const escopo = { organizationId: ctx.organization.id, clientId: cliente.id };
  const [convites, pedidos, links, organizacao, conexoes] = await Promise.all([
    organizacaoInteira ? modules().connectionInvites.listByClient(escopo.organizationId, cliente.id) : Promise.resolve([]),
    organizacaoInteira ? modules().tasks.listByClient(escopo.organizationId, cliente.id) : Promise.resolve([]),
    modules().contexto.listarLinks(escopo),
    modules().organizations.byId(escopo.organizationId),
    modules().connections.listConnections(escopo.organizationId),
  ]);
  const agora = new Date();
  const baseUrl = env().TRIA_APP_BASE_URL;
  const pendentes = convites.filter((c) => c.status === 'pending' && c.expiresAt > agora);
  const historico = convites.filter((c) => !pendentes.includes(c));
  const linksAtivos = links.ok ? links.value.filter((l) => l.estado === 'ativo') : [];
  const linksAntigos = links.ok ? links.value.filter((l) => l.estado !== 'ativo') : [];
  const totalPendente = pendentes.length + linksAtivos.length;
  const temConexaoMeta = conexoes.some((c) => c.platform === 'meta' && c.grantType === 'oauth_user' && c.authorizedVia === 'staff');
  const temBusinessManager = organizacao.ok && Boolean(organizacao.value.businessManagerId);
  const conexaoGoogle = conexoes.find((c) => c.platform === 'google' && c.authorizedVia === 'staff');
  const nomeDaSecao = new Map(CATALOGO.map((s) => [s.key, `${s.letra} · ${s.titulo}`]));
  const veConvites = podeVerConviteDeIntegracao(podeAdministrar, ctx.clientIds);
  const plataformasConvidaveis = podeAdministrar && organizacaoInteira ? PLATAFORMAS_CONVIDAVEIS.map((p) => ({ platform: p, rotulo: ROTULO_DA_PLATAFORMA[p] })) : [];

  const blocoDoHistorico = (
    <>
          {historico.length + pedidos.length + linksAntigos.length > 0 ? (
            <details className="historico">
              <summary>Ver histórico ({historico.length + pedidos.length + linksAntigos.length})</summary>
              <ul className="lista-compacta lista-compacta--apagada">
                {historico.map((convite) => (
                  <li key={convite.id} className="linha-compacta">
                    <span>{convite.items.map((i) => ROTULO_DA_PLATAFORMA[i.platform]).join(', ')}</span>
                    <span className="pill">{convite.status === 'pending' ? 'Expirado' : ROTULO_DO_CONVITE[convite.status]}</span>
                    <span className="subtle xsmall">criado {tempoRelativo(convite.createdAt, agora)}</span>
                  </li>
                ))}
                {linksAntigos.map((link) => (
                  <li key={link.id} className="linha-compacta">
                    <span>Contexto · {secoesPorExtenso(link.secoes.length)}</span>
                    <span className="pill">{ROTULO_DO_LINK[link.estado]}</span>
                    <span className="subtle xsmall">{link.concluidoEm ? 'enviado · ' : ''}criado {tempoRelativo(link.criadoEm, agora)}</span>
                  </li>
                ))}
                {pedidos.map((pedido) => (
                  <li key={pedido.id} className="linha-compacta">
                    <span>
                      Pedido Meta Partner · <span className="mono">{pedido.targetExternalId}</span>
                    </span>
                    <span className={`pill ${(ROTULO_DO_PEDIDO[pedido.status] ?? PEDIDO_EM_ANDAMENTO).classe}`}>{(ROTULO_DO_PEDIDO[pedido.status] ?? PEDIDO_EM_ANDAMENTO).rotulo}</span>
                    <span className="subtle xsmall">{pedido.outcome ?? tempoRelativo(pedido.createdAt, agora)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
    </>
  );

  return (
    <div className="pilha acessos">
      <section className="acessos__chamada" aria-label={vocabulario.rotuloDePedir}>
        <CabecalhoDeSecao
          titulo={vocabulario.rotuloDePedir}
          descricao="Um link só, sem login: escolha as plataformas e inclua o contexto."
          acao={
            podeEditar ? (
            <PedirAoCliente
              rotulo={vocabulario.rotuloDePedir}
              tipo={ctx.organization.type}
              clienteId={cliente.id}
              clienteNome={cliente.name}
              organizacao={ctx.organization.name}
              secoes={CATALOGO.map((s) => ({ key: s.key, letra: s.letra, titulo: s.titulo, descricao: s.descricao }))}
              convites={
                veConvites
                  ? pendentes.map((c) => ({
                      id: c.id,
                      rotulo: `${c.items.map((i) => ROTULO_DA_PLATAFORMA[i.platform]).join(', ')} · vence ${tempoRelativo(c.expiresAt, agora)}`,
                    }))
                  : []
              }
              plataformas={plataformasConvidaveis}
              abrirAoCarregar={abrirMapa}
            />
            ) : null
          }
        />
      </section>

      {totalPendente === 0 ? (
        <div className="pilha">
          <p className="subtle small">Nada esperando resposta.</p>
          {blocoDoHistorico}
        </div>
      ) : (
      <details className="recolhivel" open>
        <summary className="recolhivel__resumo">
          <span className="recolhivel__titulo">Pendentes</span>
          <span className={`pill ${totalPendente ? 'pill--warn' : ''}`}>{totalPendente}</span>
        </summary>
        <div className="recolhivel__corpo">
          {pendentes.length > 0 ? (
            <ul className="lista-compacta">
              {pendentes.map((convite) => (
                <li key={convite.id} className="linha-compacta">
                  <span className="linha-compacta__chips">
                    {convite.items.map((item) => (
                      <span key={item.id} className={`chip-plataforma${item.status === 'completed' ? ' chip-plataforma--ok' : ''}`} title={ROTULO_DO_CONVITE[item.status]}>
                        <Marca platform={item.platform} tamanho={14} />
                        {ROTULO_DA_PLATAFORMA[item.platform]}
                        {item.status === 'completed' ? (
                          <>
                            {' '}
                            <Icone nome="ok" tamanho={12} /> concluído
                          </>
                        ) : null}
                      </span>
                    ))}
                  </span>
                  <span className="subtle xsmall">vence {tempoRelativo(convite.expiresAt, agora)}</span>
                  {veConvites ? (
                    <span className="linha-compacta__acoes">
                      <CopyButton texto={enderecoDoConvite(baseUrl, convite.token)} />
                      <ConfirmarAcao
                        gatilho="Revogar"
                        titulo="Revogar este convite?"
                        descricao="O link deixa de funcionar e quem o recebeu não consegue mais conectar por ele."
                        confirmar="Revogar"
                        action={revogarConviteDeIntegracao}
                      >
                        <input type="hidden" name="clientId" value={cliente.id} />
                        <input type="hidden" name="inviteId" value={convite.id} />
                      </ConfirmarAcao>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {linksAtivos.length > 0 ? (
            <ul className="lista-compacta">
              {linksAtivos.map((link) => (
                <li key={link.id} className="linha-compacta linha-compacta--link">
                  <span className="linha-compacta__principal">
                    <span className="strong small">Contexto · {secoesPorExtenso(link.secoes.length)}</span>
                    <span className="subtle xsmall">{link.secoes.map((s) => nomeDaSecao.get(s) ?? s).join(', ')}</span>
                  </span>
                  <span className="linha-compacta__meta xsmall">
                    <span>vence {tempoRelativo(link.expiraEm, agora)}</span>
                    <span>{link.ultimoUsoEm ? `aberto ${tempoRelativo(link.ultimoUsoEm, agora)}` : 'ainda não aberto'}</span>
                    {link.concluidoEm ? <span className="pill pill--ok">Enviado</span> : null}
                    {link.conviteDeIntegracaoId ? <span className="pill">com convite</span> : null}
                  </span>
                  {podeEditar ? (
                    <span className="linha-compacta__acoes">
                      <RegenerarLink clienteId={cliente.id} linkId={link.id} />
                      <ConfirmarAcao
                        gatilho="Revogar"
                        titulo="Revogar este link?"
                        descricao="O link deixa de abrir para quem o recebeu."
                        confirmar="Revogar"
                        action={revogarLinkDeContexto}
                      >
                        <input type="hidden" name="clientId" value={cliente.id} />
                        <input type="hidden" name="linkId" value={link.id} />
                      </ConfirmarAcao>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {blocoDoHistorico}
        </div>
      </details>
      )}

      {podeAdministrar && organizacaoInteira ? (
        <details className="recolhivel">
          <summary className="recolhivel__resumo">
            <span className="recolhivel__titulo">Outros jeitos</span>
            <span className="subtle xsmall">MCC do Google Ads · parceiro do Meta</span>
          </summary>
          <div className="recolhivel__corpo grade-auto">
            <div className="pilha">
              <div className="strong">Google Ads · administradora (MCC)</div>
              <p className="subtle small">O dono aceita o convite direto no Google Ads, sem OAuth com a Orla. Depois vincule a conta em “Conectar conta”.</p>
              {conexaoGoogle ? (
                <Link className="btn btn--compacto" href={`/integracoes/${conexaoGoogle.id}`}>
                  Ver conexão do Google Ads →
                </Link>
              ) : (
                <span className="subtle small">Autorize o Google Ads com uma conta administradora primeiro.</span>
              )}
            </div>
            <div className="pilha">
              <div className="strong">Meta Ads · parceiro do Business Manager</div>
              <p className="subtle small">O aceite é no Gerenciador de Negócios. Formato: act_1234567890.</p>
              {temConexaoMeta && temBusinessManager ? (
                <form action={pedirAcessoMetaPartner} className="form--inline">
                  <input type="hidden" name="clientId" value={cliente.id} />
                  <input className="input input--compacto" name="contaDeAnuncio" placeholder="act_1234567890" aria-label="Conta de anúncio" required />
                  <button className="btn btn--compacto" type="submit">
                    Pedir acesso Meta Partner
                  </button>
                </form>
              ) : (
                <span className="subtle small">Autorize o Meta Ads com uma conta administradora do Business Manager para liberar o pedido.</span>
              )}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
