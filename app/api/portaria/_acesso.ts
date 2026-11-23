import { operadorDaPlataforma } from '@/shared/http/operador';

export async function podeEntrarNaAutomacao(userId: string): Promise<boolean> {
  try {
    return await operadorDaPlataforma(userId);
  } catch {
    return false;
  }
}
