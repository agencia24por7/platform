import Link from 'next/link';
import { CopyButton } from '@/../app/_components/CopyButton';
import { Feedback } from '@/../app/_components/Feedback';
import { Marca } from '@/../app/_components/Marca';
import { pedirAcessoMetaPartner, revogarConviteDeIntegracao } from '@/../app/clientes/[id]/acoes';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { revogarLinkDeContexto } from '@/../app/clientes/[id]/(painel)/acessos/acoes';
import { EnviarMapaDeContexto } from '@/../app/clientes/[id]/(painel)/acessos/EnviarMapaDeContexto';
import { RegenerarLink } from '@/../app/clientes/[id]/(painel)/acessos/RegenerarLink';
import { modules } from '@/composition';
import { CATALOGO } from '@/modules/clients/domain/contexto/catalogo';
import { ROTULO_DA_PLATAFORMA } from '@/modules/connections/domain/connection';
import { enderecoDoConvite } from '@/modules/clients/domain/painel/enderecos';
import { tempoRelativo } from '@/modules/clients/domain/painel/resumo';
import { env } from '@/shared/config/env';

export const dynamic = 'force-dynamic';

const ROTULO_DO_CONVITE: Record<string, string> = {
  pending: 'Pendente',
  completed: 'Concluído',
  expired: 'Expirado',
  revoked: 'Revogado',
};

const ROTULO_DO_LINK: Record<string, string> = { ativo: 'Ativo', expirado: 'Expirado', revogado: 'Revogado' };

