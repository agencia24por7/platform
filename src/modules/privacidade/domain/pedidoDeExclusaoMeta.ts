import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ALGORITMO_DO_SIGNED_REQUEST = 'HMAC-SHA256';
export const JANELA_DE_EMISSAO_SEGUNDOS = 24 * 60 * 60;
export const TOLERANCIA_DE_RELOGIO_SEGUNDOS = 5 * 60;
export const TAMANHO_MAXIMO_DO_SIGNED_REQUEST = 4_096;

export type MotivoDeRecusa =
  | 'formato_invalido'
  | 'assinatura_invalida'
  | 'algoritmo_invalido'
  | 'usuario_invalido'
  | 'emitido_fora_da_janela';

export type LeituraDoSignedRequest =
  | { readonly ok: true; readonly usuarioDaMeta: string }
  | { readonly ok: false; readonly motivo: MotivoDeRecusa };

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const USUARIO_DA_META = /^[0-9]{1,32}$/;

const decodificar = (parte: string): Buffer => Buffer.from(parte, 'base64url');

export function lerSignedRequest(signedRequest: string, segredoDoApp: string, agoraEmSegundos: number): LeituraDoSignedRequest {
  if (signedRequest.length === 0 || signedRequest.length > TAMANHO_MAXIMO_DO_SIGNED_REQUEST) {
    return { ok: false, motivo: 'formato_invalido' };
  }
  const partes = signedRequest.split('.');
  if (partes.length !== 2 || !partes.every((parte) => BASE64URL.test(parte))) return { ok: false, motivo: 'formato_invalido' };
  const [assinaturaCodificada, cargaCodificada] = partes as [string, string];

  const recebida = decodificar(assinaturaCodificada);
  const esperada = createHmac('sha256', segredoDoApp).update(cargaCodificada).digest();
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    return { ok: false, motivo: 'assinatura_invalida' };
  }

  let carga: { algorithm?: unknown; user_id?: unknown; issued_at?: unknown };
  try {
    carga = JSON.parse(decodificar(cargaCodificada).toString('utf8')) as typeof carga;
  } catch {
    return { ok: false, motivo: 'formato_invalido' };
  }
  if (typeof carga !== 'object' || carga === null) return { ok: false, motivo: 'formato_invalido' };

  if (typeof carga.algorithm !== 'string' || carga.algorithm.toUpperCase() !== ALGORITMO_DO_SIGNED_REQUEST) {
    return { ok: false, motivo: 'algoritmo_invalido' };
  }

  const usuario = typeof carga.user_id === 'number' ? String(carga.user_id) : carga.user_id;
  if (typeof usuario !== 'string' || !USUARIO_DA_META.test(usuario)) return { ok: false, motivo: 'usuario_invalido' };

  const emitidoEm = carga.issued_at;
  if (
    typeof emitidoEm !== 'number' ||
    !Number.isFinite(emitidoEm) ||
    emitidoEm > agoraEmSegundos + TOLERANCIA_DE_RELOGIO_SEGUNDOS ||
    emitidoEm < agoraEmSegundos - JANELA_DE_EMISSAO_SEGUNDOS
  ) {
    return { ok: false, motivo: 'emitido_fora_da_janela' };
  }

  return { ok: true, usuarioDaMeta: usuario };
}

export function pseudonimoDoUsuarioDaMeta(usuarioDaMeta: string, pimenta: string): string {
  return createHmac('sha256', pimenta).update(`meta-exclusao:${usuarioDaMeta}`).digest('hex');
}

export const CODIGO_DE_CONFIRMACAO = /^[A-Z0-9]{16,64}$/;

export function novoCodigoDeConfirmacao(): string {
  return randomBytes(12).toString('hex').toUpperCase();
}
