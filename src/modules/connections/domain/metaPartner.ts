export type PedidoDePartnerRecusado = 'formato' | 'sem_business_manager' | 'sem_conexao_meta';

export const MOTIVO_DO_PEDIDO_DE_PARTNER: Record<PedidoDePartnerRecusado, string> = {
  formato: 'Informe o identificador da conta de anúncio no formato act_1234567890.',
  sem_business_manager:
    'Esta organização ainda não tem um Business Manager identificado. Autorize o Meta Ads primeiro.',
  sem_conexao_meta: 'Autorize o Meta Ads com uma conta administradora do seu Business Manager primeiro.',
};

export function normalizarContaDeAnuncioMeta(bruto: string): string | null {
  const limpo = bruto.trim().toLowerCase();
  const alvo = limpo.startsWith('act_') ? limpo : `act_${limpo}`;
  return /^act_\d{4,20}$/.test(alvo) ? alvo : null;
}
