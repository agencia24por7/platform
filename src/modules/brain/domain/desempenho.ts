import { hojeEmSaoPaulo, somarDias } from './tempo.ts';

export const PLATAFORMAS_DE_DESEMPENHO = ['meta', 'google'] as const;
export const RECORTES_DE_DESEMPENHO = ['total', 'campanha', 'idade_genero', 'regiao', 'dispositivo', 'posicionamento'] as const;
export type RecorteDeDesempenho = (typeof RECORTES_DE_DESEMPENHO)[number];

export const DIAS_DE_CARENCIA = 3;
export const MESES_DA_SERIE = 6;
export const MESES_DA_JANELA = 3;
export const MAXIMO_DE_CAMPANHAS = 10;
export const MAXIMO_DE_FATIAS = 8;
export const MOEDA_MISTA = 'XXX';
export const NAO_DISPONIVEL = 'n/d';

export type LinhaDeDesempenho = {
  readonly platform: string;
  readonly periodo: string;
  readonly recorte: RecorteDeDesempenho;
  readonly chave: string;
  readonly rotulo: string;
  readonly investimentoCentavos: number;
  readonly impressoes: number;
  readonly cliques: number;
  readonly conversoes: number;
  readonly receitaCentavos: number | null;
  readonly moeda: string;
};

export type EscopoMedido = { readonly platform: string; readonly recorte: RecorteDeDesempenho };

export type ResultadoDaMedicaoDeDesempenho = {
  readonly linhas: readonly LinhaDeDesempenho[];
  readonly medidos: readonly EscopoMedido[];
  readonly falhas: readonly string[];
};

export type DesempenhoMedido = LinhaDeDesempenho & { readonly medidoEm: Date };

export type JanelaDeDesempenho = {
  readonly inicioDaSerie: string;
  readonly fimDaSerie: string;
  readonly inicioDaJanela: string;
};

export function somarMeses(primeiroDia: string, meses: number): string {
  const [ano, mes] = primeiroDia.split('-').map(Number) as [number, number];
  const indice = ano * 12 + (mes - 1) + meses;
  return `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}-01`;
}

export function primeiroMesAindaAberto(agora: Date): string {
  const hoje = hojeEmSaoPaulo(agora);
  const mesCorrente = `${hoje.slice(0, 7)}-01`;
  return Number(hoje.slice(8, 10)) <= DIAS_DE_CARENCIA ? somarMeses(mesCorrente, -1) : mesCorrente;
}

export function janelaDeDesempenho(agora: Date): JanelaDeDesempenho {
  const fim = primeiroMesAindaAberto(agora);
  return {
    inicioDaSerie: somarMeses(fim, -MESES_DA_SERIE),
    fimDaSerie: fim,
    inicioDaJanela: somarMeses(fim, -MESES_DA_JANELA),
  };
}

export function ultimoDiaDoMes(primeiroDia: string): string {
  return somarDias(somarMeses(primeiroDia, 1), -1);
}

export function ultimoDiaDaJanela(inicioDaJanela: string): string {
  return somarDias(somarMeses(inicioDaJanela, MESES_DA_JANELA), -1);
}

const dividir = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export type Derivados = {
  readonly ctr: number | null;
  readonly custoPorCliqueCentavos: number | null;
  readonly custoPorConversaoCentavos: number | null;
  readonly roas: number | null;
};

export function derivadosDe(linha: Pick<LinhaDeDesempenho, 'investimentoCentavos' | 'impressoes' | 'cliques' | 'conversoes' | 'receitaCentavos'>): Derivados {
  const cpc = dividir(linha.investimentoCentavos, linha.cliques);
  const cpa = dividir(linha.investimentoCentavos, linha.conversoes);
  const ctr = dividir(linha.cliques, linha.impressoes);
  const roas = linha.receitaCentavos === null ? null : dividir(linha.receitaCentavos, linha.investimentoCentavos);
  return {
    ctr: ctr === null ? null : ctr * 100,
    custoPorCliqueCentavos: cpc === null ? null : Math.round(cpc),
    custoPorConversaoCentavos: cpa === null ? null : Math.round(cpa),
    roas,
  };
}

function agruparMilhares(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatarNumero(valor: number, casas = 0): string {
  const [inteiro = '0', decimal] = Math.abs(valor).toFixed(casas).split('.');
  const sinal = valor < 0 ? '-' : '';
  return `${sinal}${agruparMilhares(inteiro)}${decimal ? `,${decimal}` : ''}`;
}

export function formatarConversoes(valor: number): string {
  const texto = formatarNumero(valor, 2);
  return texto.replace(/,00$/, '').replace(/(,\d)0$/, '$1');
}

export function formatarDinheiro(centavos: number, moeda: string): string {
  const valor = formatarNumero(centavos / 100, 2);
  if (moeda === 'BRL') return `R$ ${valor}`;
  if (moeda === MOEDA_MISTA) return `${valor} (moedas mistas)`;
  return `${moeda} ${valor}`;
}

const orNd = (valor: string | null) => valor ?? NAO_DISPONIVEL;

export function resumoDeMetricas(linha: LinhaDeDesempenho): string {
  const d = derivadosDe(linha);
  const partes = [
    `investimento ${formatarDinheiro(linha.investimentoCentavos, linha.moeda)}`,
    `impressões ${formatarNumero(linha.impressoes)}`,
    `cliques ${formatarNumero(linha.cliques)}`,
    `conversões ${formatarConversoes(linha.conversoes)}`,
    `receita ${linha.receitaCentavos === null ? NAO_DISPONIVEL : formatarDinheiro(linha.receitaCentavos, linha.moeda)}`,
    `CTR ${orNd(d.ctr === null ? null : `${formatarNumero(d.ctr, 2)}%`)}`,
    `custo por clique ${orNd(d.custoPorCliqueCentavos === null ? null : formatarDinheiro(d.custoPorCliqueCentavos, linha.moeda))}`,
    `custo por conversão ${orNd(d.custoPorConversaoCentavos === null ? null : formatarDinheiro(d.custoPorConversaoCentavos, linha.moeda))}`,
    `ROAS ${orNd(d.roas === null ? null : `${formatarNumero(d.roas, 2)}x`)}`,
  ];
  return partes.join('; ');
}

export function linhaCompacta(linha: LinhaDeDesempenho, rotulo: string, participacao: number | null): string {
  const d = derivadosDe(linha);
  const partes = [
    `${rotulo}: ${formatarDinheiro(linha.investimentoCentavos, linha.moeda)}${participacao === null ? '' : ` (${formatarNumero(participacao, 1)}%)`}`,
    `${formatarConversoes(linha.conversoes)} conv.`,
    `CPA ${orNd(d.custoPorConversaoCentavos === null ? null : formatarDinheiro(d.custoPorConversaoCentavos, linha.moeda))}`,
  ];
  return partes.join(', ');
}
