import type { ErroDeEstrategia } from '@/modules/strategy/application/portas';

type ErroDoBanco = { code?: unknown; constraint_name?: unknown; message?: unknown };

const RESTRICOES_DE_IDEMPOTENCIA: readonly string[] = [
  'strategy_plan_versions_idempotencia',
  'strategy_plan_events_idempotencia',
  'strategy_plan_events_um_ajuste',
  'strategy_plan_events_parecer_persona',
  'strategy_plan_events_um_veredito',
  'strategy_plan_versions_pkey',
  'strategy_plan_runs_agent_run_id_key',
  'strategy_plans_tipo_unico',
];

const MENSAGENS_DE_TRANSICAO = [/transi[çc][ãa]o inv[áa]lida/i, /estado final/i, /s[óo] .* pode ser/i, /s[óo] valem em vers[ãa]o rascunho/i];
const MENSAGENS_DE_CONFLITO = [/limite de 2 corre[çc][õo]es/i, /corrigir_gate (s[óo] vale|exige)/i, /j[áa] tem vers[ãa]o vigente/i, /n[ãa]o est[áa] mais vigente/i, /s[óo] vers[ãa]o vigente pode ser superada/i];

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

export function traduzirErroDoBanco(erro: unknown): ErroDeEstrategia | null {
  if (erro === null || typeof erro !== 'object') return null;
  const e = erro as ErroDoBanco;
  const codigo = texto(e.code);
  const restricao = texto(e.constraint_name);
  const mensagem = texto(e.message);

  if (codigo === '42501' && /execu[çc][ãa]o ativa/i.test(mensagem)) {
    return { codigo: 'execucao_perdida', mensagem: 'A execução não está mais ativa para este agente.' };
  }
  if (codigo === '42501') return { codigo: 'sem_permissao', mensagem: 'Seu papel não permite esta ação no plano.' };
  if (codigo === 'ORT01') return { codigo: 'teto_do_agente', mensagem: 'Teto de escritas do agente nesta execução atingido.', teto: 'execucao' };
  if (codigo === 'ORT02') return { codigo: 'teto_do_agente', mensagem: 'Teto diário de escritas de agentes para este cliente atingido.', teto: 'dia' };

  if (codigo === '23505') {
    if (restricao === 'strategy_plan_runs_uma_ativa') {
      return { codigo: 'execucao_ativa', mensagem: 'Este plano já tem uma execução em andamento.' };
    }
    if (RESTRICOES_DE_IDEMPOTENCIA.includes(restricao) || RESTRICOES_DE_IDEMPOTENCIA.some((nome) => mensagem.includes(nome)) || /idempot|já existe/i.test(mensagem)) {
      return { codigo: 'ja_feito', mensagem: 'Esta operação já foi registrada.' };
    }
    return { codigo: 'conflito', mensagem: 'Alguém alterou antes. Recarregue para ver a versão atual.' };
  }

  if (codigo === '23514') {
    if (/n[ãa]o pode ser proposta: falta/i.test(mensagem)) return { codigo: 'falta_para_aplicar', mensagem };
    if (MENSAGENS_DE_CONFLITO.some((padrao) => padrao.test(mensagem))) return { codigo: 'conflito', mensagem };
    if (MENSAGENS_DE_TRANSICAO.some((padrao) => padrao.test(mensagem))) return { codigo: 'transicao_invalida', mensagem };
    return { codigo: 'invalido', mensagem: 'O banco recusou os dados informados.' };
  }

  if (codigo === '23503' || codigo === '23000') {
    return { codigo: 'nao_encontrado', mensagem: 'Plano, versão ou cliente não encontrado.' };
  }
  if (codigo === '23001') return { codigo: 'conflito', mensagem: 'O registro não aceita esta alteração.' };
  return null;
}
