import { z } from 'zod';
import type { CampoLista, CampoSimples, Opcao } from './catalogo.ts';
import type { DadosDoItem } from './tipos.ts';

const MAX_URL = 2048;
const MAX_OUTRO = 80;
const HANDLE = /^[A-Za-z0-9._-]{1,60}$/;
const PARECE_URL = /^(https?:[/][/])?([a-z0-9-]+[.])+[a-z]{2,}[/]/i;

const HOSTS_DE_PERFIL: Record<string, RegExp> = {
  'instagram.com': /^[/]([^/?#]+)/,
  'tiktok.com': /^[/]@?([^/?#]+)/,
  'x.com': /^[/]([^/?#]+)/,
  'twitter.com': /^[/]([^/?#]+)/,
  'threads.net': /^[/]@?([^/?#]+)/,
  'threads.com': /^[/]@?([^/?#]+)/,
  'youtube.com': /^[/]@([^/?#]+)/,
  'facebook.com': /^[/]([^/?#]+)/,
  'pinterest.com': /^[/]([^/?#]+)/,
  'linkedin.com': /^[/](?:in|company)[/]([^/?#]+)/,
  'kwai.com': /^[/]@?([^/?#]+)/,
};

export function normalizarEspacos(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

export function normalizarTextoLongo(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizarUrl(bruto: string): string | null {
  const texto = bruto.trim();
  if (texto.length === 0 || texto.length > MAX_URL || /\s/.test(texto)) return null;

  const comEsquema = /^[a-z][a-z0-9+.-]*:/i.test(texto) ? texto : `https:${'/'.repeat(2)}${texto.replace(/^[/]+/, '')}`;
  let endereco: URL;
  try {
    endereco = new URL(comEsquema);
  } catch {
    return null;
  }
  if (endereco.protocol !== 'https:' && endereco.protocol !== 'http:') return null;
  if (!endereco.hostname.includes('.') || endereco.username || endereco.password) return null;

  endereco.hostname = endereco.hostname.toLowerCase();
  endereco.hash = '';
  const href = endereco.href;
  return endereco.pathname === '/' && !endereco.search ? href.replace(/[/]$/, '') : href;
}

function hostSemWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^(www|m|mobile)[.]/, '');
}

export function normalizarArroba(bruto: string): string {
  const texto = normalizarEspacos(bruto);
  if (texto.length === 0) return texto;

  if (PARECE_URL.test(texto)) {
    const url = normalizarUrl(texto);
    if (url) {
      const endereco = new URL(url);
      const padrao = HOSTS_DE_PERFIL[hostSemWww(endereco.hostname)];
      const achado = padrao?.exec(endereco.pathname)?.[1];
      if (achado && HANDLE.test(achado)) return `@${achado}`;
    }
    return texto;
  }

  const semArroba = texto.replace(/^@+/, '');
  return HANDLE.test(semArroba) ? `@${semArroba}` : texto;
}

function numeroDeTexto(bruto: unknown): unknown {
  if (typeof bruto !== 'string') return bruto;
  const limpo = bruto.trim().replace(/^R\$\s*/i, '').replace(/\s|%/g, '');
  if (limpo.length === 0) return null;
  const virgulaDecimal = /,\d{1,2}$/.test(limpo) || (limpo.includes(',') && !limpo.includes('.'));
  const pontoDeMilhar = /^-?\d{1,3}([.]\d{3})+$/.test(limpo);
  const decimal = virgulaDecimal || pontoDeMilhar
    ? limpo.replace(/[.]/g, '').replace(',', '.')
    : limpo.replace(/,/g, '');
  const valor = Number(decimal);
  return Number.isFinite(valor) ? valor : bruto;
}

function opcaoValida(opcoes: readonly Opcao[], permiteOutro: boolean, valor: string): boolean {
  return opcoes.some((opcao) => opcao.valor === valor) || (permiteOutro && valor.length <= MAX_OUTRO);
}

export function normalizarValor(campo: CampoSimples, bruto: unknown): unknown {
  if (bruto === undefined || bruto === null) return null;

  switch (campo.tipo) {
    case 'texto': {
      if (typeof bruto !== 'string') return bruto;
      const texto = campo.formato === 'arroba' ? normalizarArroba(bruto) : normalizarEspacos(bruto);
      return texto.length === 0 ? null : texto;
    }
    case 'texto_longo': {
      if (typeof bruto !== 'string') return bruto;
      const texto = normalizarTextoLongo(bruto);
      return texto.length === 0 ? null : texto;
    }
    case 'url': {
      if (typeof bruto !== 'string') return bruto;
      if (bruto.trim().length === 0) return null;
      return normalizarUrl(bruto) ?? bruto;
    }
    case 'selecao': {
      if (typeof bruto !== 'string') return bruto;
      const texto = normalizarEspacos(bruto);
      return texto.length === 0 ? null : texto;
    }
    case 'multipla': {
      const lista = Array.isArray(bruto) ? bruto : [bruto];
      if (!lista.every((item) => typeof item === 'string')) return bruto;
      const limpos = [...new Set((lista as string[]).map(normalizarEspacos).filter((item) => item.length > 0))];
      return limpos.length === 0 ? null : limpos;
    }
    case 'numero':
    case 'escala':
      return numeroDeTexto(bruto);
    case 'dinheiro': {
      if (typeof bruto !== 'string') return bruto;
      const reais = numeroDeTexto(bruto);
      return typeof reais === 'number' ? Math.round(reais * 100) : reais;
    }
    case 'booleano':
      if (bruto === 'sim' || bruto === 'true') return true;
      if (bruto === 'nao' || bruto === 'false') return false;
      return bruto;
    case 'arquivo': {
      const lista = Array.isArray(bruto) ? bruto : [bruto];
      return lista.length === 0 ? null : [...new Set(lista)];
    }
  }
}

function textoComLimite(max: number): z.ZodType<unknown> {
  return z
    .string({ error: 'Informe um texto.' })
    .min(1, 'Preencha o campo.')
    .max(max, `Use no máximo ${max} caracteres.`);
}

export function esquemaDoCampo(campo: CampoSimples): z.ZodType<unknown> {
  switch (campo.tipo) {
    case 'texto':
    case 'texto_longo':
      return textoComLimite(campo.max);
    case 'url':
      return z
        .string({ error: 'Informe um endereço.' })
        .max(MAX_URL, 'Endereço longo demais.')
        .refine((valor) => normalizarUrl(valor) === valor, 'Informe um endereço http(s) válido.');
    case 'selecao':
      return z
        .string({ error: 'Escolha uma das opções.' })
        .refine((valor) => opcaoValida(campo.opcoes, campo.permiteOutro, valor), 'Escolha uma das opções.');
    case 'multipla':
      return z
        .array(z.string(), { error: 'Escolha as opções.' })
        .min(1, 'Escolha ao menos uma opção.')
        .max(campo.maxEscolhas, `Escolha no máximo ${campo.maxEscolhas} opções.`)
        .refine(
          (valores) => valores.every((valor) => opcaoValida(campo.opcoes, campo.permiteOutro, valor)),
          'Há uma opção que não vale para este campo.',
        );
    case 'numero': {
      const base = z
        .number({ error: 'Informe um número.' })
        .min(campo.min, `O mínimo é ${campo.min}.`)
        .max(campo.max, `O máximo é ${campo.max}.`);
      return campo.inteiro ? base.int('Use um número inteiro.') : base;
    }
    case 'dinheiro':
      return z
        .number({ error: 'Informe um valor.' })
        .int('Valor em centavos inteiros.')
        .min(0, 'O valor não pode ser negativo.')
        .max(campo.maxCentavos, 'Valor alto demais.');
    case 'escala':
      return z
        .number({ error: 'Escolha um ponto da escala.' })
        .int('Escolha um ponto da escala.')
        .min(campo.min, 'Escolha um ponto da escala.')
        .max(campo.max, 'Escolha um ponto da escala.');
    case 'booleano':
      return z.boolean({ error: 'Responda sim ou não.' });
    case 'arquivo':
      return z
        .array(z.uuid({ error: 'Arquivo inválido.' }), { error: 'Arquivo inválido.' })
        .min(1)
        .max(campo.maxArquivos, `No máximo ${campo.maxArquivos} arquivos.`);
  }
}

export type ValorValidado = { readonly ok: true; readonly valor: unknown } | { readonly ok: false; readonly erro: string };

export function validarValor(campo: CampoSimples, bruto: unknown): ValorValidado {
  const normalizado = normalizarValor(campo, bruto);
  if (normalizado === null) return { ok: true, valor: null };

  const resultado = esquemaDoCampo(campo).safeParse(normalizado);
  if (!resultado.success) {
    return { ok: false, erro: resultado.error.issues[0]?.message ?? 'Valor inválido.' };
  }
  return { ok: true, valor: resultado.data };
}

export type ItemValidado =
  | { readonly ok: true; readonly dados: DadosDoItem }
  | { readonly ok: false; readonly erros: Readonly<Record<string, string>> };

export function validarItem(lista: CampoLista, bruto: unknown): ItemValidado {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return { ok: false, erros: { _item: 'Item inválido.' } };
  }

  const entrada = bruto as Record<string, unknown>;
  const erros: Record<string, string> = {};
  const dados: Record<string, unknown> = {};

  for (const chave of Object.keys(entrada)) {
    if (!lista.item.some((campo) => campo.key === chave)) erros[chave] = 'Campo desconhecido.';
  }

  for (const campo of lista.item) {
    const resultado = validarValor(campo, entrada[campo.key]);
    if (!resultado.ok) {
      erros[campo.key] = resultado.erro;
      continue;
    }
    if (resultado.valor === null) {
      if (campo.obrigatorio) erros[campo.key] = `Preencha “${campo.rotulo}”.`;
      continue;
    }
    dados[campo.key] = resultado.valor;
  }

  return Object.keys(erros).length > 0 ? { ok: false, erros } : { ok: true, dados };
}

export function valorPreenchido(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === 'string') return valor.trim().length > 0;
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}

export function rotuloDaOpcao(opcoes: readonly Opcao[], valor: string): string {
  return opcoes.find((opcao) => opcao.valor === valor)?.rotulo ?? valor;
}
