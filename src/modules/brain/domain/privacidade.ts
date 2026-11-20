import type { EntradaDoCatalogo } from './entrada.ts';

export type AchadoDePii = { readonly padrao: string; readonly trecho: string };

const PADROES: readonly { readonly nome: string; readonly regex: RegExp }[] = [
  { nome: 'email', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { nome: 'telefone', regex: /\+55\s?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b|\(\d{2}\)\s?9?\d{4}[-\s]?\d{4}\b|\b\d{2}\s9?\d{4}-\d{4}\b/g },
  { nome: 'cpf', regex: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g },
  { nome: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { nome: 'bearer', regex: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/gi },
  { nome: 'token_de_acesso', regex: /\b(?:EAA[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,})\b/g },
  { nome: 'segredo_em_chave', regex: /"(?:access_token|refresh_token|client_secret|password|senha|credential_ref|api_key)"\s*:/gi },
];

export function procurarPii(texto: string): readonly AchadoDePii[] {
  return PADROES.flatMap(({ nome, regex }) =>
    [...texto.matchAll(new RegExp(regex.source, regex.flags))].map((m) => ({ padrao: nome, trecho: m[0].slice(0, 12) })),
  );
}

const CAMPOS_DE_TEXTO_LIVRE = ['titulo', 'descricao', 'valorResumido'] as const;

export function piiNaEntrada(entrada: EntradaDoCatalogo): readonly AchadoDePii[] {
  const textos = CAMPOS_DE_TEXTO_LIVRE.map((campo) => entrada[campo] ?? '').join('\n');
  return [...procurarPii(textos), ...procurarPii(JSON.stringify(entrada.acesso))];
}

export function limparTextoLivre(texto: string): string {
  return PADROES.slice(0, 3).reduce((atual, { regex }) => atual.replace(new RegExp(regex.source, regex.flags), '[omitido]'), texto);
}
