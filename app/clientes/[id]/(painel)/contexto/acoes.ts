'use server';

import { modules } from '@/composition';
import type {
  AlvoDeMarcacao,
  Comando,
  ContextoCompleto,
  Leitura,
  MarcacaoParcial,
  RevisaoDeContexto,
} from '@/modules/clients/application/contextoService';
import { CATALOGO } from '@/modules/clients/domain/contexto/catalogo';
import type { EntradaDeCampo, ItemDeLista } from '@/modules/clients/domain/contexto/tipos';
import { idValido } from '@/modules/clients/domain/painel/enderecos';
import { atorAtual } from '@/shared/http/ator';
import { escopoDoClienteNaOrganizacao } from '@/../app/clientes/[id]/_escopo';
import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';

export type Resposta<T> =
  | { readonly ok: true; readonly valor: T }
  | {
      readonly ok: false;
      readonly erro: string;
      readonly codigo: string;
      readonly versaoAtual: number | null;
      readonly campos: Readonly<Record<string, string>> | null;
    };

export type DadosDoEditor = Omit<ContextoCompleto, 'catalogo'>;

function semCatalogo(r: Result<ContextoCompleto, Failure>): Result<DadosDoEditor, Failure> {
  if (!r.ok) return r;
  const { catalogo: _catalogo, ...resto } = r.value;
  return { ok: true, value: resto };
}

const NAO_ENCONTRADO: Resposta<never> = { ok: false, erro: 'Cliente não encontrado.', codigo: 'not_found', versaoAtual: null, campos: null };

async function comando(clientId: string) {
  const escopo = await escopoDoClienteNaOrganizacao(clientId);
  return escopo ? escopo.comando : null;
}

function leituraDe(base: Comando): Leitura {
  return { organizationId: base.organizationId, clientId: base.clientId, papelDeQuemLe: base.papelDeQuemAge };
}

function responder<T>(resultado: Result<T, Failure>): Resposta<T> {
  if (resultado.ok) return { ok: true, valor: resultado.value };
  const detalhes = resultado.error.details ?? null;
  const versao = detalhes?.['versaoAtual'];
  return {
    ok: false,
    erro: resultado.error.message,
    codigo: resultado.error.code,
    versaoAtual: versao !== undefined ? Number(versao) : null,
    campos: resultado.error.code === 'validation' ? detalhes : null,
  };
}

export async function salvarCampoAcao(
  clientId: string,
  fieldKey: string,
  valor: unknown,
  versaoEsperada: number,
  marcacao?: MarcacaoParcial,
): Promise<Resposta<EntradaDeCampo | null>> {
  const base = await comando(clientId);
  if (!base) return NAO_ENCONTRADO;
  return responder(await modules().contexto.salvarCampo({ ...base, fieldKey, valor, versaoEsperada, marcacao }, await atorAtual()));
}

export async function adicionarItemAcao(clientId: string, listKey: string, dados: unknown): Promise<Resposta<ItemDeLista>> {
  const base = await comando(clientId);
  if (!base) return NAO_ENCONTRADO;
  return responder(await modules().contexto.adicionarItem({ ...base, listKey, dados }, await atorAtual()));
}

export async function alterarItemAcao(clientId: string, itemId: string, dados: unknown, versaoEsperada: number): Promise<Resposta<ItemDeLista>> {
  const base = await comando(clientId);
  if (!base) return NAO_ENCONTRADO;
  return responder(await modules().contexto.alterarItem({ ...base, itemId, dados, versaoEsperada }, await atorAtual()));
}

export async function removerItemAcao(clientId: string, itemId: string, versaoEsperada: number): Promise<Resposta<null>> {
  const base = await comando(clientId);
  if (!base) return NAO_ENCONTRADO;
  return responder(await modules().contexto.removerItem({ ...base, itemId, versaoEsperada }, await atorAtual()));
}

