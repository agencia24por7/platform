import { err, ok, type Result } from '../../../shared/result/result.ts';
import { dataIsoValida } from '../domain/datas.ts';
import { dinheiroDeCentavos } from '../domain/dinheiro.ts';
import { centavosDeReais, reais } from './formatosDoPlano.ts';

export type CamposDaVerba = Readonly<Record<string, string | undefined>>;
export type PeriodoDaVerba = { readonly inicio: string; readonly fim: string };

export const MODOS_DA_VERBA = ['periodo', 'mensal'] as const;
export type ModoDaVerba = (typeof MODOS_DA_VERBA)[number];
export const MODO_DA_VERBA_PADRAO: ModoDaVerba = 'periodo';

export const ROTULO_DO_MODO_DA_VERBA: Readonly<Record<ModoDaVerba, string>> = {
  periodo: 'Total do período',
  mensal: 'Por mês',
};

const DIAS_DO_MES_COMERCIAL = 30n;
const MILISSEGUNDOS_POR_DIA = 86_400_000;
const MAXIMO_DE_DIGITOS_EM_CENTAVOS = 15;

export function modoDaVerba(bruto: string | undefined): ModoDaVerba | null {
  const texto = (bruto ?? '').trim();
  if (texto === '') return MODO_DA_VERBA_PADRAO;
  return MODOS_DA_VERBA.find((modo) => modo === texto) ?? null;
}

export function periodoDaVerba(campos: CamposDaVerba): PeriodoDaVerba | null {
  const inicio = (campos['inicio'] ?? '').trim();
  const fim = (campos['fim'] ?? '').trim();
  return dataIsoValida(inicio) && dataIsoValida(fim) && inicio <= fim ? { inicio, fim } : null;
}

export function diasDoHorizonte(periodo: PeriodoDaVerba): number {
  const inicio = Date.parse(`${periodo.inicio}T00:00:00.000Z`);
  const fim = Date.parse(`${periodo.fim}T00:00:00.000Z`);
  return Math.round((fim - inicio) / MILISSEGUNDOS_POR_DIA) + 1;
}

function dividirArredondando(numerador: bigint, denominador: bigint): bigint {
  return (2n * numerador + denominador) / (2n * denominador);
}

export function totalDoHorizonteEmCentavos(centavosPorMes: bigint, dias: number): bigint {
  return dividirArredondando(centavosPorMes * BigInt(dias), DIAS_DO_MES_COMERCIAL);
}

export function equivalentePorMesEmCentavos(centavosDoHorizonte: bigint, dias: number): bigint {
  return dividirArredondando(centavosDoHorizonte * DIAS_DO_MES_COMERCIAL, BigInt(dias));
}

function validarTotal(total: bigint): Result<string, string> {
  if (total <= 0n) return err('A verba precisa ser maior que zero.');
  const texto = total.toString();
  if (texto.length > MAXIMO_DE_DIGITOS_EM_CENTAVOS) return err('A verba total passa do limite aceito.');
  return ok(texto);
}

export function lerVerbaDoFormulario(campos: CamposDaVerba, periodo: PeriodoDaVerba | null): Result<string | null, string> {
  const modo = modoDaVerba(campos['modoDaVerba']);
  if (modo === null) return err('Escolha se a verba é por mês ou do período todo.');
  const digitados = centavosDeReais((campos['verba'] ?? '').trim());
  if (digitados === null) return err('Informe a verba em reais, por exemplo 15.000,00.');
  if (modo === 'periodo') return validarTotal(BigInt(digitados));
  if (periodo === null) return ok(null);
  return validarTotal(totalDoHorizonteEmCentavos(BigInt(digitados), diasDoHorizonte(periodo)));
}

export type ResumoDaVerba = {
  readonly modo: ModoDaVerba;
  readonly dias: number;
  readonly total: string;
  readonly porMes: string;
  readonly convertida: boolean;
};

const SEM_PERIODO_VALIDO = 'Informe datas válidas de início e fim para calcular a verba.';

export function resumoDaVerba(campos: CamposDaVerba): Result<ResumoDaVerba, string> {
  const periodo = periodoDaVerba(campos);
  const total = lerVerbaDoFormulario(campos, periodo);
  if (!total.ok) return err(total.error);
  if (periodo === null || total.value === null) return err(SEM_PERIODO_VALIDO);
  const modo = modoDaVerba(campos['modoDaVerba']) ?? MODO_DA_VERBA_PADRAO;
  const dias = diasDoHorizonte(periodo);
  const digitados = BigInt(centavosDeReais((campos['verba'] ?? '').trim()) ?? '0');
  const centavosPorMes = modo === 'mensal' ? digitados : equivalentePorMesEmCentavos(BigInt(total.value), dias);
  return ok({
    modo,
    dias,
    total: reais(dinheiroDeCentavos(BigInt(total.value))),
    porMes: reais(dinheiroDeCentavos(centavosPorMes)),
    convertida: modo === 'mensal',
  });
}
