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
import { idValido } from '@/modules/clients/domain/painel/enderecos';
import { requestId } from '@/shared/http/actions';
import { comRequestId } from '@/shared/http/comRequestId';
import { atorAtual } from '@/shared/http/ator';
import { activeContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ clienteId: string }> }) {
  const id = await requestId();
  return comRequestId(id, receberArquivo(request, params, id));
}

async function receberArquivo(request: Request, params: Promise<{ clienteId: string }>, id: string) {
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
  if (!idValido(clienteId) || (ctx.clientIds !== null && !ctx.clientIds.includes(clienteId))) {
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
      { ...(await atorAtual()), requestId: id },
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
