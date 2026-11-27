import { failure, type Failure } from '../../../../shared/result/failure.ts';
import { err, ok, type Result } from '../../../../shared/result/result.ts';

const CARACTERES_PERMITIDOS = /^\+?[0-9 ().-]+$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const DDD_BRASIL = /^[1-9][0-9]$/;
const TAMANHO_MAXIMO_DA_ENTRADA = 32;

const invalido = (motivo: string): Result<string, Failure> => err(failure('validation', motivo));

function brasileiro(nacional: string): Result<string, Failure> {
  if (nacional.length !== 10 && nacional.length !== 11) return invalido('WhatsApp brasileiro: informe DDD e número (10 ou 11 dígitos).');
  if (!DDD_BRASIL.test(nacional.slice(0, 2))) return invalido('WhatsApp brasileiro: DDD inválido.');
  const numero = nacional.slice(2);
  if (numero.length === 9 && numero[0] !== '9') return invalido('WhatsApp brasileiro: celular com 9 dígitos começa com 9.');
  if (numero.length === 8 && !/^[2-9]/.test(numero)) return invalido('WhatsApp brasileiro: número inválido.');
  if (/^(\d)\1+$/.test(numero)) return invalido('WhatsApp brasileiro: número inválido.');
  return ok(`+55${nacional}`);
}

export function normalizarWhatsapp(entrada: unknown): Result<string, Failure> {
  if (typeof entrada !== 'string') return invalido('Informe o WhatsApp como texto.');
  const texto = entrada.trim();
  if (texto.length === 0) return invalido('Informe o WhatsApp.');
  if (texto.length > TAMANHO_MAXIMO_DA_ENTRADA) return invalido('WhatsApp longo demais.');
  if (!CARACTERES_PERMITIDOS.test(texto) || texto.lastIndexOf('+') > 0) return invalido('WhatsApp aceita só dígitos, espaço, parênteses, hífen, ponto e + no início.');

  const digitos = texto.replace(/\D/g, '');
  const comMais = texto.startsWith('+');
  const comZeroZero = texto.startsWith('00');
  const internacional = comMais ? digitos : comZeroZero ? digitos.slice(2) : null;

  if (internacional === null) {
    if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) return brasileiro(digitos.slice(2));
    return brasileiro(digitos.replace(/^0/, ''));
  }
  if (internacional.startsWith('55')) return brasileiro(internacional.slice(2));
  const e164 = `+${internacional}`;
  return E164.test(e164) ? ok(e164) : invalido('WhatsApp fora do formato internacional (E.164).');
}
