import { campoAplicavel, VALOR_A_CONFIRMAR, type CatalogoDeCampos } from '../catalogo/tipos.ts';
import type { CampoDeMidia } from '../plano.ts';

const ESTRATEGIAS_COM_CPA = ['MAXIMIZE_CONVERSIONS', 'TARGET_CPA'];
const ESTRATEGIAS_COM_ROAS = ['MAXIMIZE_CONVERSION_VALUE', 'TARGET_ROAS'];
const OBJETIVOS_SEM_CPA = ['display', 'demand_gen', 'multi_channel'];
const CAMPOS_DE_STATUS = ['campaign_status', 'adgroup_status', 'ad_status'];
const STATUS_NA_CRIACAO = 'PAUSED';
const ENTREGA_RECUSADA = 'ACCELERATED';
const PERIODO_COM_FIM = 'CUSTOM_PERIOD';

const MICROS_POR_UNIDADE = 1_000_000;
const MULTIPLO_MINIMO_DO_ORCAMENTO_EM_MICROS = 10_000;
const CAMPOS_DE_LANCE_EM_MICROS = ['adgroup_cpc_bid_micros', 'keyword_cpc_bid_micros', 'campaign_cpc_bid_ceiling_micros', 'campaign_target_cpa_micros'];
const ESTRATEGIA_DE_PARTICIPACAO = 'TARGET_IMPRESSION_SHARE';
const HORA_FINAL_DO_DIA = 24;
const ROAS_MAXIMO = 1000;
const MODIFICADOR_DE_DISPOSITIVO = { minimo: 0, maximo: 10 } as const;
const ESTRATEGIAS_POR_CAMPO: Readonly<Record<string, readonly string[]>> = {
  campaign_target_impression_share_location: ['TARGET_IMPRESSION_SHARE'],
  campaign_target_impression_share_fraction_micros: ['TARGET_IMPRESSION_SHARE'],
  campaign_manual_cpc_enhanced: ['MANUAL_CPC'],
  campaign_cpc_bid_ceiling_micros: ['TARGET_SPEND', 'TARGET_IMPRESSION_SHARE'],
};
const CAMPOS_EM_MICROS_COM_MULTIPLO = ['adgroup_cpc_bid_micros', 'keyword_cpc_bid_micros', 'campaign_cpc_bid_ceiling_micros', 'campaign_target_cpa_micros'];

type DataEHora = { readonly ano: number; readonly mes: number; readonly dia: number; readonly hora: number; readonly minuto: number; readonly segundo: number };

function dataEHoraValida(texto: string): DataEHora | undefined {
  const partes = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(texto);
  if (partes === null) return undefined;
  const [ano, mes, dia, hora, minuto, segundo] = partes.slice(1).map(Number) as [number, number, number, number, number, number];
  const diasDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDoMes || hora > 23 || minuto > 59 || segundo > 59) return undefined;
  return { ano, mes, dia, hora, minuto, segundo };
}

function instanteDe(data: DataEHora): number {
  return Date.UTC(data.ano, data.mes - 1, data.dia, data.hora, data.minuto, data.segundo);
}

export const LIMITES_DO_ANUNCIO_RESPONSIVO = {
  titulos: { minimo: 3, maximo: 15, caracteres: 30 },
  descricoes: { minimo: 2, maximo: 4, caracteres: 90 },
  caminho: { caracteres: 15 },
} as const;

type Valores = ReadonlyMap<string, CampoDeMidia['valor']>;

function valorDe(valores: Valores, chave: string): CampoDeMidia['valor'] | undefined {
  const valor = valores.get(chave);
  return valor === VALOR_A_CONFIRMAR ? undefined : valor;
}

function numeroDe(valores: Valores, chave: string): number | undefined {
  const valor = valorDe(valores, chave);
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : undefined;
}

function textosDe(valores: Valores, chave: string): string[] | undefined {
  const valor = valorDe(valores, chave);
  if (!Array.isArray(valor)) return undefined;
  return valor.map((item) => String(item));
}

