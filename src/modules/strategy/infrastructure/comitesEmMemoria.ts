import type { ConfiguracaoDoComite, RepositorioDosComites } from '@/modules/strategy/application/portas';

export function criarRepositorioDosComitesEmMemoria(inicial: readonly ConfiguracaoDoComite[] = []): RepositorioDosComites & { readonly linhas: Map<string, ConfiguracaoDoComite> } {
  const linhas = new Map(inicial.map((linha) => [linha.comite, linha] as const));
  return {
    linhas,
    async listar() {
      return [...linhas.values()];
    },
    async definir(_organizationId, comite, ligado) {
      if (comite === 'risco_legal' && !ligado) throw new Error('o comitê de risco e legal não pode ser desligado');
      linhas.set(comite, { comite, ligado, atualizadoPor: null, atualizadoEm: new Date() });
    },
  };
}
