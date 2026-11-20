import type { Platform } from './connection.ts';
import type { DiscoveredAccount } from './discovery.ts';

export const PLATAFORMAS_POR_CHAVE = ['apify', 'zapi', 'rdstation'] as const;
export type PlataformaPorChave = (typeof PLATAFORMAS_POR_CHAVE)[number];

export function usaChaveDeApi(platform: Platform): platform is PlataformaPorChave {
  return (PLATAFORMAS_POR_CHAVE as readonly string[]).includes(platform);
}

export const MOTIVO_DA_CHAVE = {
  plataforma_invalida: 'Essa plataforma não se conecta por chave de API.',
  sem_permissao: 'Só quem administra a organização pode guardar uma chave.',
  chave_curta: 'A chave parece incompleta.',
  chave_com_espaco: 'A chave não pode conter espaço nem quebra de linha.',
  chave_zapi_incompleta: 'Informe o ID da instância e o token do Z-API.',
  chave_recusada: 'A plataforma recusou essa credencial. Confira se está correta.',
  cofre_indisponivel: 'O cofre do n8n não respondeu. Sem ele a chave não tem onde morar em segurança.',
} as const;

export type MotivoDaChave = keyof typeof MOTIVO_DA_CHAVE;

const MINIMO = 20;
const MAXIMO = 400;

export function validarChave(bruta: string): MotivoDaChave | null {
  const chave = bruta.trim();
  if (/\s/.test(chave)) return 'chave_com_espaco';
  if (chave.length < MINIMO || chave.length > MAXIMO) return 'chave_curta';
  return null;
}

export function rotuloDaChave(chave: string): string {
  const limpa = chave.trim();
  return limpa.length <= 8 ? '••••' : `${limpa.slice(0, 4)}••••${limpa.slice(-4)}`;
}

export type PartesDaChaveZapi = { readonly instanceId: string; readonly token: string };

export function partesDaChaveZapi(chave: string): PartesDaChaveZapi | null {
  const partes = chave.split(':');
  if (partes.length !== 2) return null;
  const [instanceId, token] = partes;
  if (!instanceId || !token) return null;
  return { instanceId, token };
}

export function montarChaveZapi(instanceId: string, token: string): string {
  return `${instanceId.trim()}:${token.trim()}`;
}

export const CONTA_UNICA = 'principal';

export function identidadeDaConexao(): string {
  return CONTA_UNICA;
}

export type ConexaoPorChave = {
  readonly platform: PlataformaPorChave;
  readonly externalId: string;
  readonly label: string;
};

export function contaDaChave(conexao: ConexaoPorChave): DiscoveredAccount {
  return {
    platform: conexao.platform,
    externalId: conexao.externalId,
    name: conexao.label,
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    managerExternalId: null,
    spendingLast30Days: null,
    inactive: false,
  };
}
