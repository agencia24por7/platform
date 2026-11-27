const CODIGOS_REPETIVEIS: ReadonlySet<string> = new Set(['ia_limite', 'ia_saida_invalida', 'ia_falha', 'ia_tempo', 'brain_indisponivel', 'interno']);

export function erroRepetivel(codigo: string | null): boolean {
  return codigo !== null && CODIGOS_REPETIVEIS.has(codigo);
}

export type VersaoParaRepeticao = { readonly status: string; readonly autorTipo: string; readonly criadaEm: Date };

const STATUS_ABERTOS = ['rascunho', 'proposto'];

export function criarPodeRepetir(versoes: readonly VersaoParaRepeticao[], execucaoCriadaEm: Date): boolean {
  return !versoes.some(
    (versao) =>
      versao.autorTipo === 'usuario' ||
      versao.status === 'vigente' ||
      (STATUS_ABERTOS.includes(versao.status) && versao.criadaEm.getTime() > execucaoCriadaEm.getTime()),
  );
}
