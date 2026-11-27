import { formatarValor } from '../../clients/domain/regras/valor.ts';
import { comoValor, type Dinheiro } from '../domain/dinheiro.ts';

export const FUSO_DAS_DATAS = 'America/Sao_Paulo';

const FORMATO_DE_DATA_E_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: FUSO_DAS_DATAS,
});

const PADRAO_DE_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dataBr(iso: string): string {
  const partes = PADRAO_DE_DATA_ISO.exec(iso);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : iso;
}

export function periodoBr(periodo: { readonly inicio: string; readonly fim: string }): string {
  return `${dataBr(periodo.inicio)} a ${dataBr(periodo.fim)}`;
}

export function dataEHoraBr(data: Date): string {
  return FORMATO_DE_DATA_E_HORA.format(data);
}

export function reais(dinheiro: Dinheiro): string {
  return formatarValor(comoValor(dinheiro));
}

export function inteiroBr(quantidade: number): string {
  return quantidade.toLocaleString('pt-BR');
}

const PADRAO_DE_REAIS = /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+\.\d{1,2}$/;

export function centavosDeReais(bruto: string): string | null {
  const texto = bruto.replace(/^R\$\s*/i, '').trim();
  if (!PADRAO_DE_REAIS.test(texto)) return null;
  const normalizado = texto.includes(',') ? texto.replace(/\./g, '').replace(',', '.') : texto.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(texto) ? texto : texto.replace(/\./g, '');
  const [inteiro = '0', fracao = ''] = normalizado.split('.');
  const centavos = BigInt(inteiro) * 100n + BigInt(fracao.padEnd(2, '0').slice(0, 2) || '0');
  const resultado = centavos.toString();
  return resultado.length <= 15 ? resultado : null;
}
