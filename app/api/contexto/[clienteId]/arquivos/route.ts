import { lerAnexo, mesmaOrigem, responderErro, responderFalha, responderOk } from '@/../app/api/contexto/_upload';
import { modules } from '@/composition';
import { idValido } from '@/modules/clients/domain/painel/enderecos';
import { atorAtual } from '@/shared/http/ator';
import { activeContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ clienteId: string }> }) {
  const { clienteId } = await params;
  if (!mesmaOrigem(request)) return responderErro(403, 'Origem não permitida.');
  const ctx = await activeContext();
  if (!ctx) return responderErro(401, 'Sua sessão expirou. Entre de novo.');
  if (!idValido(clienteId) || (ctx.clientIds !== null && !ctx.clientIds.includes(clienteId))) {
    return responderErro(404, 'Cliente não encontrado.');
  }

  const lido = await lerAnexo(request);
  if (!lido.ok) return lido.resposta;

  const resultado = await modules().contexto.anexarArquivo(
    { organizationId: ctx.organization.id, clientId: clienteId, papelDeQuemAge: ctx.role, ...lido.anexo },
    await atorAtual(),
  );
  if (!resultado.ok) return responderFalha(resultado.error);
  const a = resultado.value;
  return responderOk({
    arquivo: { id: a.id, fieldKey: a.fieldKey, itemId: a.itemId, nome: a.nome, mime: a.mime, tamanhoBytes: a.tamanhoBytes, criadoEm: a.criadoEm.toISOString() },
  });
}
