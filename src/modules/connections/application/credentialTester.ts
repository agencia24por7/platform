import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';
import type { PlataformaPorChave } from '@/modules/connections/domain/chaveDeApi';

export type CredentialTester = {
  testar(platform: PlataformaPorChave, chave: string): Promise<Result<void, Failure>>;
};
