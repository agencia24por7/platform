import { createHash } from 'node:crypto';
import {
  CATALOGO,
  ROTULO_EPISTEMICO,
  ROTULO_FONTE,
  VERSAO_DO_CATALOGO,
  type CampoLista,
  type CampoSimples,
  type Secao,
} from './catalogo.ts';
import { caminhoDoBrain } from './arquivos.ts';
import { calcularCompletude } from './completude.ts';
import { jsonEstavel } from './jsonEstavel.ts';
import { entraNoBrain, type ArquivoDeContexto, type ContextoBruto, type ItemDeLista, type Marcacao } from './tipos.ts';
import { rotuloDaOpcao, valorPreenchido } from './valores.ts';

export const VERSAO_DO_BRAIN = 1;

export type EntradaDoBrain = {
  readonly organizationId: string;
  readonly clientId: string;
  readonly nomeDoCliente: string;
  readonly contexto: ContextoBruto;
  readonly geradoEm: Date;
};

export type ArquivoDoBrain = {
  readonly nome: string;
  readonly caminho: string;
  readonly contentType: string;
  readonly conteudo: string;
};

export type Manifesto = {
  readonly schemaVersion: number;
  readonly catalogoVersao: number;
  readonly organizationId: string;
  readonly clientId: string;
  readonly generatedAt: string;
  readonly contentHash: string;
  readonly counts: {
    readonly campos: number;
    readonly itens: Readonly<Record<string, number>>;
    readonly arquivos: number;
  };
  readonly completude: { readonly geral: number; readonly secoes: Readonly<Record<string, number>> };
  readonly arquivos: readonly { readonly nome: string; readonly sha256: string; readonly bytes: number }[];
};

export type Brain = {
  readonly arquivos: readonly ArquivoDoBrain[];
  readonly manifesto: Manifesto;
  readonly contentHash: string;
};

const MARKDOWN = 'text/markdown; charset=utf-8';
const JSON_TIPO = 'application/json';
const JSONL = 'application/x-ndjson';

function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

