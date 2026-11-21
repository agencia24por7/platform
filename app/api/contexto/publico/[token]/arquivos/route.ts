import { headers } from 'next/headers';
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
import { enderecoConfiavel } from '@/modules/audit/domain/actor';
import { requestId } from '@/shared/http/actions';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!mesmaOrigem(request)) {
    descartarCorpo(request);
    return responderErro(403, 'Origem não permitida.');
  }
  const tipo = request.headers.get('x-credencial') === 'convite' ? 'convite' : 'link';

  const lido = lerPedido(request);
  if (!lido.ok) {
    descartarCorpo(request);
    return lido.resposta;
  }

  return comVagaDeEnvio(request, async () => {
    const resultado = await modules().contexto.anexarArquivoPeloLink(
      {
        credencial: { tipo, token },
        ip: enderecoConfiavel((await headers()).get('x-forwarded-for')),
        requestId: requestId(),
      },
      lido.pedido,
      leitorDoCorpo(request),
    );
    if (!resultado.ok) {
      descartarCorpo(request);
      return responderFalha(resultado.error);
    }
    const p = lido.pedido;
    return responderOk({
      arquivo: { id: resultado.value.id, fieldKey: p.fieldKey, itemId: p.itemId, nome: p.nome, mime: resultado.value.mime, tamanhoBytes: p.tamanhoDeclarado },
    });
  });
}
