import { carregarPainel } from '@/../app/clientes/[id]/_dados';
import { PedirAoCliente } from '@/../app/clientes/[id]/(painel)/conexoes/pedir/PedirAoCliente';
import { modules } from '@/composition';
import { CATALOGO } from '@/modules/clients/domain/contexto/catalogo';
import { conviteEstaPendente, rotuloDoConvitePendente } from '@/modules/clients/domain/painel/atividade';
import { ROTULO_DA_PLATAFORMA } from '@/modules/connections/domain/connection';
import { PLATAFORMAS_CONVIDAVEIS } from '@/modules/connections/domain/integrationInvite';
import { podeVerConviteDeIntegracao } from '@/modules/connections/domain/visibilidadeDoConvite';
import { vocabularioDe } from '@/modules/organizations/domain/vocabulario';

export async function Pedir({ clienteId, abrirMapa }: { readonly clienteId: string; readonly abrirMapa: boolean }) {
  const { ctx, cliente, podeEditar, podeAdministrar, organizacaoInteira } = await carregarPainel(clienteId);
  if (!podeEditar) return null;
  const vocabulario = vocabularioDe(ctx.organization.type);
  const veConvites = podeVerConviteDeIntegracao(podeAdministrar, ctx.clientIds);
  const convites = veConvites && organizacaoInteira ? await modules().connectionInvites.listByClient(ctx.organization.id, cliente.id) : [];
  const agora = new Date();

  return (
    <PedirAoCliente
      rotulo={vocabulario.rotuloDePedir}
      tipo={ctx.organization.type}
      clienteId={cliente.id}
      clienteNome={cliente.name}
      organizacao={ctx.organization.name}
      secoes={CATALOGO.map((s) => ({ key: s.key, letra: s.letra, titulo: s.titulo, descricao: s.descricao }))}
      convites={convites.filter((c) => conviteEstaPendente(c, agora)).map((c) => ({ id: c.id, rotulo: rotuloDoConvitePendente(c, agora) }))}
      plataformas={podeAdministrar && organizacaoInteira ? PLATAFORMAS_CONVIDAVEIS.map((p) => ({ platform: p, rotulo: ROTULO_DA_PLATAFORMA[p] })) : []}
      abrirAoCarregar={abrirMapa}
    />
  );
}
