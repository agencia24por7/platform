import { avaliarCapacidades, type AvaliacaoDeCapacidade, type DefinicaoDeCapacidade } from '../domain/capacidades.ts';
import type { EntradaDeConhecimento } from '../domain/conhecimento.ts';
import type { SinalDeCultura } from '../domain/cultura.ts';
import { restringirAoCatalogo, type ContextoParaCatalogo } from '../domain/contexto.ts';
import { sanearRegras, type RegrasParaCatalogo } from '../domain/regras.ts';
import { diagnosticarCliente, type ConectorDoDiagnostico, type Diagnostico } from '../domain/diagnostico.ts';
import {
  entradaSemSelo,
  selar,
  TIPOS_NATIVOS,
  VERSAO_DO_ESQUEMA_DO_CATALOGO,
  type EntradaDoCatalogo,
  type EntradaSemSelo,
} from '../domain/entrada.ts';
import type { InventarioDoCliente } from '../domain/inventario.ts';
import { hashEstavel } from '../domain/jsonEstavel.ts';
import { aplicarPoliticaDeUso } from '../domain/politica.ts';
import { piiNaEntrada } from '../domain/privacidade.ts';
import {
  contextoDeDescoberta,
  type ContextoDeDescoberta,
  type ProvedorDeCatalogo,
  type StatusDoProvedor,
} from '../domain/provedor.ts';
import type { EstadoDoProvedor, Snapshot } from '../domain/snapshot.ts';
import { lerUrn } from '../domain/urn.ts';

export type { EstadoDoProvedor, Snapshot } from '../domain/snapshot.ts';

export type EntradaDaConstrucao = {
  readonly organizationId: string;
  readonly clienteId: string;
  readonly agora: Date;
  readonly conjuntoDeDados: string;
  readonly bytesMaximosPorConsulta: number;
  readonly inventario: InventarioDoCliente;
  readonly contexto: ContextoParaCatalogo | null;
  readonly regras?: RegrasParaCatalogo | null;
  readonly conhecimento?: readonly EntradaDeConhecimento[] | null;
  readonly cultura?: readonly SinalDeCultura[] | null;
};

export type DependenciasDaConstrucao = {
  readonly provedores: readonly ProvedorDeCatalogo[];
  readonly capacidades: readonly DefinicaoDeCapacidade[];
  readonly conectores: readonly ConectorDoDiagnostico[];
  readonly plataformasDaTabela: (tabela: string) => readonly string[];
  readonly aoDescartar?: (provedor: string, motivo: string) => void;
};

type Coleta = { entradas: EntradaDoCatalogo[]; estado: EstadoDoProvedor };

function motivoDoErro(erro: unknown): string {
  return (erro instanceof Error ? erro.message : 'erro desconhecido').slice(0, 300);
}

function validar(
  provedor: ProvedorDeCatalogo,
  bruta: EntradaSemSelo,
  ctx: ContextoDeDescoberta,
  tipos: ReadonlySet<string>,
): { entrada: EntradaDoCatalogo } | { motivo: string } {
  const analise = entradaSemSelo.safeParse(bruta);
  if (!analise.success) return { motivo: `entrada fora do esquema: ${analise.error.issues[0]?.path.join('.') ?? '?'}` };
  const entrada = analise.data;
  const partes = lerUrn(entrada.urn);
  if (!partes || partes.organizationId !== ctx.organizationId || partes.clienteId !== ctx.clienteId) return { motivo: 'urn de outro cliente' };
  if (partes.tipo !== entrada.tipo || partes.id !== entrada.id) return { motivo: 'urn não bate com tipo e id' };
  if (!tipos.has(entrada.tipo) || !provedor.tiposDeclarados.includes(entrada.tipo)) return { motivo: `tipo ${entrada.tipo} não declarado` };
  if (entrada.provedor !== provedor.id) return { motivo: 'provedor da entrada diferente do provedor que a emitiu' };
  const selada = selar(entrada);
  if (piiNaEntrada(selada).length > 0) return { motivo: 'padrão de dado pessoal ou segredo no texto da entrada' };
  return { entrada: selada };
}

async function executar(
  provedor: ProvedorDeCatalogo,
  ctx: ContextoDeDescoberta,
  tipos: ReadonlySet<string>,
  aoDescartar: (provedor: string, motivo: string) => void,
): Promise<Coleta> {
  const saude = provedor.saude(ctx);
  const base = { id: provedor.id, versao: provedor.versao };
  let brutas: readonly EntradaSemSelo[];
  try {
    brutas = await provedor.descobrir(ctx);
  } catch (erro) {
    return { entradas: [], estado: { ...base, status: 'indisponivel', motivo: motivoDoErro(erro), entradas: 0, descartadas: 0 } };
  }
  const entradas: EntradaDoCatalogo[] = [];
  let descartadas = 0;
  for (const bruta of brutas) {
    const resultado = validar(provedor, bruta, ctx, tipos);
    if ('motivo' in resultado) {
      descartadas += 1;
      aoDescartar(provedor.id, resultado.motivo);
      continue;
    }
    entradas.push(resultado.entrada);
  }
  const status: StatusDoProvedor = saude.status !== 'ok' ? saude.status : descartadas > 0 ? 'degradado' : 'ok';
  const motivo = saude.motivo ?? (descartadas > 0 ? `${descartadas} entrada(s) descartada(s) na validação` : null);
  return { entradas, estado: { ...base, status, motivo, entradas: entradas.length, descartadas } };
}