export function problemasDeDependenciaDoGoogle(
  valores: Valores,
  objetivo: string | undefined,
  local: (chave: string) => string,
  catalogo: CatalogoDeCampos,
): string[] {
  const problemas: string[] = [];
  const tem = (chave: string) => valores.has(chave);
  const estrategia = valorDe(valores, 'campaign_bidding_strategy');

  if (objetivo !== undefined) {
    for (const campo of catalogo.campos) {
      if (valores.has(campo.chave) && !campoAplicavel(campo, objetivo)) problemas.push(`${local(campo.chave)} (não se aplica ao objetivo ${objetivo})`);
    }
  }
  for (const [chave, permitidas] of Object.entries(ESTRATEGIAS_POR_CAMPO)) {
    if (tem(chave) && (typeof estrategia !== 'string' || !permitidas.includes(estrategia))) {
      problemas.push(`${local('campaign_bidding_strategy')} (${permitidas.join(' ou ')} é obrigatório com ${chave})`);
    }
  }
  if (valorDe(valores, 'campaign_manual_cpc_enhanced') === true) {
    problemas.push(`${local('campaign_manual_cpc_enhanced')} (CPC melhorado foi descontinuado; a API recusa true)`);
  }

  if (tem('campaign_target_cpa_micros')) {
    if (typeof estrategia !== 'string' || !ESTRATEGIAS_COM_CPA.includes(estrategia)) {
      problemas.push(`${local('campaign_bidding_strategy')} (MAXIMIZE_CONVERSIONS ou TARGET_CPA é obrigatório com campaign_target_cpa_micros)`);
    }
    if (objetivo !== undefined && OBJETIVOS_SEM_CPA.includes(objetivo)) {
      problemas.push(`${local('campaign_target_cpa_micros')} (a API recusa CPA alvo em ${objetivo})`);
    }
  }

  if (tem('campaign_target_roas') && (typeof estrategia !== 'string' || !ESTRATEGIAS_COM_ROAS.includes(estrategia))) {
    problemas.push(`${local('campaign_bidding_strategy')} (MAXIMIZE_CONVERSION_VALUE ou TARGET_ROAS é obrigatório com campaign_target_roas)`);
  }

  for (const chave of CAMPOS_DE_STATUS) {
    const status = valorDe(valores, chave);
    if (status !== undefined && status !== STATUS_NA_CRIACAO) {
      problemas.push(`${local(chave)} (o plano cria sempre ${STATUS_NA_CRIACAO}; omitir ou enviar outro valor cria ENABLED ou recusa)`);
    }
  }

  const { titulos, descricoes, caminho } = LIMITES_DO_ANUNCIO_RESPONSIVO;
  for (const [chave, limites] of [['ad_headlines', titulos], ['ad_descriptions', descricoes]] as const) {
    const itens = textosDe(valores, chave);
    if (itens === undefined) continue;
    if (itens.length < limites.minimo || itens.length > limites.maximo) {
      problemas.push(`${local(chave)} (de ${limites.minimo} a ${limites.maximo} itens; veio ${itens.length})`);
    }
    const longos = itens.filter((item) => item.length > limites.caracteres).length;
    if (longos > 0) problemas.push(`${local(chave)} (${longos} item(ns) com mais de ${limites.caracteres} caracteres)`);
    if (new Set(itens.map((item) => item.trim().toLowerCase())).size !== itens.length) {
      problemas.push(`${local(chave)} (itens repetidos; a API recusa DUPLICATE_ASSET)`);
    }
  }

  for (const chave of ['ad_path1', 'ad_path2']) {
    const texto = valorDe(valores, chave);
    if (typeof texto === 'string' && texto.length > caminho.caracteres) {
      problemas.push(`${local(chave)} (mais de ${caminho.caracteres} caracteres)`);
    }
  }
  if (tem('ad_path2') && !tem('ad_path1')) problemas.push(`${local('ad_path1')} (obrigatório com ad_path2)`);

  if (valorDe(valores, 'budget_delivery_method') === ENTREGA_RECUSADA) {
    problemas.push(`${local('budget_delivery_method')} (a API recusa ${ENTREGA_RECUSADA}; use STANDARD)`);
  }
  if (valorDe(valores, 'budget_period') === PERIODO_COM_FIM && !tem('campaign_end_date_time')) {
    problemas.push(`${local('campaign_end_date_time')} (obrigatório com orçamento ${PERIODO_COM_FIM})`);
  }
  if (valorDe(valores, 'campaign_network_google_search') === false) {
    problemas.push(`${local('campaign_network_google_search')} (precisa ser true em Search)`);
  }

  const orcamento = numeroDe(valores, 'budget_amount_micros');
  if (orcamento !== undefined && (orcamento <= 0 || orcamento % MULTIPLO_MINIMO_DO_ORCAMENTO_EM_MICROS !== 0)) {
    problemas.push(`${local('budget_amount_micros')} (micros da moeda da conta, maior que 0 e múltiplo de ${MULTIPLO_MINIMO_DO_ORCAMENTO_EM_MICROS})`);
  }
  for (const chave of CAMPOS_DE_LANCE_EM_MICROS) {
    const lance = numeroDe(valores, chave);
    if (lance !== undefined && lance <= 0) problemas.push(`${local(chave)} (micros da moeda da conta; precisa ser maior que 0)`);
  }
  for (const chave of CAMPOS_EM_MICROS_COM_MULTIPLO) {
    const micros = numeroDe(valores, chave);
    if (micros !== undefined && micros > 0 && (!Number.isInteger(micros) || micros % MULTIPLO_MINIMO_DO_ORCAMENTO_EM_MICROS !== 0)) {
      problemas.push(`${local(chave)} (micros inteiros, múltiplo de ${MULTIPLO_MINIMO_DO_ORCAMENTO_EM_MICROS})`);
    }
  }
  const roas = numeroDe(valores, 'campaign_target_roas');
  if (roas !== undefined && (roas <= 0 || roas > ROAS_MAXIMO)) problemas.push(`${local('campaign_target_roas')} (razão decimal maior que 0 e até ${ROAS_MAXIMO})`);
  const modificador = numeroDe(valores, 'targeting_device_bid_modifier');
  if (modificador !== undefined && (modificador < MODIFICADOR_DE_DISPOSITIVO.minimo || modificador > MODIFICADOR_DE_DISPOSITIVO.maximo)) {
    problemas.push(`${local('targeting_device_bid_modifier')} (multiplicador de ${MODIFICADOR_DE_DISPOSITIVO.minimo} a ${MODIFICADOR_DE_DISPOSITIVO.maximo}; 1 = sem ajuste)`);
  }

  if (estrategia === ESTRATEGIA_DE_PARTICIPACAO) {
    for (const chave of ['campaign_target_impression_share_location', 'campaign_target_impression_share_fraction_micros']) {
      if (!tem(chave)) problemas.push(`${local(chave)} (obrigatório com ${ESTRATEGIA_DE_PARTICIPACAO})`);
    }
  }
  const fracao = numeroDe(valores, 'campaign_target_impression_share_fraction_micros');
  if (fracao !== undefined && (!Number.isInteger(fracao) || fracao < 1 || fracao > MICROS_POR_UNIDADE)) {
    problemas.push(`${local('campaign_target_impression_share_fraction_micros')} (micros inteiros de fração, de 1 a ${MICROS_POR_UNIDADE})`);
  }

  const horaInicial = numeroDe(valores, 'targeting_ad_schedule_start_hour');
  const horaFinal = numeroDe(valores, 'targeting_ad_schedule_end_hour');
  for (const [chave, hora] of [['targeting_ad_schedule_start_hour', horaInicial], ['targeting_ad_schedule_end_hour', horaFinal]] as const) {
    if (hora !== undefined && (!Number.isInteger(hora) || hora < 0 || hora > HORA_FINAL_DO_DIA)) {
      problemas.push(`${local(chave)} (hora inteira de 0 a ${HORA_FINAL_DO_DIA})`);
    }
  }
  if (horaInicial !== undefined && horaFinal !== undefined && horaInicial >= horaFinal) {
    problemas.push(`${local('targeting_ad_schedule_end_hour')} (precisa ser maior que a hora inicial)`);
  }

  const instantes: Record<string, number | undefined> = {};
  for (const chave of ['campaign_start_date_time', 'campaign_end_date_time']) {
    const data = valorDe(valores, chave);
    if (typeof data !== 'string') continue;
    const valida = dataEHoraValida(data);
    if (valida === undefined) problemas.push(`${local(chave)} (data e hora reais no formato yyyy-MM-dd HH:mm:ss)`);
    else instantes[chave] = instanteDe(valida);
  }
  const inicioValido = instantes['campaign_start_date_time'];
  const fimValido = instantes['campaign_end_date_time'];
  if (inicioValido !== undefined && fimValido !== undefined && inicioValido >= fimValido) {
    problemas.push(`${local('campaign_end_date_time')} (precisa ser posterior ao início)`);
  }
  return problemas;
}
