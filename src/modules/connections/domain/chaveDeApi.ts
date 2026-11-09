import type { Platform } from './connection.ts';

export const PLATAFORMAS_POR_CHAVE = ['apify', 'zapi'] as const;
export type PlataformaPorChave = (typeof PLATAFORMAS_POR_CHAVE)[number];

export function usaChaveDeApi(platform: Platform): platform is PlataformaPorChave {
  return (PLATAFORMAS_POR_CHAVE as readonly string[]).includes(platform);
}

export const MOTIVO_DA_CHAVE = {
  plataforma_invalida: 'Essa plataforma não se conecta por chave de API.',
  sem_permissao: 'Só quem administra a organização pode guardar uma chave.',
  chave_curta: 'A chave parece incompleta.',
  chave_com_espaco: 'A chave não pode conter espaço nem quebra de linha.',
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

export const CONTA_UNICA = 'principal';

export function identidadeDaConexao(): string {
  return CONTA_UNICA;
}
