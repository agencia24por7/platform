import { escopoDoClienteNaOrganizacao } from '@/../app/clientes/[id]/_escopo';
import { modules } from '@/composition';
import { idValido } from '@/modules/clients/domain/painel/enderecos';
import { podeVerAEstrategia } from '@/modules/strategy/domain/papeis';
import { planoDeProducaoEmMarkdown, visaoDoPlanoDeProducao } from '@/modules/strategy/interface/planoDeProducao';

export const dynamic = 'force-dynamic';

const CABECALHOS = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } as const;
const naoEncontrado = () => new Response('Não encontrado.', { status: 404, headers: CABECALHOS });

export async function GET(pedido: Request, contexto: { readonly params: Promise<{ id: string; planoId: string }> }) {
  const { id, planoId } = await contexto.params;
  const producaoId = new URL(pedido.url).searchParams.get('geracao') ?? '';
  const escopo = await escopoDoClienteNaOrganizacao(id);
  if (!escopo || !idValido(planoId) || !idValido(producaoId)) return naoEncontrado();
  if (!podeVerAEstrategia(escopo.ctx.role)) return new Response('Sem acesso.', { status: 403, headers: CABECALHOS });

  const comando = { organizationId: escopo.ctx.organization.id, papelDeQuemAge: escopo.ctx.role };
  const lida = await modules().strategy.producao.geracao(comando, { clienteId: escopo.cliente.id, planoId, producaoId });
  if (!lida.ok || lida.value.conteudo === null) return naoEncontrado();

  const visao = visaoDoPlanoDeProducao({
    clienteId: escopo.cliente.id,
    planoId,
    papel: escopo.ctx.role,
    temVersaoAutorizada: false,
    planoDeMarketing: lida.value.planoDeMarketing,
    geracoes: [{ registro: lida.value.registro, conteudo: lida.value.conteudo }],
  });
  if (visao.atual === null || visao.atual.geracao.download === null) return naoEncontrado();

  const titulo = lida.value.planoDeMarketing?.resumo_executivo.objetivo ?? 'plano';
  return new Response(planoDeProducaoEmMarkdown({ tituloDoPlano: titulo, geracao: visao.atual.geracao, janela: visao.atual.janela, campanhas: visao.atual.campanhas }), {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${visao.atual.geracao.download.nomeDoArquivo}"`,
      ...CABECALHOS,
    },
  });
}
