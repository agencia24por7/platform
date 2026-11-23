import { modules } from '@/composition';
import { env } from '@/shared/config/env';

export function operadorDaPlataforma(userId: string): Promise<boolean> {
  return modules().identity.operadorDaPlataforma(userId, env().PLATAFORMA_OPERADORES);
}