export function formatarCentavos(centavos: number): string {
  const negativo = centavos < 0;
  const absoluto = Math.abs(Math.round(centavos));
  const reais = Math.floor(absoluto / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = (absoluto % 100).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}R$ ${reais},${resto}`;
}

function formatarNumero(valor: number): string {
  const [inteiro = '0', fracao] = valor.toString().split('.');
  const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fracao ? `${milhar},${fracao}` : milhar;
}

export function formatarValor(campo: CampoSimples, valor: unknown, arquivos: readonly ArquivoDeContexto[]): string {
  switch (campo.tipo) {
    case 'texto':
    case 'texto_longo':
    case 'url':
      return String(valor);
    case 'selecao':
      return rotuloDaOpcao(campo.opcoes, String(valor));
    case 'multipla':
      return (valor as string[]).map((v) => rotuloDaOpcao(campo.opcoes, v)).join(', ');
    case 'numero': {
      const numero = formatarNumero(Number(valor));
      if (!campo.unidade) return numero;
      return campo.unidade === '%' ? `${numero}%` : `${numero} ${campo.unidade}`;
    }
    case 'dinheiro':
      return formatarCentavos(Number(valor));
    case 'escala':
      return `${String(valor)} de ${campo.max} (1 = ${campo.extremos[0]}, ${campo.max} = ${campo.extremos[1]})`;
    case 'booleano':
      return valor ? 'Sim' : 'Não';
    case 'arquivo': {
      const ids = Array.isArray(valor) ? (valor as string[]) : [];
      return arquivos
        .filter((arquivo) => ids.includes(arquivo.id))
        .map((arquivo) => `${arquivo.nome} (${arquivo.mime})`)
        .join(', ');
    }
  }
}

function etiqueta(marcacao: Pick<Marcacao, 'epistemico' | 'fonte'>): string {
  return `_(${ROTULO_EPISTEMICO[marcacao.epistemico]} · fonte: ${ROTULO_FONTE[marcacao.fonte]})_`;
}

function comDoisPontos(rotulo: string): string {
  return /[?:]$/.test(rotulo) ? rotulo : `${rotulo}:`;
}

function linhaDeValor(rotulo: string, texto: string, sufixo: string, multilinha: boolean): string[] {
  if (!multilinha && !texto.includes('\n')) return [`- **${comDoisPontos(rotulo)}** ${texto} ${sufixo}`.trimEnd()];
  const titulo = `- **${comDoisPontos(rotulo)}** ${sufixo}`.trimEnd();
  return [titulo, '', ...texto.split('\n').map((l) => (l ? `  ${l}` : '')), ''];
}

type Organizado = {
  readonly entradas: ReadonlyMap<string, ContextoBruto['campos'][number]>;
  readonly itens: ReadonlyMap<string, readonly ItemDeLista[]>;
  readonly arquivosPorCampo: ReadonlyMap<string, readonly ArquivoDeContexto[]>;
  readonly arquivos: readonly ArquivoDeContexto[];
};

function organizar(contexto: ContextoBruto): Organizado {
  const entradas = new Map(
    contexto.campos.filter((e) => entraNoBrain(e) && valorPreenchido(e.valor)).map((e) => [e.fieldKey, e]),
  );
  const itens = new Map<string, ItemDeLista[]>();
  for (const item of contexto.itens.filter(entraNoBrain)) {
    const lista = itens.get(item.listKey) ?? [];
    lista.push(item);
    itens.set(item.listKey, lista);
  }
  for (const lista of itens.values()) lista.sort((a, b) => a.posicao - b.posicao || a.id.localeCompare(b.id));

  const arquivos = [...contexto.arquivos].sort((a, b) => a.id.localeCompare(b.id));
  const arquivosPorCampo = new Map<string, ArquivoDeContexto[]>();
  for (const arquivo of arquivos.filter((a) => a.itemId === null)) {
    const lista = arquivosPorCampo.get(arquivo.fieldKey) ?? [];
    lista.push(arquivo);
    arquivosPorCampo.set(arquivo.fieldKey, lista);
  }
  return { entradas, itens, arquivosPorCampo, arquivos };
}

function valorDoCampo(campo: CampoSimples, org: Organizado): { texto: string; marcacao: Marcacao } | null {
  const entrada = org.entradas.get(campo.key);
  if (campo.tipo === 'arquivo') {
    const anexos = org.arquivosPorCampo.get(campo.key) ?? [];
    if (anexos.length === 0) return null;
    const texto = anexos.map((a) => `${a.nome} (${a.mime})`).join(', ');
    return {
      texto,
      marcacao: entrada ?? { epistemico: 'fato', fonte: anexos[0]!.fonte, revisao: 'confirmado', compartilhavel: false },
    };
  }
  if (!entrada) return null;
  return { texto: formatarValor(campo, entrada.valor, org.arquivos), marcacao: entrada };
}

function markdownDaLista(campo: CampoLista, itens: readonly ItemDeLista[], org: Organizado): string[] {
  const linhas = [`### ${campo.rotulo}`, ''];
  if (itens.length === 0) return [...linhas, '_Nenhum item confirmado._', ''];

  itens.forEach((item, indice) => {
    const titulo = item.dados[campo.campoTitulo];
    linhas.push(`#### ${indice + 1}. ${titulo === undefined ? campo.rotuloDoItem : String(titulo)}`, '');
    linhas.push(`- **id:** \`${item.id}\` ${etiqueta(item)}`);
    for (const sub of campo.item) {
      const valor = item.dados[sub.key];
      if (!valorPreenchido(valor) || sub.key === campo.campoTitulo) continue;
      linhas.push(...linhaDeValor(sub.rotulo, formatarValor(sub, valor, org.arquivos), '', sub.tipo === 'texto_longo'));
    }
    linhas.push('');
  });
  return linhas;
}

function markdownDaSecao(secao: Secao, org: Organizado): string[] {
  const linhas = [`## ${secao.letra}. ${secao.titulo}`, ''];
  const simples: string[] = [];
  const listas: string[] = [];

  for (const campo of secao.campos) {
    if (campo.tipo === 'lista') {
      listas.push(...markdownDaLista(campo, org.itens.get(campo.key) ?? [], org));
      continue;
    }
    const valor = valorDoCampo(campo, org);
    if (!valor) continue;
    simples.push(...linhaDeValor(campo.rotulo, valor.texto, etiqueta(valor.marcacao), campo.tipo === 'texto_longo'));
  }

  if (simples.length === 0 && listas.every((l) => !l.startsWith('#### '))) {
    linhas.push('_Sem dados confirmados nesta seção._', '');
    return linhas;
  }
  return [...linhas, ...simples, ...(simples.length > 0 ? [''] : []), ...listas];
}

