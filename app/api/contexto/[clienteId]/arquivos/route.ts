import {
  comVagaDeEnvio,
  descartarCorpo,
  leitorDoCorpo,
  lerPedido,
  mesmaOrigem,
  responderErro,
  responderFalha,
  responderOk,
} from '@/../app/api/contexto/_upload';
import { modules } from '@/composition';
import { clienteNoEscopo } from '@/../app/clientes/[id]/_escopo';
import { atorAtual } from '@/shared/http/ator';
import { activeContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  if (!mesmaOrigem(request)) {
    descartarCorpo(request);
    return responderErro(403, 'Origem não permitida.');
  }
  const ctx = await activeContext();
  if (!ctx) {
    descartarCorpo(request);
    return responderErro(401, 'Sua sessão expirou. Entre de novo.');
  }
  if (!(await clienteNoEscopo(ctx, clienteId))) {
    descartarCorpo(request);
    return responderErro(404, 'Cliente não encontrado.');
  }

  const lido = lerPedido(request);
  if (!lido.ok) {
    descartarCorpo(request);
    return lido.resposta;
  }

  return comVagaDeEnvio(request, async () => {
    const resultado = await modules().contexto.anexarArquivo(
      { organizationId: ctx.organization.id, clientId: clienteId, papelDeQuemAge: ctx.role, ...lido.pedido },
      leitorDoCorpo(request),
      await atorAtual(),
    );
    if (!resultado.ok) {
      descartarCorpo(request);
      return responderFalha(resultado.error);
    }
    const a = resultado.value;
    return responderOk({
      arquivo: { id: a.id, fieldKey: a.fieldKey, itemId: a.itemId, nome: a.nome, mime: a.mime, tamanhoBytes: a.tamanhoBytes, criadoEm: a.criadoEm.toISOString() },
    });
  });
}
