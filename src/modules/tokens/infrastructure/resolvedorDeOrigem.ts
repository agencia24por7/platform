import { sql } from '@/shared/db/client';
import type { Platform } from '@/modules/connections/domain/connection';
import type { ResolvedorDeOrigem } from '@/modules/tokens/application/acessoDoWorker';

type Linha = {
  organization_id: string;
  connection_id: string;
  platform: Platform;
  connection_status: string;
  origem_em_execucao: boolean;
  fonte_ativa: boolean;
  tenant_ativo: boolean;
  tem_token: boolean;
};

export function createResolvedorDeOrigem(): ResolvedorDeOrigem {
  return {
    async resolver(origem) {
      const coletaId = 'coletaId' in origem ? origem.coletaId : null;
      const tarefaId = 'tarefaId' in origem ? origem.tarefaId : null;
      const linhas = (await sql()`
        SELECT organization_id, connection_id, platform, connection_status, origem_em_execucao, fonte_ativa, tenant_ativo, tem_token
        FROM integrations.resolver_conexao_do_token(${coletaId}::uuid, ${tarefaId}::uuid)`) as unknown as Linha[];
      const linha = linhas[0];
      if (!linha) return null;
      return {
        organizationId: linha.organization_id,
        connectionId: linha.connection_id,
        platform: linha.platform,
        connectionStatus: linha.connection_status,
        origemEmExecucao: linha.origem_em_execucao,
        fonteAtiva: linha.fonte_ativa,
        tenantAtivo: linha.tenant_ativo,
        temToken: linha.tem_token,
      };
    },
  };
}
