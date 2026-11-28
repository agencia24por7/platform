const CODIGOS_REPETIVEIS: ReadonlySet<string> = new Set(['ia_limite', 'ia_saida_invalida', 'ia_falha', 'ia_tempo', 'brain_indisponivel', 'interno']);

export function erroRepetivel(codigo: string | null): boolean {
  return codigo !== null && CODIGOS_REPETIVEIS.has(codigo);
}

export type VersaoParaRepeticao = { readonly status: string; readonly autorTipo: string };

export function criarPodeRepetir(versoes: readonly VersaoParaRepeticao[]): boolean {
  return !versoes.some((versao) => versao.autorTipo === 'usuario' || versao.status === 'vigente');
}

export type ExecucaoParaRepeticao = { readonly tipo: string; readonly status: string; readonly erroCodigo: string | null };

export function execucaoEncerradaSemConcluir(execucao: Pick<ExecucaoParaRepeticao, 'status'>): boolean {
  return execucao.status === 'falhou' || execucao.status === 'cancelada';
}

export function execucaoRepetivel(execucao: ExecucaoParaRepeticao): boolean {
  if (execucao.tipo === 'corrigir_gate') return false;
  if (execucao.status === 'cancelada') return execucao.tipo === 'criar';
  return execucao.status === 'falhou' && erroRepetivel(execucao.erroCodigo);
}
