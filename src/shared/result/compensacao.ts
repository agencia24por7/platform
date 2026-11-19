export async function executarComCompensacao<T>(acao: () => Promise<T>, compensar: () => Promise<void>): Promise<T> {
  try {
    return await acao();
  } catch (erroOriginal) {
    try {
      await compensar();
    } catch {
      throw erroOriginal;
    }
    throw erroOriginal;
  }
}
