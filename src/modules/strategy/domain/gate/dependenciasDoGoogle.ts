import { campoAplicavel, VALOR_A_CONFIRMAR, type CatalogoDeCampos } from '../catalogo/tipos.ts';
import type { CampoDeMidia } from '../plano.ts';

const ESTRATEGIAS_COM_CPA = ['MAXIMIZE_CONVERSIONS', 'TARGET_CPA'];
const ESTRATEGIAS_COM_ROAS = ['MAXIMIZE_CONVERSION_VALUE', 'TARGET_ROAS'];
const CAMPOS_DE_STATUS = ['campaign_status', 'adgroup_status', 'ad_status', 'adgroup_display_status', 'ad_display_status', 'assetgroup_pmax_status', 'adgroup_dg_status', 'ad_dg_status', 'adgroup_app_status'];
const STATUS_NA_CRIACAO = 'PAUSED';
const ENTREGA_RECUSADA = 'ACCELERATED';
const PERIODO_COM_FIM = 'CUSTOM_PERIOD';

const MICROS_POR_UNIDADE = 1_000_000;
const MULTIPLO_MINIMO_DO_ORCAMENTO_EM_MICROS = 10_000;
const CAMPOS_DE_LANCE_EM_MICROS = [
  'adgroup_cpc_bid_micros',
  'keyword_cpc_bid_micros',
  'campaign_cpc_bid_ceiling_micros',
  'campaign_target_cpa_micros',
  'campaign_display_target_cpa_micros',
  'adgroup_display_cpc_bid_micros',
  'adgroup_display_cpm_bid_micros',
  'campaign_pmax_target_cpa_micros',
  'campaign_dg_target_cpa_micros',
  'campaign_app_target_cpa_micros',
];
const CAMPOS_DE_ROAS = ['campaign_target_roas', 'campaign_display_target_roas', 'campaign_pmax_target_roas'];
const ESTRATEGIA_DO_OBJETIVO: Readonly<Record<string, string>> = {
  search: 'campaign_bidding_strategy',
  display: 'campaign_display_bidding_strategy',
  performance_max: 'campaign_pmax_bidding_strategy',
  demand_gen: 'campaign_dg_bidding_strategy',
  multi_channel: 'campaign_app_bidding_strategy',
};
const ORCAMENTO_MINIMO_DO_DEMAND_GEN_EM_MICROS = 50_000_000;
const TETO_EM_MICROS = 1e12;
const CANAIS_DO_DEMAND_GEN = ['youtube_in_feed', 'discover', 'gmail', 'display', 'youtube_shorts'];
const ESTRATEGIA_DE_PARTICIPACAO = 'TARGET_IMPRESSION_SHARE';
const HORA_FINAL_DO_DIA = 24;
const ROAS_MAXIMO = 1000;
const MODIFICADOR_DE_DISPOSITIVO = { minimo: 0, maximo: 10 } as const;
type EstrategiaDoCampo = { readonly estrategia: string; readonly permitidas: readonly string[] };
const ESTRATEGIAS_POR_CAMPO: Readonly<Record<string, EstrategiaDoCampo>> = {
  campaign_target_impression_share_location: { estrategia: 'campaign_bidding_strategy', permitidas: ['TARGET_IMPRESSION_SHARE'] },
  campaign_target_impression_share_fraction_micros: { estrategia: 'campaign_bidding_strategy', permitidas: ['TARGET_IMPRESSION_SHARE'] },
  campaign_manual_cpc_enhanced: { estrategia: 'campaign_bidding_strategy', permitidas: ['MANUAL_CPC'] },
  campaign_cpc_bid_ceiling_micros: { estrategia: 'campaign_bidding_strategy', permitidas: ['TARGET_SPEND', 'TARGET_IMPRESSION_SHARE'] },
  campaign_display_target_cpa_micros: { estrategia: 'campaign_display_bidding_strategy', permitidas: ['TARGET_CPA'] },
  campaign_display_target_roas: { estrategia: 'campaign_display_bidding_strategy', permitidas: ['MAXIMIZE_CONVERSION_VALUE'] },
  adgroup_display_cpc_bid_micros: { estrategia: 'campaign_display_bidding_strategy', permitidas: ['MANUAL_CPC'] },
  adgroup_display_cpm_bid_micros: { estrategia: 'campaign_display_bidding_strategy', permitidas: ['MANUAL_CPM'] },
  campaign_pmax_target_cpa_micros: { estrategia: 'campaign_pmax_bidding_strategy', permitidas: ['MAXIMIZE_CONVERSIONS'] },
  campaign_pmax_target_roas: { estrategia: 'campaign_pmax_bidding_strategy', permitidas: ['MAXIMIZE_CONVERSION_VALUE'] },
  campaign_dg_target_cpa_micros: { estrategia: 'campaign_dg_bidding_strategy', permitidas: ['TARGET_CPA'] },
  campaign_app_target_cpa_micros: { estrategia: 'campaign_app_bidding_strategy', permitidas: ['TARGET_CPA'] },
};
const ESTRATEGIA_COM_CPA_OBRIGATORIO: Readonly<Record<string, string>> = {
  campaign_display_bidding_strategy: 'campaign_display_target_cpa_micros',
  campaign_dg_bidding_strategy: 'campaign_dg_target_cpa_micros',
  campaign_app_bidding_strategy: 'campaign_app_target_cpa_micros',
};
const META_DO_APP_POR_ESTRATEGIA: Readonly<Record<string, string>> = {
  MAXIMIZE_CONVERSIONS: 'OPTIMIZE_INSTALLS_WITHOUT_TARGET_INSTALL_COST',
  TARGET_CPA: 'OPTIMIZE_INSTALLS_TARGET_INSTALL_COST',
};

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

