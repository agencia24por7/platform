import type { MemberRole } from '../../identity/domain/user.ts';
import { valoresIguais } from '../../clients/domain/regras/valor.ts';
import type { Lacuna, ValorDaSugestao } from './plano.ts';

export type RegraVigenteParaLacuna = {
  readonly natureza: string;
  readonly chave: string | null;
  readonly escopo: string;
  readonly medida: string | null;
};

export const PAPEIS_QUE_APROVAM_SUGESTOES: readonly MemberRole[] = ['owner', 'admin'];

export const podeAprovarSugestoes = (papel: MemberRole): boolean => PAPEIS_QUE_APROVAM_SUGESTOES.includes(papel);

export function regraDaLacunaCasa(lacuna: Lacuna, regra: RegraVigenteParaLacuna): boolean {
  const alvo = lacuna.regra;
  if (alvo === undefined || regra.natureza !== alvo.natureza || regra.escopo !== alvo.escopo) return false;
  if (alvo.chave !== undefined) return regra.chave === alvo.chave;
  return alvo.natureza === 'limite' && lacuna.medida !== undefined && regra.medida === lacuna.medida;
}

export function lacunaAtendida(lacuna: Lacuna, regrasVigentes: readonly RegraVigenteParaLacuna[]): boolean {
  return lacuna.regra !== undefined && regrasVigentes.some((regra) => regraDaLacunaCasa(lacuna, regra));
}

export function valoresDeSugestaoIguais(a: ValorDaSugestao | null | undefined, b: ValorDaSugestao | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const aTexto = 'texto' in a;
  const bTexto = 'texto' in b;
  if (aTexto || bTexto) return aTexto && bTexto && a.texto.trim() === b.texto.trim();
  return valoresIguais(a, b);
}
