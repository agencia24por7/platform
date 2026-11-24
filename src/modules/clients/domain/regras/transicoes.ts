import { err, ok, type Result } from '../../../../shared/result/result.ts';
import { CATEGORIA_ABERTA_A_AGENTES, type Categoria } from './categoria.ts';
import type { Natureza } from './natureza.ts';
import type { Status } from './status.ts';

export const PAPEIS = ['viewer', 'operator', 'admin'] as const;
export type Papel = (typeof PAPEIS)[number];

export type Ator =
  | { readonly origem: 'agente' }
  | { readonly origem: 'cliente' | 'agencia'; readonly papel: Papel };

export const ACOES = ['registrar', 'efetivar', 'rejeitar', 'superar', 'revogar'] as const;
export type Acao = (typeof ACOES)[number];

export type ErroDeTransicao = {
  readonly codigo: 'sem_permissao' | 'transicao_invalida' | 'agente_nao_declara_esta_decisao';
  readonly mensagem: string;
};

const NEGADA_AO_AGENTE: ErroDeTransicao = {
  codigo: 'sem_permissao',
  mensagem: 'Agente não efetiva, altera nem revoga limite ou regra.',
};

const TRANSICOES: Readonly<Record<Status, Readonly<Partial<Record<Acao, Status>>>>> = {
  proposta: { efetivar: 'vigente', rejeitar: 'rejeitada' },
  vigente: { superar: 'superada', revogar: 'revogada' },
  superada: {},
  revogada: {},
  rejeitada: {},
};

export function proximoStatus(de: Status, acao: Acao): Result<Status, ErroDeTransicao> {
  const destino = TRANSICOES[de][acao];
  if (destino === undefined) {
    return err({ codigo: 'transicao_invalida', mensagem: `Não é possível ${acao} uma decisão ${de}.` });
  }
  return ok(destino);
}

function papelPodeMexer(papel: Papel, natureza: Natureza): boolean {
  if (papel === 'viewer') return false;
  if (natureza === 'limite') return papel === 'admin';
  return true;
}

export function autorizar(ator: Ator, acao: Acao, natureza: Natureza): Result<true, ErroDeTransicao> {
  if (ator.origem === 'agente') {
    if (acao === 'registrar') return ok(true);
    return natureza === 'decisao'
      ? err({ codigo: 'sem_permissao', mensagem: 'Agente não muda o ciclo de vida de decisões.' })
      : err(NEGADA_AO_AGENTE);
  }
  if (!papelPodeMexer(ator.papel, natureza)) {
    return err({ codigo: 'sem_permissao', mensagem: 'O papel não permite esta ação sobre esta natureza.' });
  }
  return ok(true);
}

export function statusAoRegistrar(
  ator: Ator,
  alvo: { readonly natureza: Natureza; readonly categoria: Categoria },
): Result<Extract<Status, 'proposta' | 'vigente'>, ErroDeTransicao> {
  const permitido = autorizar(ator, 'registrar', alvo.natureza);
  if (!permitido.ok) return permitido;
  if (ator.origem === 'agente') {
    if (alvo.natureza === 'decisao') {
      return alvo.categoria === CATEGORIA_ABERTA_A_AGENTES
        ? ok('vigente')
        : err({ codigo: 'agente_nao_declara_esta_decisao', mensagem: 'Agente só registra decisão de processo.' });
    }
    return ok('proposta');
  }
  return ator.origem === 'cliente' ? ok('proposta') : ok('vigente');
}

export function transitar(
  ator: Ator,
  de: Status,
  acao: Exclude<Acao, 'registrar'>,
  natureza: Natureza,
): Result<Status, ErroDeTransicao> {
  const permitido = autorizar(ator, acao, natureza);
  if (!permitido.ok) return permitido;
  if (ator.origem === 'cliente') {
    return err({ codigo: 'sem_permissao', mensagem: 'O cliente só propõe; a agência efetiva.' });
  }
  return proximoStatus(de, acao);
}
