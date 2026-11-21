import type { Connection, Platform } from '@/modules/connections/domain/connection';
import { FAMILIA_GOOGLE, FAMILIA_META } from '@/modules/connections/domain/oauth';

export type ProvedorRevogavel = 'google' | 'meta';

export type RevogadoNoProvedor = true | false | 'nao_suportado';

export type MotivoDaRevogacao =
  | 'revogado'
  | 'plataforma_sem_revogacao'
  | 'autorizacao_sem_usuario'
  | 'sem_credencial_no_cofre'
  | 'acesso_compartilhado'
  | 'revogador_indisponivel'
  | 'recusado_pelo_provedor'
  | 'falhou';

export type ResultadoDaRevogacao = {
  readonly revogadoNoProvedor: RevogadoNoProvedor;
  readonly motivo: MotivoDaRevogacao;
};

export type ConexaoARevogar = Pick<Connection, 'id' | 'organizationId' | 'platform' | 'grantType'>;

export type DecisaoDeRevogacao =
  | { readonly tentar: true }
  | { readonly tentar: false; readonly resultado: ResultadoDaRevogacao };

export type DesfechoNoCofre = 'revogado' | 'sem_suporte' | 'falhou' | 'sem_token' | 'nao_tentada';

export function resultadoDaRevogacaoNoCofre(desfecho: DesfechoNoCofre): ResultadoDaRevogacao {
  switch (desfecho) {
    case 'revogado':
      return { revogadoNoProvedor: true, motivo: 'revogado' };
    case 'sem_suporte':
      return { revogadoNoProvedor: 'nao_suportado', motivo: 'plataforma_sem_revogacao' };
    case 'sem_token':
      return { revogadoNoProvedor: false, motivo: 'sem_credencial_no_cofre' };
    case 'nao_tentada':
      return { revogadoNoProvedor: false, motivo: 'revogador_indisponivel' };
    default:
      return { revogadoNoProvedor: false, motivo: 'falhou' };
  }
}

export function provedorDaPlataforma(platform: Platform): ProvedorRevogavel | null {
  if ((FAMILIA_GOOGLE as readonly string[]).includes(platform)) return 'google';
  if ((FAMILIA_META as readonly string[]).includes(platform)) return 'meta';
  return null;
}

export const ONDE_REVOGAR: Readonly<Record<ProvedorRevogavel, string>> = {
  google: 'myaccount.google.com/permissions (remova "Orla - Ads Platform")',
  meta: 'facebook.com/settings?tab=business_tools (remova o app "Agencia24/7 Ads")',
};

const NOME_DO_PROVEDOR: Readonly<Record<ProvedorRevogavel, string>> = { google: 'no Google', meta: 'na Meta' };

const POR_QUE_NAO_REVOGOU: Partial<Readonly<Record<MotivoDaRevogacao, string>>> = {
  acesso_compartilhado: 'a mesma conta autoriza outra conexão ativa da orla, que pararia junto',
  sem_credencial_no_cofre: 'não havia token guardado no cofre para esta conexão',
  revogador_indisponivel: 'o cofre de tokens não estava disponível',
  recusado_pelo_provedor: 'o provedor recusou o pedido',
  falhou: 'o pedido ao provedor falhou',
};

export function avisoDaRevogacao(platform: Platform, resultado: ResultadoDaRevogacao): string | null {
  if (resultado.revogadoNoProvedor !== false) return null;
  const provedor = provedorDaPlataforma(platform);
  if (!provedor) return null;
  const porque = POR_QUE_NAO_REVOGOU[resultado.motivo] ?? 'o pedido ao provedor falhou';
  return `O acesso não foi revogado ${NOME_DO_PROVEDOR[provedor]} (${porque}). Quem autorizou deve revogar em ${ONDE_REVOGAR[provedor]}.`;
}

export type ResumoDaRemocao = {
  readonly revogadoNoProvedor: RevogadoNoProvedor;
  readonly avisoDeRevogacao: string | null;
  readonly expurgo: { readonly enfileirados: number; readonly concluidos: number };
};

export function mensagemDaRemocao(resumo: ResumoDaRemocao): string {
  const partes = ['Conexão removida. O token foi apagado do cofre e a coleta dessa conta parou.'];
  if (resumo.revogadoNoProvedor === true) partes.push('O acesso também foi revogado no provedor.');
  if (resumo.avisoDeRevogacao) partes.push(resumo.avisoDeRevogacao);
  if (resumo.expurgo.enfileirados > resumo.expurgo.concluidos) {
    partes.push('Os dados do YouTube dessa conexão serão apagados do BigQuery em até 7 dias.');
  } else if (resumo.expurgo.concluidos > 0) {
    partes.push('Os dados do YouTube dessa conexão foram apagados do BigQuery.');
  }
  return partes.join(' ');
}
