import { err, ok, type Result } from '@/shared/result/result';
import { META_GRAPH_BASE } from '@/modules/connections/domain/metaGraphVersion';
import { longLivedExchangeRequest, usaOauthDaMeta, usaOauthDoGoogle, falaOauth } from '@/modules/connections/domain/oauth';
import type { ProviderCredentials } from '@/modules/connections/domain/oauth';
import type { Platform } from '@/modules/connections/domain/connection';
import type { TipoDeSegredo } from '@/modules/tokens/domain/token';
import type {
  FabricaDeProvedores,
  FalhaDoProvedor,
  NaturezaDaFalha,
  ProvedorDeToken,
  Renovacao,
  ResultadoDaRevogacao,
} from '@/modules/tokens/application/portas';

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const META_PERMISSIONS_URL = `${META_GRAPH_BASE}/me/permissions`;

const TEMPO_LIMITE_MS = 10_000;
const VALIDADE_PADRAO_DA_META_MS = 60 * 86_400_000;
const CODIGOS_META_DE_REAUTORIZACAO = new Set([102, 190, 463, 467]);
const CODIGOS_META_TRANSITORIOS = new Set([1, 2, 4, 17, 32, 341, 613]);
const CODIGOS_META_DE_CONFIGURACAO = new Set([101]);
const ERROS_GOOGLE_DE_CONFIGURACAO = new Set(['invalid_client', 'unauthorized_client', 'invalid_request', 'unsupported_grant_type']);

export type Buscar = (url: string, init: RequestInit) => Promise<Response>;
export type Credenciais = (platform: Platform) => ProviderCredentials;

type Resposta = { readonly status: number; readonly corpo: Record<string, unknown> | null };

const falha = (natureza: NaturezaDaFalha, codigo: string): FalhaDoProvedor => ({ natureza, codigo });

async function chamar(buscar: Buscar, url: string, init: RequestInit): Promise<Result<Resposta, FalhaDoProvedor>> {
  let resposta: Response;
  try {
    resposta = await buscar(url, { ...init, signal: AbortSignal.timeout(TEMPO_LIMITE_MS), redirect: 'error', cache: 'no-store' });
  } catch {
    return err(falha('transitoria', 'rede'));
  }
  const texto = await resposta.text().catch(() => '');
  let corpo: Record<string, unknown> | null = null;
  try {
    const lido = texto.length > 0 ? (JSON.parse(texto) as unknown) : null;
    corpo = lido !== null && typeof lido === 'object' ? (lido as Record<string, unknown>) : null;
  } catch {
    corpo = null;
  }
  return ok({ status: resposta.status, corpo });
}

function expiracao(corpo: Record<string, unknown>, agora: number, padraoMs: number | null): Date | null {
  const segundos = corpo.expires_in;
  if (typeof segundos === 'number' && Number.isFinite(segundos) && segundos > 0) return new Date(agora + segundos * 1000);
  if (typeof segundos === 'string' && /^\d+$/.test(segundos)) return new Date(agora + Number(segundos) * 1000);
  return padraoMs === null ? null : new Date(agora + padraoMs);
}

export function classificarErroGoogle(status: number, corpo: Record<string, unknown> | null): FalhaDoProvedor {
  if (status === 429 || status >= 500) return falha('transitoria', `http_${status}`);
  const codigo = typeof corpo?.error === 'string' ? corpo.error : '';
  if (codigo === 'invalid_grant') return falha('reautorizar', 'invalid_grant');
  if (ERROS_GOOGLE_DE_CONFIGURACAO.has(codigo)) return falha('configuracao', codigo);
  if (status === 401 || status === 403) return falha('reautorizar', `http_${status}`);
  return falha('transitoria', `http_${status}`);
}

export function classificarErroMeta(status: number, corpo: Record<string, unknown> | null): FalhaDoProvedor {
  const erro = corpo?.error !== null && typeof corpo?.error === 'object' ? (corpo.error as Record<string, unknown>) : null;
  const codigo = typeof erro?.code === 'number' ? erro.code : null;
  if (codigo !== null && CODIGOS_META_DE_REAUTORIZACAO.has(codigo)) return falha('reautorizar', `meta_${codigo}`);
  if (codigo !== null && CODIGOS_META_TRANSITORIOS.has(codigo)) return falha('transitoria', `meta_${codigo}`);
  if (codigo !== null && CODIGOS_META_DE_CONFIGURACAO.has(codigo)) return falha('configuracao', `meta_${codigo}`);
  if (status === 429 || status >= 500) return falha('transitoria', `http_${status}`);
  if (erro?.type === 'OAuthException') return falha('reautorizar', codigo === null ? 'meta_oauth' : `meta_${codigo}`);
  return falha('transitoria', `http_${status}`);
}

