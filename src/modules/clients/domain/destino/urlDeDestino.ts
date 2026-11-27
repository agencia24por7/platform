import { failure, type Failure } from '../../../../shared/result/failure.ts';
import { err, ok, type Result } from '../../../../shared/result/result.ts';

export const TAMANHO_MAXIMO_DA_URL = 2048;

const SUFIXOS_INTERNOS = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.private', '.invalid', '.test', '.example', '.onion', '.arpa'];
const CONTROLE_OU_ESPACO = /[\s\u0000-\u001f\u007f]/;
const IPV4_NUMERICO = /^[0-9.]+$/;
const TLD_VALIDO = /\.(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const ESQUEMA_HTTPS = /^https:\/{2}/i;

const invalida = (motivo: string): Result<string, Failure> => err(failure('validation', motivo));

export function validarUrlDeDestino(entrada: unknown): Result<string, Failure> {
  if (typeof entrada !== 'string') return invalida('Informe a URL como texto.');
  const texto = entrada.trim();
  if (texto.length === 0) return invalida('Informe a URL da página.');
  if (texto.length > TAMANHO_MAXIMO_DA_URL) return invalida(`URL maior que ${TAMANHO_MAXIMO_DA_URL} caracteres.`);
  if (CONTROLE_OU_ESPACO.test(texto)) return invalida('URL não pode ter espaço nem caractere de controle.');
  if (!ESQUEMA_HTTPS.test(texto)) return invalida('A URL precisa usar https.');

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return invalida('URL inválida.');
  }

  if (url.protocol !== 'https:') return invalida('A URL precisa usar https.');
  if (url.username !== '' || url.password !== '') return invalida('URL com usuário ou senha embutidos não é aceita.');
  if (url.port !== '') return invalida('URL com porta explícita não é aceita.');

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[') || host.includes(':') || IPV4_NUMERICO.test(host)) return invalida('Endereço IP não é aceito; use o domínio da página.');
  if (host === 'localhost' || SUFIXOS_INTERNOS.some((sufixo) => host.endsWith(sufixo))) return invalida('Host interno ou reservado não é aceito.');
  if (!host.includes('.') || !TLD_VALIDO.test(host)) return invalida('Domínio inválido.');
  if (host.length > 253 || host.split('.').some((rotulo) => rotulo.length === 0 || rotulo.length > 63)) return invalida('Domínio inválido.');

  url.hash = '';
  const normalizada = url.toString();
  if (normalizada.length > TAMANHO_MAXIMO_DA_URL) return invalida(`URL maior que ${TAMANHO_MAXIMO_DA_URL} caracteres.`);
  return ok(normalizada);
}
