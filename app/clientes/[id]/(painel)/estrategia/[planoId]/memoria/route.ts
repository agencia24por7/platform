import { escopoDoClienteNaOrganizacao } from '@/../app/clientes/[id]/_escopo';
import { brainDaPagina } from '@/../app/clientes/[id]/(painel)/estrategia/_brainDoPlano';
import { modules } from '@/composition';
import { idValido } from '@/modules/clients/domain/painel/enderecos';
import { podeVerAEstrategia } from '@/modules/strategy/domain/papeis';
import { memoriaDoPlano, memoriaTemConteudo } from '@/modules/strategy/interface/memoriaDoPlano';
import { memoriaEmMarkdown } from '@/modules/strategy/interface/memoriaEmMarkdown';

export const dynamic = 'force-dynamic';

const CABECALHOS_DE_ERRO = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } as const;
const naoEncontrado = () => new Response('Não encontrado.', { status: 404, headers: CABECALHOS_DE_ERRO });

export async function GET(_pedido: Request, contexto: { readonly params: Promise<{ id: string; planoId: string }> }) {
  const { id, planoId } = await contexto.params;
  const escopo = await escopoDoClienteNaOrganizacao(id);
  if (!escopo || !idValido(planoId)) return naoEncontrado();
  if (!podeVerAEstrategia(escopo.ctx.role)) return new Response('Sem acesso.', { status: 403, headers: CABECALHOS_DE_ERRO });

  const comando = { organizationId: escopo.ctx.organization.id, papelDeQuemAge: escopo.ctx.role };
  const brain = await brainDaPagina(comando, escopo.cliente.id);
  const resultado = await modules().strategy.service.painelDoPlano(
    comando,
    { clienteId: escopo.cliente.id, planoId },
    brain.snapshot === undefined ? {} : { snapshotDoBrain: brain.snapshot },
  );
  const painel = resultado.ok ? (resultado.value.planos[0] ?? null) : null;
  if (painel === null) return naoEncontrado();

  const memoria = memoriaDoPlano({ painel, entradasDoBrain: brain.entradas });
  if (!memoriaTemConteudo(memoria)) return naoEncontrado();

  return new Response(memoriaEmMarkdown(memoria), {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${memoria.nomeDoArquivo}"`,
      ...CABECALHOS_DE_ERRO,
    },
  });
}