export async function reordenarAcao(clientId: string, listKey: string, ordem: readonly string[]): Promise<Resposta<readonly ItemDeLista[]>> {
  const base = await comando(clientId);
  if (!base) return NAO_ENCONTRADO;
  return responder(await modules().contexto.reordenarItens({ ...base, listKey, ordem }, await atorAtual()));
}

export async function marcarAcao(
  clientId: string,
  alvo: AlvoDeMarcacao,
  versaoEsperada: number,
  marcacao: MarcacaoParcial,
): Promise<Resposta<EntradaDeCampo | ItemDeLista>> {
  const base = await comando(clientId);
  if (!base) return NAO_ENCONTRADO;
  return responder(await modules().contexto.marcar({ ...base, alvo, versaoEsperada, marcacao }, await atorAtual()));
}

export async function confirmarSugestaoAcao(clientId: string, alvo: AlvoDeMarcacao, versaoEsperada: number): Promise<Resposta<EntradaDeCampo | ItemDeLista>> {
  const base = await comando(clientId);
  if (!base) return NAO_ENCONTRADO;
  return responder(await modules().contexto.confirmarSugestao({ ...base, alvo, versaoEsperada }, await atorAtual()));
}

export async function compartilharSecaoAcao(clientId: string, secao: string, compartilhavel: boolean): Promise<Resposta<DadosDoEditor>> {
  const base = await comando(clientId);
  if (!base) return NAO_ENCONTRADO;
  const definicao = CATALOGO.find((s) => s.key === secao);
  if (!definicao) return { ok: false, erro: 'Seção desconhecida.', codigo: 'validation', versaoAtual: null, campos: null };
  const carregado = await modules().contexto.carregar(leituraDe(base));
  if (!carregado.ok) return responder(semCatalogo(carregado));
  const visiveis = new Set(definicao.campos.filter((c) => c.visivelAoCliente).map((c) => c.key));
  const ator = await atorAtual();
  const alvos: { alvo: AlvoDeMarcacao; versao: number }[] = [
    ...Object.values(carregado.value.campos)
      .filter((e) => e.secao === secao && visiveis.has(e.fieldKey) && e.compartilhavel !== compartilhavel)
      .map((e) => ({ alvo: { tipo: 'campo' as const, fieldKey: e.fieldKey }, versao: e.versao })),
    ...Object.values(carregado.value.listas)
      .flat()
      .filter((i) => i.secao === secao && visiveis.has(i.listKey) && i.compartilhavel !== compartilhavel)
      .map((i) => ({ alvo: { tipo: 'item' as const, itemId: i.id }, versao: i.versao })),
  ];
  for (const { alvo, versao } of alvos) {
    const r = await modules().contexto.marcar({ ...base, alvo, versaoEsperada: versao, marcacao: { compartilhavel } }, ator);
    if (!r.ok && r.error.code !== 'conflict') return responder(r);
  }
  return responder(semCatalogo(await modules().contexto.carregar(leituraDe(base))));
}

export async function removerArquivoAcao(clientId: string, fileId: string): Promise<Resposta<null>> {
  const base = await comando(clientId);
  if (!base || !idValido(fileId)) return NAO_ENCONTRADO;
  return responder(await modules().contexto.removerArquivo({ ...base, fileId }, await atorAtual()));
}

export async function listarRevisoesAcao(clientId: string, chave: string | null): Promise<Resposta<readonly RevisaoDeContexto[]>> {
  const base = await comando(clientId);
  if (!base) return NAO_ENCONTRADO;
  return responder(await modules().contexto.listarRevisoes({ ...leituraDe(base), limite: 60, chave }));
}

export async function recarregarContextoAcao(clientId: string): Promise<Resposta<DadosDoEditor>> {
  const base = await comando(clientId);
  if (!base) return NAO_ENCONTRADO;
  return responder(semCatalogo(await modules().contexto.carregar(leituraDe(base))));
}
