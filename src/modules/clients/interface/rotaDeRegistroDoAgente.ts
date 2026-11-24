import { NextResponse, type NextRequest } from 'next/server';
import { clienteDaRota, type RegistroDoAgente } from '@/modules/clients/interface/regrasDoWorker';

type RotaDoWorker = (request: NextRequest) => Promise<NextResponse>;

export function rotaDeRegistroDoAgente(montar: (clienteId: string | null) => RotaDoWorker) {
  return async (request: NextRequest, contexto: { params: Promise<Record<string, string | string[]>> }): Promise<NextResponse> => {
    const resposta = await montar(clienteDaRota(await contexto.params))(request);
    if (resposta.status !== 201) return resposta;
    const corpo = (await resposta.clone().json()) as RegistroDoAgente;
    if (!corpo.repetida) return resposta;
    return NextResponse.json(corpo, {
      status: 200,
      headers: { 'X-Request-Id': resposta.headers.get('x-request-id') ?? '' },
    });
  };
}
