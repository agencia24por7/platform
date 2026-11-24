import { err, ok, type Result } from '../../../../shared/result/result.ts';
import type { Decisao } from './decisao.ts';
import { autorizar, type Ator } from './transicoes.ts';

export type ErroDeSuperacao = {
  readonly codigo:
    | 'sem_permissao'
    | 'anterior_nao_vigente'
    | 'nova_nao_vigente'
    | 'sem_chave'
    | 'cliente_diferente'
    | 'natureza_diferente'
    | 'chave_diferente'
    | 'escopo_diferente';
  readonly mensagem: string;
};

export type ResultadoDaSuperacao = {
  readonly anterior: Decisao;
  readonly nova: Decisao;
};

function falha(codigo: ErroDeSuperacao['codigo'], mensagem: string): Result<never, ErroDeSuperacao> {
  return err({ codigo, mensagem });
}

export function superar(ator: Ator, anterior: Decisao, nova: Decisao): Result<ResultadoDaSuperacao, ErroDeSuperacao> {
  const autorizacao = autorizar(ator, 'superar', anterior.natureza);
  if (!autorizacao.ok || ator.origem !== 'agencia') {
    return falha('sem_permissao', 'Este ator não pode alterar a decisão.');
  }
  if (anterior.status !== 'vigente') return falha('anterior_nao_vigente', 'Só se supera decisão vigente.');
  if (nova.status !== 'vigente') return falha('nova_nao_vigente', 'A nova decisão nasce vigente.');
  if (anterior.chave === null || nova.chave === null) return falha('sem_chave', 'Só se supera decisão com chave.');
  if (anterior.clienteId !== nova.clienteId) return falha('cliente_diferente', 'As decisões são de clientes diferentes.');
  if (anterior.natureza !== nova.natureza) return falha('natureza_diferente', 'A natureza deve ser a mesma.');
  if (anterior.chave !== nova.chave) return falha('chave_diferente', 'A chave deve ser a mesma.');
  if (anterior.escopo !== nova.escopo) return falha('escopo_diferente', 'O escopo deve ser o mesmo.');
  return ok({
    anterior: { ...anterior, status: 'superada' },
    nova: { ...nova, supersedesId: anterior.id },
  });
}
