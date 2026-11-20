export type EstadoParaGravar = {
  readonly coletaStatus: string;
  readonly clienteExcluido: boolean;
};

export type RecusaDaGravacao = {
  readonly codigo: 'not_found' | 'conflict';
  readonly mensagem: string;
};

export function recusaDaGravacao(estado: EstadoParaGravar | null): RecusaDaGravacao | null {
  if (!estado) return { codigo: 'not_found', mensagem: 'Execução não encontrada.' };
  if (estado.clienteExcluido) return { codigo: 'not_found', mensagem: 'Execução não encontrada: o cliente foi excluído.' };
  if (estado.coletaStatus !== 'running') {
    return { codigo: 'conflict', mensagem: `A execução já foi fechada (${estado.coletaStatus}); abra outra para gravar.` };
  }
  return null;
}