function perfilMarkdown(entrada: EntradaDoBrain, org: Organizado): string {
  const cabecalho = [
    `# Contexto do cliente: ${entrada.nomeDoCliente}`,
    '',
    `> Mapa de contexto exportado pela Orla (esquema ${VERSAO_DO_BRAIN}, catálogo ${VERSAO_DO_CATALOGO}). ` +
      'Só entram dados confirmados; cada informação traz o status (Fato, Hipótese ou Desejo) e a fonte.',
    '',
  ];
  const corpo = CATALOGO.flatMap((secao) => markdownDaSecao(secao, org));
  return `${[...cabecalho, ...corpo].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function itemJson(item: ItemDeLista) {
  return {
    id: item.id,
    secao: item.secao,
    lista: item.listKey,
    posicao: item.posicao,
    epistemico: item.epistemico,
    fonte: item.fonte,
    dados: item.dados,
  };
}

function perfilJson(entrada: EntradaDoBrain, org: Organizado): string {
  const secoes = CATALOGO.map((secao) => {
    const campos: Record<string, unknown> = {};
    const listas: Record<string, unknown> = {};
    for (const campo of secao.campos) {
      if (campo.tipo === 'lista') {
        listas[campo.key] = (org.itens.get(campo.key) ?? []).map(itemJson);
        continue;
      }
      const e = org.entradas.get(campo.key);
      if (e) campos[campo.key] = { valor: e.valor, epistemico: e.epistemico, fonte: e.fonte };
    }
    return { key: secao.key, letra: secao.letra, titulo: secao.titulo, campos, listas };
  });

  return `${jsonEstavel(
    {
      schemaVersion: VERSAO_DO_BRAIN,
      catalogoVersao: VERSAO_DO_CATALOGO,
      clientId: entrada.clientId,
      cliente: entrada.nomeDoCliente,
      secoes,
    },
    2,
  )}\n`;
}

function jsonl(itens: readonly ItemDeLista[]): string {
  return itens.map((item) => `${jsonEstavel(itemJson(item))}\n`).join('');
}

function listasDoCatalogo(): readonly CampoLista[] {
  return CATALOGO.flatMap((secao) => secao.campos.filter((c): c is CampoLista => c.tipo === 'lista'));
}

export function hashDoConteudo(arquivos: readonly Pick<ArquivoDoBrain, 'nome' | 'conteudo'>[]): string {
  const hash = createHash('sha256');
  for (const arquivo of [...arquivos].sort((a, b) => a.nome.localeCompare(b.nome))) {
    hash.update(arquivo.nome, 'utf8').update('\0').update(arquivo.conteudo, 'utf8').update('\0');
  }
  return hash.digest('hex');
}

export function construirBrain(entrada: EntradaDoBrain): Brain {
  const org = organizar(entrada.contexto);
  const arquivo = (nome: string, contentType: string, conteudo: string): ArquivoDoBrain => ({
    nome,
    caminho: caminhoDoBrain(entrada.organizationId, entrada.clientId, nome),
    contentType,
    conteudo,
  });

  const anexos = org.arquivos.map((a) => ({
    id: a.id,
    secao: a.secao,
    fieldKey: a.fieldKey,
    itemId: a.itemId,
    nome: a.nome,
    mime: a.mime,
    tamanhoBytes: a.tamanhoBytes,
    sha256: a.sha256,
    caminho: a.caminho,
  }));

  const conteudos: ArquivoDoBrain[] = [
    arquivo('perfil.md', MARKDOWN, perfilMarkdown(entrada, org)),
    arquivo('perfil.json', JSON_TIPO, perfilJson(entrada, org)),
    ...listasDoCatalogo().map((lista) => arquivo(lista.arquivoBrain, JSONL, jsonl(org.itens.get(lista.key) ?? []))),
    arquivo('anexos.json', JSON_TIPO, `${jsonEstavel(anexos, 2)}\n`),
  ];

  const contentHash = hashDoConteudo(conteudos);
  const completude = calcularCompletude(entrada.contexto);
  const manifesto: Manifesto = {
    schemaVersion: VERSAO_DO_BRAIN,
    catalogoVersao: VERSAO_DO_CATALOGO,
    organizationId: entrada.organizationId,
    clientId: entrada.clientId,
    generatedAt: entrada.geradoEm.toISOString(),
    contentHash,
    counts: {
      campos: org.entradas.size,
      itens: Object.fromEntries(listasDoCatalogo().map((l) => [l.key, org.itens.get(l.key)?.length ?? 0])),
      arquivos: org.arquivos.length,
    },
    completude: {
      geral: completude.geral,
      secoes: Object.fromEntries(completude.secoes.map((s) => [s.secao, s.percentual])),
    },
    arquivos: conteudos
      .map((c) => ({ nome: c.nome, sha256: sha256(c.conteudo), bytes: Buffer.byteLength(c.conteudo, 'utf8') }))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
  };

  return {
    arquivos: [...conteudos, arquivo('manifest.json', JSON_TIPO, `${jsonEstavel(manifesto, 2)}\n`)],
    manifesto,
    contentHash,
  };
}
