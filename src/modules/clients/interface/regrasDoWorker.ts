import { createHash } from 'node:crypto';
import type { Decisao } from '@/modules/clients/domain/regras/index';
import type { RegrasService } from '@/modules/clients/application/regrasService';
import type { EntradaDoAgenteValida } from '@/modules/clients/application/regrasEntradas';
import type { DefinicaoDoBanco } from '@/modules/clients/infrastructure/regrasRepository';
import type { Resposta } from '@/modules/brain/application/brainService';
import { textoSeguro } from '@/modules/brain/domain/privacidade';
import type { WorkerContext } from '@/shared/http/workerRoute';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import { brainClienteParams } from '@/shared/config/contracts';

export const VERSAO_DO_CONTRATO_DE_REGRAS = 1;
export const LIMITE_DO_CORPO_DE_DECISAO_EM_BYTES = 32_000;

export type PortaDeRegrasDoWorker = {
  readonly regras: Pick<RegrasService, 'conjuntoParaAgente' | 'registrarPorAgente'>;
  readonly resolverCliente: (clienteId: string) => Promise<{ readonly organizationId: string; readonly clienteId: string } | null>;
};

export type DecisaoParaAgente = {
  readonly id: string;
  readonly numero: number;
  readonly categoria: Decisao['categoria'];
  readonly natureza: Decisao['natureza'];
  readonly origem: Decisao['origem'];
  readonly forca: Decisao['forca'];
  readonly status: Decisao['status'];
  readonly chave: string | null;
  readonly escopo: string;
  readonly titulo: string;
  readonly contexto: string | null;
  readonly texto: string | null;
  readonly valor: Decisao['valor'];
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
  readonly definicaoChave: string | null;
  readonly definicaoVersao: number | null;
  readonly conteudoNaoConfiavel: true;
};

export type RegrasParaAgente = {
  readonly schemaVersion: number;
  readonly clienteId: string;
  readonly hashDoConjunto: string;
  readonly conteudoNaoConfiavel: true;
  readonly vigentes: readonly DecisaoParaAgente[];
  readonly conflitos: readonly DecisaoParaAgente[];
  readonly definicoesDeLimite: readonly DefinicaoDoBanco[];
};

export type RegistroDoAgente = {
  readonly schemaVersion: number;
  readonly clienteId: string;
  readonly repetida: boolean;
  readonly decisao: DecisaoParaAgente;
};

const NAO_ENCONTRADO = failure('not_found', 'Recurso não encontrado.');

const textoSeguroOuNulo = (texto: string | null): string | null => (texto === null ? null : textoSeguro(texto));

export function projetarDecisao(decisao: Decisao): DecisaoParaAgente {
  return {
    id: decisao.id,
    numero: decisao.numero,
    categoria: decisao.categoria,
    natureza: decisao.natureza,
    origem: decisao.origem,
    forca: decisao.forca,
    status: decisao.status,
    chave: decisao.chave,
    escopo: decisao.escopo,
    titulo: textoSeguro(decisao.titulo),
    contexto: textoSeguroOuNulo(decisao.contexto),
    texto: textoSeguroOuNulo(decisao.texto),
    valor: decisao.valor,
    vigenciaInicio: decisao.vigenciaInicio.toISOString(),
    vigenciaFim: decisao.vigenciaFim ? decisao.vigenciaFim.toISOString() : null,
    definicaoChave: decisao.definicaoChave,
    definicaoVersao: decisao.definicaoVersao,
    conteudoNaoConfiavel: true,
  };
}

function definicoesRelevantes(decisoes: readonly Decisao[], todas: readonly DefinicaoDoBanco[]): readonly DefinicaoDoBanco[] {
  const chaves = new Set(decisoes.filter((d) => d.natureza === 'limite' && d.chave !== null).map((d) => d.chave));
  return todas
    .filter((definicao) => chaves.has(definicao.key))
    .sort((a, b) => (a.key === b.key ? a.version - b.version : a.key < b.key ? -1 : 1));
}

export function etagDoConjunto(hashDoConjunto: string, definicoes: readonly DefinicaoDoBanco[]): string {
  const digest = createHash('sha256').update(JSON.stringify([hashDoConjunto, definicoes])).digest('hex');
  return `"${digest.slice(0, 32)}"`;
}

export async function lerRegrasParaAgente(
  porta: PortaDeRegrasDoWorker,
  clienteId: string,
): Promise<Result<Resposta<RegrasParaAgente>, Failure>> {
  const cliente = await porta.resolverCliente(clienteId);
  if (!cliente) return err(NAO_ENCONTRADO);
  const conjunto = await porta.regras.conjuntoParaAgente({ organizationId: cliente.organizationId, clientId: cliente.clienteId });
  if (!conjunto.ok) return conjunto.error.code === 'not_found' ? err(NAO_ENCONTRADO) : conjunto;
  const definicoesDeLimite = definicoesRelevantes([...conjunto.value.decisoes, ...conjunto.value.conflitos], conjunto.value.definicoes);
  const corpo: RegrasParaAgente = {
    schemaVersion: VERSAO_DO_CONTRATO_DE_REGRAS,
    clienteId: cliente.clienteId,
    hashDoConjunto: conjunto.value.hash,
    conteudoNaoConfiavel: true,
    vigentes: conjunto.value.decisoes.map(projetarDecisao),
    conflitos: conjunto.value.conflitos.map(projetarDecisao),
    definicoesDeLimite,
  };
  return ok({ corpo, etag: etagDoConjunto(conjunto.value.hash, definicoesDeLimite) });
}

export async function registrarDecisaoDoAgente(
  porta: PortaDeRegrasDoWorker,
  clienteId: string | null,
  entrada: EntradaDoAgenteValida,
  worker: WorkerContext,
): Promise<Result<RegistroDoAgente, Failure>> {
  if (clienteId === null) return err(NAO_ENCONTRADO);
  const cliente = await porta.resolverCliente(clienteId);
  if (!cliente) return err(NAO_ENCONTRADO);
  const resultado = await porta.regras.registrarPorAgente(
    { organizationId: cliente.organizationId, clientId: cliente.clienteId },
    entrada,
    { requestId: worker.requestId },
  );
  if (!resultado.ok) return resultado.error.code === 'not_found' ? err(NAO_ENCONTRADO) : resultado;
  return ok({
    schemaVersion: VERSAO_DO_CONTRATO_DE_REGRAS,
    clienteId: cliente.clienteId,
    repetida: resultado.value.repetida,
    decisao: projetarDecisao(resultado.value.decisao),
  });
}

export function clienteDaRota(brutos: Record<string, string | string[]>): string | null {
  const valor = brutos['clienteId'];
  const parse = brainClienteParams.safeParse({ clienteId: Array.isArray(valor) ? valor.join('/') : valor });
  return parse.success ? parse.data.clienteId : null;
}
