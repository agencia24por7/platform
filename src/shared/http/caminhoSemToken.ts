const MARCA_DO_TOKEN = '[token]';

const SEPARADOR = String.raw`(?:/|\\/|\\u002f|%(?:25)*2f)+`;
const TOKEN = String.raw`[^\s/\\?#&;"'<>()\[\],%]+`;
const TOKEN_ENTRE_COLCHETES = String.raw`(?:\[|%5B)?${TOKEN}(?:\]|%5D)?`;
const DEPOIS_DE_SEPARADOR_OU_NAO_ALFANUMERICO = String.raw`(?:(?<![A-Za-z0-9])|(?<=2f))`;

function letraOuCodificada(letra: string): string {
  if (!/[A-Za-z]/.test(letra)) return letra;
  const hexMinuscula = letra.toLowerCase().charCodeAt(0).toString(16);
  const hexMaiuscula = letra.toUpperCase().charCodeAt(0).toString(16);
  return `(?:${letra}|%(?:25)*(?:${hexMinuscula}|${hexMaiuscula}))`;
}

function palavra(texto: string): string {
  return [...texto].map(letraOuCodificada).join('');
}

const VALOR_DA_QUERY = String.raw`(?:\[|%5B)?[^\s&#;"'<>()\[\],]+(?:\]|%5D)?`;
const INICIO_DE_CAMINHO = String.raw`(?<=(?:^|[\s"'(\[=,>]|%22|%27|%3D|://[^\s/]{1,253})(?:${SEPARADOR})?)`;
const NAO_E_A_PALAVRA_PUBLICO = String.raw`(?!publico(?![A-Za-z0-9_-]))`;

const TOKEN_NO_CAMINHO = new RegExp(
  `(?=${palavra('contexto')}|${palavra('convite')})${INICIO_DE_CAMINHO}((?:${palavra('contexto')}|${palavra('convite')})(?:;[^/\\s?#%]*)?(?:${SEPARADOR})(?:${palavra('publico')}(?:${SEPARADOR}))?)${NAO_E_A_PALAVRA_PUBLICO}${TOKEN_ENTRE_COLCHETES}`,
  'gi',
);
const TOKEN_NA_API = new RegExp(
  `(?=${palavra('api')})${INICIO_DE_CAMINHO}(${palavra('api')}(?:${SEPARADOR})(?:${palavra('convite')}(?:${SEPARADOR})|${palavra('contexto')}(?:${SEPARADOR})${palavra('publico')}(?:${SEPARADOR})))${TOKEN_ENTRE_COLCHETES}`,
  'gi',
);
const TOKEN_NO_WEBHOOK = new RegExp(
  `${DEPOIS_DE_SEPARADOR_OU_NAO_ALFANUMERICO}(${palavra('webhooks')}(?:${SEPARADOR})${TOKEN}(?:${SEPARADOR}))${TOKEN_ENTRE_COLCHETES}`,
  'gi',
);
const TOKEN_NA_EXCLUSAO = new RegExp(
  `${DEPOIS_DE_SEPARADOR_OU_NAO_ALFANUMERICO}(${palavra('exclusao-de-dados')}(?:${SEPARADOR})${palavra('status')}(?:${SEPARADOR}))${TOKEN_ENTRE_COLCHETES}`,
  'gi',
);
const TOKEN_NA_QUERY = new RegExp(`((?:[?&;#]|%3F|%26|%23)(?:t|token|code|state)(?:=|%3D))${VALOR_DA_QUERY}`, 'gi');

const TROCA_PELO_PREFIXO = `$1${MARCA_DO_TOKEN}`;

export function mascararTokensEmTexto(texto: string): string {
  return texto
    .replace(TOKEN_NO_CAMINHO, TROCA_PELO_PREFIXO)
    .replace(TOKEN_NA_API, TROCA_PELO_PREFIXO)
    .replace(TOKEN_NO_WEBHOOK, TROCA_PELO_PREFIXO)
    .replace(TOKEN_NA_EXCLUSAO, TROCA_PELO_PREFIXO)
    .replace(TOKEN_NA_QUERY, TROCA_PELO_PREFIXO);
}