function deduplicar(colecoes: readonly Coleta[]): EntradaDoCatalogo[] {
  const porUrn = new Map<string, EntradaDoCatalogo>();
  for (const { entradas } of colecoes) for (const entrada of entradas) if (!porUrn.has(entrada.urn)) porUrn.set(entrada.urn, entrada);
  return [...porUrn.values()];
}

function semRelacoesSoltas(entradas: readonly EntradaDoCatalogo[]): EntradaDoCatalogo[] {
  const urns = new Set(entradas.map((e) => e.urn));
  return entradas.map((entrada) => {
    const relacoes = entrada.relacoes.filter((r) => urns.has(r.urn));
    if (relacoes.length === entrada.relacoes.length) return entrada;
    const { hash: _hash, schemaVersion: _versao, ...resto } = entrada;
    return selar({ ...resto, relacoes });
  });
}

const ordenarPorUrn = (a: EntradaDoCatalogo, b: EntradaDoCatalogo) => a.urn.localeCompare(b.urn);

export function hashDoCatalogo(
  entradas: readonly EntradaDoCatalogo[],
  capacidades: readonly AvaliacaoDeCapacidade[],
  diagnostico: Diagnostico,
  regras: RegrasParaCatalogo | null = null,
): string {
  return hashEstavel({
    regras,
    schemaVersion: VERSAO_DO_ESQUEMA_DO_CATALOGO,
    entradas: entradas.map((e) => [e.urn, e.hash]),
    capacidades,
    diagnostico,
  });
}

export async function construirCatalogo(dependencias: DependenciasDaConstrucao, entrada: EntradaDaConstrucao): Promise<Snapshot> {
  const tipos = new Set<string>([...TIPOS_NATIVOS, ...dependencias.provedores.flatMap((p) => p.tiposDeclarados)]);
  const aoDescartar = dependencias.aoDescartar ?? (() => undefined);
  const contexto = entrada.contexto ? restringirAoCatalogo(entrada.contexto) : null;
  const regras = entrada.regras ? sanearRegras(entrada.regras) : null;
  const base = {
    organizationId: entrada.organizationId,
    clienteId: entrada.clienteId,
    agora: entrada.agora,
    conjuntoDeDados: entrada.conjuntoDeDados,
    bytesMaximosPorConsulta: entrada.bytesMaximosPorConsulta,
    inventario: entrada.inventario,
    contexto,
    regras,
    conhecimento: entrada.conhecimento ?? null,
    cultura: entrada.cultura ?? null,
  };
  const ctxPrimario = contextoDeDescoberta(base);
  const primarios = dependencias.provedores.filter((p) => p.fase === 'primaria');
  const coletasPrimarias = await Promise.all(primarios.map((p) => executar(p, ctxPrimario, tipos, aoDescartar)));
  const entradasPrimarias = semRelacoesSoltas(deduplicar(coletasPrimarias)).sort(ordenarPorUrn);

  const ctxDerivado = contextoDeDescoberta({ ...base, entradasPrimarias });
  const derivados = dependencias.provedores.filter((p) => p.fase === 'derivada');
  const coletasDerivadas = await Promise.all(derivados.map((p) => executar(p, ctxDerivado, tipos, aoDescartar)));

  const todas = semRelacoesSoltas(deduplicar([...coletasPrimarias, ...coletasDerivadas])).sort(ordenarPorUrn);
  const politica = aplicarPoliticaDeUso(todas);
  const visiveis = new Set(politica.entradas.map((e) => e.urn));

  const capacidades = avaliarCapacidades(dependencias.capacidades, entradasPrimarias, entrada.agora, dependencias.plataformasDaTabela, regras).map(
    (avaliacao) => ({
      ...avaliacao,
      evidencias: avaliacao.evidencias.filter((urn) => visiveis.has(urn)),
      requisitos: avaliacao.requisitos.map((r) => ({ ...r, evidencias: r.evidencias.filter((urn) => visiveis.has(urn)) })),
    }),
  );
  const diagnostico = diagnosticarCliente({
    entradas: politica.entradas,
    inventario: entrada.inventario,
    contexto,
    regras,
    capacidades,
    conectores: dependencias.conectores,
  });
  const provedores = [...coletasPrimarias, ...coletasDerivadas].map((c) => c.estado).sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: VERSAO_DO_ESQUEMA_DO_CATALOGO,
    organizationId: entrada.organizationId,
    clienteId: entrada.clienteId,
    nomeDoCliente: entrada.inventario.cliente.nome,
    geradoEm: entrada.agora.toISOString(),
    entradas: politica.entradas,
    omitidasPelaPolitica: politica.omitidas,
    restritasPelaPolitica: politica.restritas,
    capacidades,
    diagnostico,
    provedores,
    regras,
    catalogHash: hashDoCatalogo(politica.entradas, capacidades, diagnostico, regras),
  };
}
