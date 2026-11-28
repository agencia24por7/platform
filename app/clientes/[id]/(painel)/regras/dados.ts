import { cache } from 'react';
import { carregarPainel } from '@/../app/clientes/[id]/_dados';
import type { DefinicaoDoFormulario } from '@/../app/clientes/[id]/(painel)/regras/FormularioDeRegra';
import { modules } from '@/composition';
import type { Decisao } from '@/modules/clients/domain/regras/index';
import type { DefinicaoDoBanco } from '@/modules/clients/infrastructure/regrasRepository';

export async function nomesDaEquipe(clienteId: string, decisoes: readonly Decisao[]): Promise<ReadonlyMap<string, string>> {
  const ids = new Set(decisoes.map((d) => d.decididoPor).filter((id): id is string => id !== null));
  if (ids.size === 0) return new Map();
  const { ctx } = await carregarPainel(clienteId);
  try {
    const { membros } = await modules().team.equipe(ctx.organization.id);
    return new Map(membros.filter((m) => ids.has(m.userId)).map((m) => [m.userId, m.name]));
  } catch {
    return new Map();
  }
}

export const carregarDefinicoes = cache(async (clienteId: string): Promise<readonly DefinicaoDoBanco[]> => {
  const { ctx } = await carregarPainel(clienteId);
  const definicoes = await modules().regras.listarDefinicoes({ organizationId: ctx.organization.id });
  return definicoes.ok ? definicoes.value : [];
});

export function definicaoDaDecisao(definicoes: readonly DefinicaoDoBanco[], decisao: Decisao): DefinicaoDoBanco | null {
  if (decisao.natureza !== 'limite' || decisao.chave === null) return null;
  return definicoes.find((d) => d.key === decisao.chave) ?? null;
}

export function paraFormulario(d: DefinicaoDoBanco): DefinicaoDoFormulario {
  return {
    key: d.key,
    nome: d.nome,
    descricao: d.descricao,
    categoria: d.categoria,
    unidade: d.unidade,
    periodo: d.periodo,
    sentido: d.sentido,
    faixaMin: d.faixaMin,
    faixaMax: d.faixaMax,
    tiposDeEscopo: d.tiposDeEscopo,
  };
}
