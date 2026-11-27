import { VALOR_A_CONFIRMAR } from '../catalogo/tipos.ts';
import type { CampoDeMidia } from '../plano.ts';

export const ORCAMENTO_DIARIO_MINIMO_EM_CENTAVOS = 570;

const LANCES_COM_TETO = ['COST_CAP', 'LOWEST_COST_WITH_BID_CAP'];
const ESTRATEGIA_SEM_TETO = 'LOWEST_COST_WITHOUT_CAP';
const RITMO_POR_HORARIO = 'day_parting';
const IDADE_PADRAO_MINIMA = 18;
const IDADE_PADRAO_MAXIMA = 65;

type Valores = ReadonlyMap<string, CampoDeMidia['valor']>;

function valorDe(valores: Valores, chave: string): CampoDeMidia['valor'] | undefined {
  const valor = valores.get(chave);
  return valor === VALOR_A_CONFIRMAR ? undefined : valor;
}

function numeroDe(valores: Valores, chave: string): number | undefined {
  const valor = valorDe(valores, chave);
  return typeof valor === 'number' ? valor : undefined;
}

export function problemasDeDependenciaDaMeta(valores: Valores, chavesDoCatalogo: ReadonlySet<string>, local: (chave: string) => string): string[] {
  const problemas: string[] = [];
  const tem = (chave: string) => valores.has(chave);

  const estrategia = valorDe(valores, 'adset_bid_strategy');
  if (typeof estrategia === 'string' && LANCES_COM_TETO.includes(estrategia) && !tem('adset_bid_amount')) {
    problemas.push(`${local('adset_bid_amount')} (obrigatório com ${estrategia})`);
  }
  if (estrategia === ESTRATEGIA_SEM_TETO && tem('adset_bid_amount')) {
    problemas.push(`${local('adset_bid_amount')} (proibido com ${ESTRATEGIA_SEM_TETO})`);
  }

  if (tem('ad_bid_amount') && estrategia !== 'LOWEST_COST_WITH_BID_CAP') {
    problemas.push(`${local('adset_bid_strategy')} (LOWEST_COST_WITH_BID_CAP é obrigatório com ad_bid_amount)`);
  }

  if (tem('ad_bid_amount') && estrategia !== 'LOWEST_COST_WITH_BID_CAP') {
    problemas.push(`${local('adset_bid_strategy')} (LOWEST_COST_WITH_BID_CAP é obrigatório com ad_bid_amount)`);
  }

  if (tem('adset_lifetime_budget') && !tem('adset_end_time')) {
    problemas.push(`${local('adset_end_time')} (obrigatório com orçamento vitalício)`);
  }

  const ritmo = valorDe(valores, 'adset_pacing_type');
  if (Array.isArray(ritmo) && ritmo.includes(RITMO_POR_HORARIO)) {
    if (!tem('adset_lifetime_budget')) problemas.push(`${local('adset_pacing_type')} (day_parting exige orçamento vitalício)`);
    if (!tem('adset_schedule')) problemas.push(`${local('adset_schedule')} (obrigatório com day_parting)`);
  }

  const orcamentosDoConjunto = ['adset_daily_budget', 'adset_lifetime_budget'].filter(tem);
  const orcamentosDaCampanha = ['campaign_daily_budget', 'campaign_lifetime_budget'].filter(tem);
  if (orcamentosDoConjunto.length > 1) problemas.push(`${local('adset_daily_budget')} (diário e vitalício juntos; use só um)`);
  if (chavesDoCatalogo.has('adset_daily_budget') && orcamentosDoConjunto.length === 0 && orcamentosDaCampanha.length === 0) {
    problemas.push(`${local('adset_daily_budget')} (sem orçamento no conjunto nem na campanha)`);
  }
  if (orcamentosDoConjunto.length > 0 && orcamentosDaCampanha.length > 0) {
    problemas.push(`${local(orcamentosDoConjunto[0]!)} (orçamento no conjunto e na campanha juntos)`);
  }

  for (const chave of ['adset_daily_budget', 'campaign_daily_budget']) {
    const diario = numeroDe(valores, chave);
    if (diario !== undefined && diario < ORCAMENTO_DIARIO_MINIMO_EM_CENTAVOS) {
      problemas.push(`${local(chave)} (abaixo do mínimo de ${ORCAMENTO_DIARIO_MINIMO_EM_CENTAVOS} centavos)`);
    }
  }

  const idadeMinima = numeroDe(valores, 'tg_age_min');
  const idadeMaxima = numeroDe(valores, 'tg_age_max');
  const restringeAudiencia =
    (idadeMinima !== undefined && idadeMinima > IDADE_PADRAO_MINIMA) ||
    (idadeMaxima !== undefined && idadeMaxima < IDADE_PADRAO_MAXIMA) ||
    tem('tg_genders');
  if (restringeAudiencia && !tem('adset_targeting_automation')) {
    problemas.push(`${local('adset_targeting_automation')} (obrigatório com idade mínima acima de 18, máxima abaixo de 65 ou gênero)`);
  }
  if (valorDe(valores, 'adset_targeting_automation') === true && idadeMaxima !== undefined && idadeMaxima < IDADE_PADRAO_MAXIMA) {
    problemas.push(`${local('tg_age_max')} (inválida com advantage_audience ligado)`);
  }
  return problemas;
}