type LimiteDeLista = { readonly minimo: number; readonly maximo: number; readonly caracteres?: number };
const LIMITES_DE_LISTA: ReadonlyArray<readonly [string, LimiteDeLista]> = [
  ['ad_headlines', LIMITES_DO_ANUNCIO_RESPONSIVO.titulos],
  ['ad_descriptions', LIMITES_DO_ANUNCIO_RESPONSIVO.descricoes],
  ['ad_display_headlines', { minimo: 1, maximo: 5, caracteres: 30 }],
  ['ad_display_descriptions', { minimo: 1, maximo: 5, caracteres: 90 }],
  ['ad_display_logo_images', { minimo: 0, maximo: 5 }],
  ['ad_display_square_logo_images', { minimo: 0, maximo: 5 }],
  ['ad_display_youtube_videos', { minimo: 0, maximo: 5 }],
  ['assetgroup_pmax_headlines', { minimo: 3, maximo: 15, caracteres: 30 }],
  ['assetgroup_pmax_long_headlines', { minimo: 1, maximo: 5, caracteres: 90 }],
  ['assetgroup_pmax_descriptions', { minimo: 2, maximo: 5, caracteres: 90 }],
  ['assetgroup_pmax_marketing_images', { minimo: 1, maximo: 19 }],
  ['assetgroup_pmax_square_marketing_images', { minimo: 1, maximo: 19 }],
  ['assetgroup_pmax_logos', { minimo: 1, maximo: 5 }],
  ['assetgroup_pmax_portrait_marketing_images', { minimo: 0, maximo: 19 }],
  ['assetgroup_pmax_landscape_logos', { minimo: 0, maximo: 5 }],
  ['assetgroup_pmax_youtube_video', { minimo: 0, maximo: 5 }],
  ['signal_pmax_search_theme', { minimo: 0, maximo: 25 }],
  ['ad_dg_headlines', { minimo: 1, maximo: 5, caracteres: 40 }],
  ['ad_dg_descriptions', { minimo: 1, maximo: 5, caracteres: 90 }],
  ['ad_dg_logo_images', { minimo: 1, maximo: 5 }],
  ['ad_dg_video_videos', { minimo: 1, maximo: 5 }],
  ['ad_dg_video_long_headlines', { minimo: 1, maximo: 5, caracteres: 90 }],
  ['ad_app_headlines', { minimo: 2, maximo: 5, caracteres: 30 }],
  ['ad_app_descriptions', { minimo: 1, maximo: 5, caracteres: 90 }],
  ['ad_app_images', { minimo: 0, maximo: 20 }],
  ['ad_app_youtube_videos', { minimo: 0, maximo: 20 }],
];
const LIMITES_DE_TEXTO: ReadonlyArray<readonly [string, number]> = [
  ['ad_path1', 15],
  ['ad_path2', 15],
  ['assetgroup_pmax_path1', 15],
  ['assetgroup_pmax_path2', 15],
  ['ad_dg_video_breadcrumb1', 15],
  ['ad_dg_video_breadcrumb2', 15],
  ['ad_display_long_headline', 90],
  ['ad_display_business_name', 25],
  ['ad_display_call_to_action_text', 30],
  ['assetgroup_pmax_business_name', 25],
  ['ad_dg_business_name', 25],
];
const IMAGENS_DO_DISPLAY = ['ad_display_marketing_images', 'ad_display_square_marketing_images'];
const IMAGENS_DO_DEMAND_GEN = ['ad_dg_marketing_images', 'ad_dg_square_marketing_images', 'ad_dg_portrait_marketing_images', 'ad_dg_tall_portrait_marketing_images'];
const CAMPOS_DO_VIDEO_DO_DEMAND_GEN = ['ad_dg_video_videos', 'ad_dg_video_long_headlines', 'ad_dg_video_breadcrumb1', 'ad_dg_video_breadcrumb2', 'ad_dg_video_call_to_action'];
const MAXIMO_DE_IMAGENS_DO_DISPLAY = 15;
const MAXIMO_DE_LOGOS_DO_DISPLAY = 5;
const MAXIMO_DE_IMAGENS_DO_DEMAND_GEN = 19;

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

