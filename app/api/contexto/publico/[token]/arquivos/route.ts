import { headers } from 'next/headers';
import { lerAnexo, mesmaOrigem, responderErro, responderFalha, responderOk } from '@/../app/api/contexto/_upload';
import { modules } from '@/composition';
import { enderecoConfiavel } from '@/modules/audit/domain/actor';
import { requestId } from '@/shared/http/actions';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!mesmaOrigem(request)) return responderErro(403, 'Origem não permitida.');
  const tipo = request.headers.get('x-credencial') === 'convite' ? 'convite' : 'link';

  const lido = await lerAnexo(request);
  if (!lido.ok) return lido.resposta;

  const resultado = await modules().contexto.anexarArquivoPeloLink(
    {
      credencial: { tipo, token },
      ip: enderecoConfiavel((await headers()).get('x-forwarded-for')),
      requestId: requestId(),
    },
    lido.anexo,
  );
  if (!resultado.ok) return responderFalha(resultado.error);
  return responderOk({
    arquivo: { id: resultado.value.id, fieldKey: lido.anexo.fieldKey, itemId: lido.anexo.itemId ?? null, nome: lido.anexo.nome, mime: lido.anexo.mime, tamanhoBytes: lido.anexo.conteudo.byteLength },
  });
}