function credenciaisCompletas(credenciais: ProviderCredentials): credenciais is ProviderCredentials & { clientId: string; clientSecret: string } {
  return Boolean(credenciais.clientId && credenciais.clientSecret);
}

export function createProvedorGoogle(platform: Platform, credenciais: Credenciais, buscar: Buscar = fetch, agora = () => Date.now()): ProvedorDeToken {
  return {
    async renovar(segredo): Promise<Result<Renovacao, FalhaDoProvedor>> {
      const app = credenciais(platform);
      if (!credenciaisCompletas(app)) return err(falha('configuracao', 'app_sem_credencial'));

      const resposta = await chamar(buscar, GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: segredo,
          client_id: app.clientId,
          client_secret: app.clientSecret,
        }).toString(),
      });
      if (!resposta.ok) return resposta;

      const { status, corpo } = resposta.value;
      if (status !== 200 || !corpo) return err(classificarErroGoogle(status, corpo));
      if (typeof corpo.access_token !== 'string' || corpo.access_token.length === 0) return err(falha('transitoria', 'resposta_sem_token'));

      return ok({
        accessToken: corpo.access_token,
        expiraEm: expiracao(corpo, agora(), 3_600_000),
        ...(typeof corpo.refresh_token === 'string' && corpo.refresh_token.length > 0 ? { novoSegredo: corpo.refresh_token } : {}),
      });
    },

    async revogar(segredo): Promise<Result<ResultadoDaRevogacao, FalhaDoProvedor>> {
      const resposta = await chamar(buscar, GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: segredo }).toString(),
      });
      if (!resposta.ok) return resposta;
      const { status, corpo } = resposta.value;
      if (status === 200) return ok('revogado');
      if (status === 400 && corpo?.error === 'invalid_token') return ok('revogado');
      return err(classificarErroGoogle(status, corpo));
    },
  };
}

export function createProvedorMeta(platform: Platform, credenciais: Credenciais, buscar: Buscar = fetch, agora = () => Date.now()): ProvedorDeToken {
  return {
    async renovar(segredo): Promise<Result<Renovacao, FalhaDoProvedor>> {
      const app = credenciais(platform);
      if (!credenciaisCompletas(app)) return err(falha('configuracao', 'app_sem_credencial'));

      const pedido = longLivedExchangeRequest({ clientId: app.clientId, clientSecret: app.clientSecret, shortLivedToken: segredo });
      const resposta = await chamar(buscar, pedido.url, {
        method: 'POST',
        headers: { 'Content-Type': pedido.contentType, Accept: 'application/json' },
        body: pedido.body,
      });
      if (!resposta.ok) return resposta;

      const { status, corpo } = resposta.value;
      if (status !== 200 || !corpo) return err(classificarErroMeta(status, corpo));
      if (typeof corpo.access_token !== 'string' || corpo.access_token.length === 0) return err(falha('transitoria', 'resposta_sem_token'));

      const expiraEm = expiracao(corpo, agora(), VALIDADE_PADRAO_DA_META_MS);
      return ok({ accessToken: corpo.access_token, expiraEm, novoSegredo: corpo.access_token, segredoExpiraEm: expiraEm });
    },

    async revogar(segredo): Promise<Result<ResultadoDaRevogacao, FalhaDoProvedor>> {
      const resposta = await chamar(buscar, META_PERMISSIONS_URL, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${segredo}`, Accept: 'application/json' },
      });
      if (!resposta.ok) return resposta;
      const { status, corpo } = resposta.value;
      if (status === 200) return ok('revogado');
      const classificada = classificarErroMeta(status, corpo);
      if (classificada.natureza === 'reautorizar') return ok('revogado');
      return err(classificada);
    },
  };
}

export const provedorDeChaveDeApi: ProvedorDeToken = {
  async renovar(segredo) {
    return ok({ accessToken: segredo, expiraEm: null });
  },
  async revogar() {
    return ok('sem_suporte');
  },
};

export function createFabricaDeProvedores(credenciais: Credenciais, buscar: Buscar = fetch): FabricaDeProvedores {
  return (platform: Platform, tipo: TipoDeSegredo) => {
    if (tipo === 'api_key') return provedorDeChaveDeApi;
    if (!falaOauth(platform)) return null;
    if (tipo === 'oauth_refresh' && usaOauthDoGoogle(platform)) return createProvedorGoogle(platform, credenciais, buscar);
    if (tipo === 'oauth_long_lived' && usaOauthDaMeta(platform)) return createProvedorMeta(platform, credenciais, buscar);
    return null;
  };
}