function contagemDe(valores: Valores, chave: string): number {
  return textosDe(valores, chave)?.length ?? 0;
}

function problemasDoCanal(valores: Valores, objetivo: string | undefined, local: (chave: string) => string): string[] {
  const problemas: string[] = [];
  const tem = (chave: string) => valores.has(chave);
  const estrategia = objetivo === undefined ? undefined : valorDe(valores, ESTRATEGIA_DO_OBJETIVO[objetivo] ?? '');

  if (objetivo === 'display') {
    if (valorDe(valores, 'campaign_display_network_content') === false) {
      problemas.push(`${local('campaign_display_network_content')} (precisa ser true em Display)`);
    }
    const total = IMAGENS_DO_DISPLAY.reduce((soma, chave) => soma + contagemDe(valores, chave), 0);
    if (total > MAXIMO_DE_IMAGENS_DO_DISPLAY) problemas.push(`${local('ad_display_marketing_images')} (imagens 1.91:1 e 1:1 somam no máximo ${MAXIMO_DE_IMAGENS_DO_DISPLAY}; veio ${total})`);
    const logos = contagemDe(valores, 'ad_display_logo_images') + contagemDe(valores, 'ad_display_square_logo_images');
    if (logos > MAXIMO_DE_LOGOS_DO_DISPLAY) problemas.push(`${local('ad_display_square_logo_images')} (logos 4:1 e 1:1 somam no máximo ${MAXIMO_DE_LOGOS_DO_DISPLAY}; veio ${logos})`);
    for (const chave of IMAGENS_DO_DISPLAY) {
      if (tem(chave) && contagemDe(valores, chave) < 1) problemas.push(`${local(chave)} (pelo menos 1 imagem)`);
    }
  }

  if (objetivo === 'performance_max' && valorDe(valores, 'campaign_pmax_brand_guidelines_enabled') === true) {
    problemas.push(`${local('campaign_pmax_brand_guidelines_enabled')} (só false foi comprovado; o modo ligado exige nome e logo vinculados à campanha, ainda não provados)`);
  }

  if (objetivo === 'demand_gen') {
    const orcamento = numeroDe(valores, 'budget_amount_micros');
    if (orcamento !== undefined && orcamento < ORCAMENTO_MINIMO_DO_DEMAND_GEN_EM_MICROS) {
      problemas.push(`${local('budget_amount_micros')} (Demand Gen exige pelo menos ${ORCAMENTO_MINIMO_DO_DEMAND_GEN_EM_MICROS} micros por dia)`);
    }
    const total = IMAGENS_DO_DEMAND_GEN.reduce((soma, chave) => soma + contagemDe(valores, chave), 0);
    if (total > MAXIMO_DE_IMAGENS_DO_DEMAND_GEN) problemas.push(`${local('ad_dg_marketing_images')} (imagens somam no máximo ${MAXIMO_DE_IMAGENS_DO_DEMAND_GEN}; veio ${total})`);
    if (tem('adgroup_dg_selected_channels') && tem('adgroup_dg_channel_strategy')) {
      problemas.push(`${local('adgroup_dg_selected_channels')} (não combina com adgroup_dg_channel_strategy; use um ou outro)`);
    }
    const canais = textosDe(valores, 'adgroup_dg_selected_channels');
    if (canais !== undefined) {
      if (canais.length < 1 || canais.length > CANAIS_DO_DEMAND_GEN.length) problemas.push(`${local('adgroup_dg_selected_channels')} (de 1 a ${CANAIS_DO_DEMAND_GEN.length} canais; veio ${canais.length})`);
      const invalidos = canais.filter((canal) => !CANAIS_DO_DEMAND_GEN.includes(canal));
      if (invalidos.length > 0) problemas.push(`${local('adgroup_dg_selected_channels')} (canal fora do conjunto provado: ${CANAIS_DO_DEMAND_GEN.join(', ')})`);
      if (new Set(canais).size !== canais.length) problemas.push(`${local('adgroup_dg_selected_channels')} (canais repetidos)`);
    }
    const formato = valorDe(valores, 'ad_dg_format');
    if (formato === 'MULTI_ASSET') {
      if (contagemDe(valores, 'ad_dg_marketing_images') + contagemDe(valores, 'ad_dg_square_marketing_images') < 1) {
        problemas.push(`${local('ad_dg_marketing_images')} (MULTI_ASSET exige ao menos uma imagem 1.91:1 ou 1:1)`);
      }
      for (const chave of CAMPOS_DO_VIDEO_DO_DEMAND_GEN.filter(tem)) problemas.push(`${local(chave)} (campo do formato VIDEO_RESPONSIVE; não vale em MULTI_ASSET)`);
    }
    if (formato === 'VIDEO_RESPONSIVE') {
      for (const chave of IMAGENS_DO_DEMAND_GEN.filter(tem)) problemas.push(`${local(chave)} (campo do formato MULTI_ASSET; não vale em VIDEO_RESPONSIVE)`);
      for (const chave of ['ad_dg_video_videos', 'ad_dg_video_long_headlines', 'ad_dg_name']) {
        if (!tem(chave)) problemas.push(`${local(chave)} (obrigatório com VIDEO_RESPONSIVE)`);
      }
    }
  }

  if (objetivo === 'multi_channel' && typeof estrategia === 'string') {
    const metaEsperada = META_DO_APP_POR_ESTRATEGIA[estrategia];
    const meta = valorDe(valores, 'campaign_app_goal_type');
    if (metaEsperada !== undefined && meta !== undefined && meta !== metaEsperada) {
      problemas.push(`${local('campaign_app_goal_type')} (${metaEsperada} é obrigatório com ${estrategia})`);
    }
  }
  return problemas;
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
  for (const [chave, { estrategia: chaveDaEstrategia, permitidas }] of Object.entries(ESTRATEGIAS_POR_CAMPO)) {
    const escolhida = valorDe(valores, chaveDaEstrategia);
    if (tem(chave) && (typeof escolhida !== 'string' || !permitidas.includes(escolhida))) {
      problemas.push(`${local(chaveDaEstrategia)} (${permitidas.join(' ou ')} é obrigatório com ${chave})`);
    }
  }
  for (const [chaveDaEstrategia, chaveDoCpa] of Object.entries(ESTRATEGIA_COM_CPA_OBRIGATORIO)) {
    if (valorDe(valores, chaveDaEstrategia) === 'TARGET_CPA' && !tem(chaveDoCpa)) {
      problemas.push(`${local(chaveDoCpa)} (obrigatório com TARGET_CPA)`);
    }
  }
  if (valorDe(valores, 'campaign_manual_cpc_enhanced') === true) {
    problemas.push(`${local('campaign_manual_cpc_enhanced')} (CPC melhorado foi descontinuado; a API recusa true)`);
  }

  if (tem('campaign_target_cpa_micros')) {
    if (typeof estrategia !== 'string' || !ESTRATEGIAS_COM_CPA.includes(estrategia)) {
      problemas.push(`${local('campaign_bidding_strategy')} (MAXIMIZE_CONVERSIONS ou TARGET_CPA é obrigatório com campaign_target_cpa_micros)`);
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

  for (const [chave, limites] of LIMITES_DE_LISTA) {
    const itens = textosDe(valores, chave);
    if (itens === undefined) continue;
    if (itens.length < limites.minimo || itens.length > limites.maximo) {
      problemas.push(`${local(chave)} (de ${limites.minimo} a ${limites.maximo} itens; veio ${itens.length})`);
    }
    const longos = limites.caracteres === undefined ? 0 : itens.filter((item) => item.length > limites.caracteres!).length;
    if (longos > 0) problemas.push(`${local(chave)} (${longos} item(ns) com mais de ${limites.caracteres} caracteres)`);
    if (new Set(itens.map((item) => item.trim().toLowerCase())).size !== itens.length) {
      problemas.push(`${local(chave)} (itens repetidos; a API recusa DUPLICATE_ASSET)`);
    }
  }

  for (const [chave, maximo] of LIMITES_DE_TEXTO) {
    const texto = valorDe(valores, chave);
    if (typeof texto === 'string' && texto.length > maximo) problemas.push(`${local(chave)} (mais de ${maximo} caracteres)`);
  }
  if (tem('ad_path2') && !tem('ad_path1')) problemas.push(`${local('ad_path1')} (obrigatório com ad_path2)`);
  if (tem('assetgroup_pmax_path2') && !tem('assetgroup_pmax_path1')) problemas.push(`${local('assetgroup_pmax_path1')} (obrigatório com assetgroup_pmax_path2)`);

  if (valorDe(valores, 'budget_delivery_method') === ENTREGA_RECUSADA) {
    problemas.push(`${local('budget_delivery_method')} (a API recusa ${ENTREGA_RECUSADA}; use STANDARD)`);
  }
  if (valorDe(valores, 'budget_explicitly_shared') === true && objetivo !== undefined && objetivo !== 'search') {
    problemas.push(`${local('budget_explicitly_shared')} (orçamento compartilhado só foi provado em Search; use false em ${objetivo})`);
  }
  if (valorDe(valores, 'budget_period') === PERIODO_COM_FIM) {
    if (objetivo !== undefined && objetivo !== 'search') {
      problemas.push(`${local('budget_period')} (${PERIODO_COM_FIM} só vale em Search; use DAILY em ${objetivo})`);
    } else if (!tem('campaign_end_date_time')) {
      problemas.push(`${local('campaign_end_date_time')} (obrigatório com orçamento ${PERIODO_COM_FIM})`);
    }
  }
  if (valorDe(valores, 'campaign_network_google_search') === false) {
    problemas.push(`${local('campaign_network_google_search')} (precisa ser true em Search)`);
  }

  const orcamento = numeroDe(valores, 'budget_amount_micros');
  if (orcamento !== undefined && (orcamento <= 0 || orcamento % MULTIPLO_MINIMO_DO_ORCAMENTO_EM_MICROS !== 0)) {
    problemas.push(`${local('budget_amount_micros')} (micros da moeda da conta, maior que 0 e múltiplo de ${MULTIPLO_MINIMO_DO_ORCAMENTO_EM_MICROS})`);
  }
  for (const chave of ['budget_amount_micros', ...CAMPOS_DE_LANCE_EM_MICROS]) {
    const micros = numeroDe(valores, chave);
    if (micros !== undefined && micros > TETO_EM_MICROS) problemas.push(`${local(chave)} (micros acima do teto de ${TETO_EM_MICROS})`);
  }
  for (const chave of CAMPOS_DE_LANCE_EM_MICROS) {
    const lance = numeroDe(valores, chave);
    if (lance !== undefined && lance <= 0) problemas.push(`${local(chave)} (micros da moeda da conta; precisa ser maior que 0)`);
  }
  for (const chave of CAMPOS_DE_LANCE_EM_MICROS) {
    const micros = numeroDe(valores, chave);
    if (micros !== undefined && micros > 0 && (!Number.isInteger(micros) || micros % MULTIPLO_MINIMO_DO_ORCAMENTO_EM_MICROS !== 0)) {
      problemas.push(`${local(chave)} (micros inteiros, múltiplo de ${MULTIPLO_MINIMO_DO_ORCAMENTO_EM_MICROS})`);
    }
  }
  for (const chave of CAMPOS_DE_ROAS) {
    const roas = numeroDe(valores, chave);
    if (roas !== undefined && (roas <= 0 || roas > ROAS_MAXIMO)) problemas.push(`${local(chave)} (razão decimal maior que 0 e até ${ROAS_MAXIMO})`);
  }
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
  problemas.push(...problemasDoCanal(valores, objetivo, local));
  return problemas;
}
