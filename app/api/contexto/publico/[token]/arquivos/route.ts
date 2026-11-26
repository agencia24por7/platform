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
import { enderecoDoCliente } from '@/shared/http/enderecoDoCliente';
import { requestId } from '@/shared/http/actions';
import { comRequestId } from '@/shared/http/comRequestId';
import { entradaPublica } from '@/shared/http/entradaPublica';

export const dynamic = 'force-dynamic';

async function tratarPost(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const id = await requestId();
  return comRequestId(id, receberArquivo(request, params, id));
}

async function receberArquivo(request: Request, params: Promise<{ token: string }>, id: string) {
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
        ip: enderecoDoCliente(await headers()),
        requestId: id,
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

export const POST = entradaPublica(tratarPost);
