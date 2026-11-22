import { modules } from '@/composition';
import { canAdminister } from '@/modules/identity/domain/user';
import { ORGANIZACAO_INTEIRA, escopoDoUsuario } from '@/shared/db/escopo';

export async function podeEntrarNaAutomacao(userId: string): Promise<boolean> {
  const vinculos = await modules().identity.membershipsOf(userId);
  if (vinculos.length === 0) return false;
  if (vinculos.some((vinculo) => !canAdminister(vinculo.role))) return false;
  try {
    const escopos = await Promise.all(vinculos.map((vinculo) => escopoDoUsuario(userId, vinculo.organizationId)));
    return escopos.every((escopo) => escopo === ORGANIZACAO_INTEIRA);
  } catch {
    return false;
  }
}
