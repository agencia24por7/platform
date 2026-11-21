import { canAdminister, canOperate, type MemberRole } from '../../../identity/domain/user.ts';
import type { OrganizationType } from '../../../organizations/domain/organization.ts';

export function podeCadastrarCliente(tipo: OrganizationType, papel: MemberRole): boolean {
  return tipo === 'advertiser' ? canAdminister(papel) : canOperate(papel);
}
