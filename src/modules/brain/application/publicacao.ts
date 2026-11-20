import { prefixoDoExportDoContexto } from '../domain/contexto.ts';
import { jsonEstavel, sha256 } from '../domain/jsonEstavel.ts';
import { renderizarCatalogoMd } from '../domain/markdown.ts';
import { nomeDeArquivoDaUrn } from '../domain/urn.ts';
import type { Snapshot } from './construirCatalogo.ts';

export const PASTA_DAS_ENTRADAS = 'entradas/';

export type Artefato = {
  readonly nome: string;
  readonly contentType: string;
  readonly conteudo: string;
};

export type ManifestoDoCatalogo = {
  readonly schemaVersion: number;
  readonly organizationId: string;
  readonly clienteId: string;
  readonly generatedAt: string;
  readonly catalogHash: string;
  readonly status: 'completo' | 'parcial';
  readonly counts: {
    readonly entradas: number;
    readonly porTipo: Readonly<Record<string, number>>;
    readonly omitidasPelaPolitica: number;
    readonly restritasPelaPolitica: number;
    readonly capacidades: Readonly<Record<string, number>>;
  };
  readonly provedores: Snapshot['provedores'];
  readonly entradas: readonly { readonly urn: string; readonly hash: string; readonly arquivo: string }[];
  readonly referencias: { readonly exportDoContexto: string };
};

const JSON_TIPO = 'application/json';
const MARKDOWN = 'text/markdown; charset=utf-8';

export function prefixoDoCatalogo(organizationId: string, clienteId: string): string {
  return `orgs/${organizationId}/clientes/${clienteId}/brain/`;
}

function json(valor: unknown): string {
  return `${jsonEstavel(valor, 2)}\n`;
}

export function manifestoDe(snapshot: Snapshot): ManifestoDoCatalogo {
  const porTipo: Record<string, number> = {};
  for (const entrada of snapshot.entradas) porTipo[entrada.tipo] = (porTipo[entrada.tipo] ?? 0) + 1;
  const capacidades: Record<string, number> = {};
  for (const c of snapshot.capacidades) capacidades[c.status] = (capacidades[c.status] ?? 0) + 1;
  return {
    schemaVersion: snapshot.schemaVersion,
    organizationId: snapshot.organizationId,
    clienteId: snapshot.clienteId,
    generatedAt: snapshot.geradoEm,
    catalogHash: snapshot.catalogHash,
    status: snapshot.provedores.every((p) => p.status === 'ok') ? 'completo' : 'parcial',
    counts: {
      entradas: snapshot.entradas.length,
      porTipo,
      omitidasPelaPolitica: snapshot.omitidasPelaPolitica,
      restritasPelaPolitica: snapshot.restritasPelaPolitica,
      capacidades,
    },
    provedores: snapshot.provedores,
    entradas: snapshot.entradas.map((e) => ({ urn: e.urn, hash: e.hash, arquivo: `${PASTA_DAS_ENTRADAS}${nomeDeArquivoDaUrn(e.urn)}` })),
    referencias: { exportDoContexto: prefixoDoExportDoContexto(snapshot.organizationId, snapshot.clienteId) },
  };
}

export function corpoDoCatalogo(snapshot: Snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    organizationId: snapshot.organizationId,
    clienteId: snapshot.clienteId,
    catalogHash: snapshot.catalogHash,
    entradas: snapshot.entradas,
  };
}

export function artefatosDoCatalogo(snapshot: Snapshot): readonly Artefato[] {
  const md = renderizarCatalogoMd(
    { nomeDoCliente: snapshot.nomeDoCliente, catalogHash: snapshot.catalogHash, schemaVersion: snapshot.schemaVersion },
    snapshot.entradas,
    snapshot.capacidades,
    snapshot.diagnostico,
  );
  return [
    { nome: 'catalogo.json', contentType: JSON_TIPO, conteudo: json(corpoDoCatalogo(snapshot)) },
    { nome: 'catalogo.md', contentType: MARKDOWN, conteudo: md },
    { nome: 'capacidades.json', contentType: JSON_TIPO, conteudo: json({ schemaVersion: snapshot.schemaVersion, capacidades: snapshot.capacidades }) },
    { nome: 'diagnostico.json', contentType: JSON_TIPO, conteudo: json(snapshot.diagnostico) },
    ...snapshot.entradas.map((e) => ({ nome: `${PASTA_DAS_ENTRADAS}${nomeDeArquivoDaUrn(e.urn)}`, contentType: JSON_TIPO, conteudo: json(e) })),
    { nome: 'manifest.json', contentType: JSON_TIPO, conteudo: json(manifestoDe(snapshot)) },
  ];
}

export function hashDoArtefato(artefato: Artefato): string {
  return sha256(artefato.conteudo);
}