export default async function AcessosDoCliente({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente, podeEditar, podeAdministrar, organizacaoInteira } = await carregarPainel(id);
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
  const temConexaoMeta = conexoes.some((c) => c.platform === 'meta' && c.grantType === 'oauth_user' && c.authorizedVia === 'staff');
  const temBusinessManager = organizacao.ok && Boolean(organizacao.value.businessManagerId);
  const conexaoGoogle = conexoes.find((c) => c.platform === 'google' && c.authorizedVia === 'staff');
  const nomeDaSecao = new Map(CATALOGO.map((s) => [s.key, `${s.letra} · ${s.titulo}`]));

  return (
    <div className="pilha acessos">
      <Feedback message={primeiro(busca['erro'])} tone="error" />
      <Feedback message={primeiro(busca['feito'])} tone="ok" />

      <section className="acessos__chamada" aria-label="Pedir algo ao cliente">
        <div>
          <h2 className="card__title">Pedir ao cliente</h2>
          <p className="subtle small">Dois links, sem login: um para conectar contas, outro para contar sobre o negócio. Dá para mandar os dois juntos.</p>
        </div>
        <div className="acessos__botoes">
          {podeAdministrar && organizacaoInteira ? (
            <Link className="btn" href={`/clientes/${cliente.id}/convite/novo`}>
              Convite de integração
            </Link>
          ) : null}
          {podeEditar ? (
            <EnviarMapaDeContexto
              clienteId={cliente.id}
              clienteNome={cliente.name}
              organizacao={ctx.organization.name}
              secoes={CATALOGO.map((s) => ({ key: s.key, letra: s.letra, titulo: s.titulo, descricao: s.descricao }))}
              convites={
                podeAdministrar
                  ? pendentes.map((c) => ({
                      id: c.id,
                      rotulo: `${c.items.map((i) => ROTULO_DA_PLATAFORMA[i.platform]).join(', ')} · vence ${tempoRelativo(c.expiresAt, agora)}`,
                    }))
                  : []
              }
              abrirAoCarregar={primeiro(busca['enviar']) === 'contexto'}
            />
          ) : null}
        </div>
      </section>

      {organizacaoInteira ? (
        <details className="recolhivel" open={pendentes.length > 0 && pendentes.length <= 3}>
          <summary className="recolhivel__resumo">
            <span className="recolhivel__titulo">Convites de integração</span>
            <span className={`pill ${pendentes.length ? 'pill--warn' : ''}`}>{pendentes.length} pendente(s)</span>
          </summary>
          <div className="recolhivel__corpo">
            {pendentes.length === 0 ? (
              <p className="subtle small">Nenhum convite esperando o cliente.</p>
            ) : (
              <ul className="lista-compacta">
                {pendentes.map((convite) => (
                  <li key={convite.id} className="linha-compacta">
                    <span className="linha-compacta__chips">
                      {convite.items.map((item) => (
                        <span key={item.id} className={`chip-plataforma${item.status === 'completed' ? ' chip-plataforma--ok' : ''}`} title={ROTULO_DO_CONVITE[item.status]}>
                          <Marca platform={item.platform} tamanho={14} />
                          {ROTULO_DA_PLATAFORMA[item.platform]}
                          {item.status === 'completed' ? ' ✓' : ''}
                        </span>
                      ))}
                    </span>
                    <span className="subtle xsmall">vence {tempoRelativo(convite.expiresAt, agora)}</span>
                    {podeAdministrar ? (
                      <span className="linha-compacta__acoes">
                        <CopyButton texto={enderecoDoConvite(baseUrl, convite.token)} />
                        <form action={revogarConviteDeIntegracao}>
                          <input type="hidden" name="clientId" value={cliente.id} />
                          <input type="hidden" name="inviteId" value={convite.id} />
                          <button className="btn btn--compacto btn--perigo" type="submit">Revogar</button>
                        </form>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {historico.length + pedidos.length > 0 ? (
              <details className="historico">
                <summary>Ver histórico ({historico.length + pedidos.length})</summary>
                <ul className="lista-compacta lista-compacta--apagada">
                  {historico.map((convite) => (
                    <li key={convite.id} className="linha-compacta">
                      <span>{convite.items.map((i) => ROTULO_DA_PLATAFORMA[i.platform]).join(', ')}</span>
                      <span className="pill">{convite.status === 'pending' ? 'Expirado' : ROTULO_DO_CONVITE[convite.status]}</span>
                      <span className="subtle xsmall">criado {tempoRelativo(convite.createdAt, agora)}</span>
                    </li>
                  ))}
                  {pedidos.map((pedido) => (
                    <li key={pedido.id} className="linha-compacta">
                      <span>Pedido Meta Partner · <span className="mono">{pedido.targetExternalId}</span></span>
                      <span className={`pill ${pedido.status === 'done' ? 'pill--ok' : pedido.status === 'failed' ? 'pill--danger' : 'pill--info'}`}>{pedido.status}</span>
                      <span className="subtle xsmall">{pedido.outcome ?? tempoRelativo(pedido.createdAt, agora)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </details>
      ) : null}

      <details className="recolhivel" open={linksAtivos.length > 0}>
        <summary className="recolhivel__resumo">
          <span className="recolhivel__titulo">Links do mapa de contexto</span>
          <span className={`pill ${linksAtivos.length ? 'pill--info' : ''}`}>{linksAtivos.length} ativo(s)</span>
        </summary>
        <div className="recolhivel__corpo">
          {linksAtivos.length === 0 ? (
            <p className="subtle small">Nenhum link ativo. Use “Enviar mapa de contexto”.</p>
          ) : (
            <ul className="lista-compacta">
              {linksAtivos.map((link) => (
                <li key={link.id} className="linha-compacta linha-compacta--link">
                  <span className="linha-compacta__principal">
                    <span className="strong small">{link.secoes.length} seção(ões)</span>
                    <span className="subtle xsmall">{link.secoes.map((s) => nomeDaSecao.get(s) ?? s).join(', ')}</span>
                  </span>
                  <span className="linha-compacta__meta xsmall">
                    <span>vence {tempoRelativo(link.expiraEm, agora)}</span>
                    <span>{link.ultimoUsoEm ? `aberto ${tempoRelativo(link.ultimoUsoEm, agora)}` : 'ainda não aberto'}</span>
                    {link.concluidoEm ? <span className="pill pill--ok">Enviado pelo cliente</span> : null}
                    {link.conviteDeIntegracaoId ? <span className="pill">com convite</span> : null}
                  </span>
                  {podeEditar ? (
                    <span className="linha-compacta__acoes">
                      <RegenerarLink clienteId={cliente.id} linkId={link.id} />
                      <form action={revogarLinkDeContexto}>
                        <input type="hidden" name="clientId" value={cliente.id} />
                        <input type="hidden" name="linkId" value={link.id} />
                        <button className="btn btn--compacto btn--perigo" type="submit">Revogar</button>
                      </form>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {linksAntigos.length > 0 ? (
            <details className="historico">
              <summary>Ver histórico ({linksAntigos.length})</summary>
              <ul className="lista-compacta lista-compacta--apagada">
                {linksAntigos.map((link) => (
                  <li key={link.id} className="linha-compacta">
                    <span>{link.secoes.length} seção(ões)</span>
                    <span className="pill">{ROTULO_DO_LINK[link.estado]}</span>
                    <span className="subtle xsmall">{link.concluidoEm ? 'enviado pelo cliente · ' : ''}criado {tempoRelativo(link.criadoEm, agora)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </details>

      {podeAdministrar && organizacaoInteira ? (
        <details className="recolhivel">
          <summary className="recolhivel__resumo">
            <span className="recolhivel__titulo">Outros jeitos de pedir acesso</span>
            <span className="subtle xsmall">MCC do Google Ads · parceiro do Meta</span>
          </summary>
          <div className="recolhivel__corpo grade-auto">
            <div className="pilha">
              <div className="strong">Google Ads · administradora (MCC)</div>
              <p className="subtle small">
                Convide a conta do cliente pela sua administradora: o dono aceita direto no Google Ads, sem OAuth com a Orla.
                Depois vincule a conta em “Conectar conta”.
              </p>
              {conexaoGoogle ? (
                <Link className="btn btn--compacto" href={`/integracoes/${conexaoGoogle.id}`}>Ver conexão do Google Ads →</Link>
              ) : (
                <span className="subtle small">Autorize o Google Ads com uma conta administradora primeiro.</span>
              )}
            </div>
            <div className="pilha">
              <div className="strong">Meta Ads · parceiro do Business Manager</div>
              <p className="subtle small">
                Pede acesso à conta de anúncio do cliente com a credencial Meta da agência. O cliente aceita no próprio
                Gerenciador de Negócios. Formato: act_1234567890.
              </p>
              {temConexaoMeta && temBusinessManager ? (
                <form action={pedirAcessoMetaPartner} className="form--inline">
                  <input type="hidden" name="clientId" value={cliente.id} />
                  <input className="input input--compacto" name="contaDeAnuncio" placeholder="act_1234567890" aria-label="Conta de anúncio do cliente" required />
                  <button className="btn btn--compacto" type="submit">Pedir acesso Meta Partner</button>
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
