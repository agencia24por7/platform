import { CopyButton } from '@/../app/_components/CopyButton';
import { Marca } from '@/../app/_components/Marca';
import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import { EstadoVazio } from '@/../app/clientes/[id]/_componentes/EstadoVazio';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { Indicador } from '@/../app/clientes/[id]/_componentes/Indicador';
import { carregarPainel } from '@/../app/clientes/[id]/_dados';
import { revogarConviteDeIntegracao } from '@/../app/clientes/[id]/acoes';
import { revogarLinkDeContexto } from '@/../app/clientes/[id]/(painel)/conexoes/pedir/acoes';
import { RegenerarLink } from '@/../app/clientes/[id]/(painel)/conexoes/pedir/RegenerarLink';
import { modules } from '@/composition';
import { CATALOGO } from '@/modules/clients/domain/contexto/catalogo';
import { traduzirCatalogo } from '@/modules/clients/domain/contexto/vocabulario';
import { visaoDosPedidos } from '@/modules/clients/domain/painel/atividade';
import { ancoraDaAtividade, enderecoDoConvite, ROTULO_DA_SECAO_DE_ATIVIDADE } from '@/modules/clients/domain/painel/enderecos';
import { podeVerConviteDeIntegracao } from '@/modules/connections/domain/visibilidadeDoConvite';
import { env } from '@/shared/config/env';

export async function PedidosAoCliente({ clienteId }: { readonly clienteId: string }) {
  const { ctx, cliente, podeEditar, podeAdministrar, organizacaoInteira } = await carregarPainel(clienteId);
  const escopo = { organizationId: ctx.organization.id, clientId: cliente.id };
  const [convites, pedidosDeParceiro, links] = await Promise.all([
    organizacaoInteira ? modules().connectionInvites.listByClient(escopo.organizationId, cliente.id) : Promise.resolve([]),
    organizacaoInteira ? modules().tasks.listByClient(escopo.organizationId, cliente.id) : Promise.resolve([]),
    modules().contexto.listarLinks(escopo),
  ]);
  const nomeDaSecao = new Map<string, string>(traduzirCatalogo(CATALOGO, ctx.organization.type).map((s) => [s.key, `${s.letra} · ${s.titulo}`]));
  const visao = visaoDosPedidos(
    { convites, links: links.ok ? links.value : [], pedidosDeParceiro, nomeDaSecao: (chave) => nomeDaSecao.get(chave) ?? chave },
    new Date(),
  );
  const veConvites = podeVerConviteDeIntegracao(podeAdministrar, ctx.clientIds);
  const baseUrl = env().TRIA_APP_BASE_URL;
  const ancora = ancoraDaAtividade('pedidos');

  return (
    <section className="pilha atividade-secao" aria-labelledby={`${ancora}-titulo`} id={ancora}>
      <CabecalhoDeSecao
        id={`${ancora}-titulo`}
        titulo={ROTULO_DA_SECAO_DE_ATIVIDADE.pedidos}
        descricao={visao.descricao}
      />
      {!links.ok ? <div className="alert alert--error">Não foi possível carregar os links de contexto agora.</div> : null}

      {visao.convitesPendentes.length + visao.linksAtivos.length > 0 ? (
        <ul className="lista-compacta" aria-label="Pendentes">
          {visao.convitesPendentes.map((convite) => (
            <li key={convite.id} className="linha-compacta">
              <span className="linha-compacta__chips">
                {convite.plataformas.map((item) => (
                  <span key={item.id} className={`chip-plataforma${item.concluida ? ' chip-plataforma--ok' : ''}`} title={item.estado}>
                    <Marca platform={item.platform} tamanho={14} />
                    {item.rotulo}
                    {item.concluida ? (
                      <>
                        {' '}
                        <Icone nome="ok" tamanho={12} /> concluído
                      </>
                    ) : null}
                  </span>
                ))}
              </span>
              <span className="subtle xsmall">{convite.vence}</span>
              {veConvites ? (
                <span className="linha-compacta__acoes">
                  <CopyButton texto={enderecoDoConvite(baseUrl, convite.token)} />
                  <ConfirmarAcao
                    gatilho="Revogar"
                    titulo="Revogar este convite?"
                    descricao="O link deixa de funcionar e quem o recebeu não consegue mais conectar por ele."
                    confirmar="Revogar"
                    pendente="Revogando…"
                    action={revogarConviteDeIntegracao}
                  >
                    <input type="hidden" name="clientId" value={cliente.id} />
                    <input type="hidden" name="inviteId" value={convite.id} />
                  </ConfirmarAcao>
                </span>
              ) : null}
            </li>
          ))}
          {visao.linksAtivos.map((link) => (
            <li key={link.id} className="linha-compacta linha-compacta--link">
              <span className="linha-compacta__principal">
                <span className="strong small">{link.titulo}</span>
                <span className="subtle xsmall">{link.secoes}</span>
              </span>
              <span className="linha-compacta__meta xsmall">
                <span>{link.vence}</span>
                <span>{link.uso}</span>
                {link.enviado ? <Indicador tom="ok" rotulo="Enviado" icone="ok" /> : null}
                {link.comConvite ? <span className="pill">com convite</span> : null}
              </span>
              {podeEditar ? (
                <span className="linha-compacta__acoes">
                  <RegenerarLink clienteId={cliente.id} linkId={link.id} />
                  <ConfirmarAcao
                    gatilho="Revogar"
                    titulo="Revogar este link?"
                    descricao="O link deixa de abrir para quem o recebeu."
                    confirmar="Revogar"
                    pendente="Revogando…"
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

      {visao.historico.length > 0 ? (
        <details className="historico">
          <summary>Ver histórico ({visao.historico.length})</summary>
          <ul className="lista-compacta lista-compacta--apagada">
            {visao.historico.map((item) => (
              <li key={item.chave} className="linha-compacta">
                <span>
                  {item.titulo}
                  {item.detalhe ? (
                    <>
                      {' · '}
                      <span className="mono">{item.detalhe}</span>
                    </>
                  ) : null}
                </span>
                <Indicador tom={item.estado.tom} rotulo={item.estado.rotulo} />
                <span className="subtle xsmall">{item.quando}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : visao.totalPendente === 0 ? (
        <EstadoVazio titulo="Nenhum pedido ainda" />
      ) : null}
    </section>
  );
}
