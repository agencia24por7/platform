import { credentialIdOf } from '@/modules/connections/application/credentialVault';
import {
  provedorDaPlataforma,
  type ConexaoARevogar,
  type ProvedorRevogavel,
  type ResultadoDaRevogacao,
} from '@/modules/privacidade/domain/revogacao';
import { logger } from '@/shared/logging/logger';

export type DesfechoDoExecutor = 'revogado' | 'recusado' | 'falhou';

export type ExecutorDeRevogacao = {
  readonly disponivel: boolean;
  executar(input: {
    readonly provedor: ProvedorRevogavel;
    readonly credentialId: string;
    readonly connectionId: string;
  }): Promise<DesfechoDoExecutor>;
};

export type AcessosCompartilhados = {
  compartilhado(organizationId: string, connectionId: string): Promise<boolean>;
};

export type RevogadorNoProvedor = {
  revogar(conexao: ConexaoARevogar): Promise<ResultadoDaRevogacao>;
};

export const semRevogacaoNoProvedor: RevogadorNoProvedor = {
  async revogar() {
    return { revogadoNoProvedor: 'nao_suportado', motivo: 'plataforma_sem_revogacao' };
  },
};

const DESFECHO: Readonly<Record<DesfechoDoExecutor, ResultadoDaRevogacao>> = {
  revogado: { revogadoNoProvedor: true, motivo: 'revogado' },
  recusado: { revogadoNoProvedor: false, motivo: 'recusado_pelo_provedor' },
  falhou: { revogadoNoProvedor: false, motivo: 'falhou' },
};

export function createRevogadorNoProvedor(executor: ExecutorDeRevogacao, acessos: AcessosCompartilhados): RevogadorNoProvedor {
  return {
    async revogar(conexao) {
      const provedor = provedorDaPlataforma(conexao.platform);
      if (!provedor) return { revogadoNoProvedor: 'nao_suportado', motivo: 'plataforma_sem_revogacao' };
      if (conexao.grantType !== 'oauth_user') return { revogadoNoProvedor: 'nao_suportado', motivo: 'autorizacao_sem_usuario' };

      const credentialId = credentialIdOf(conexao.credentialRef);
      if (!credentialId) return { revogadoNoProvedor: false, motivo: 'sem_credencial_no_cofre' };
      if (!executor.disponivel) return { revogadoNoProvedor: false, motivo: 'revogador_indisponivel' };

      try {
        if (await acessos.compartilhado(conexao.organizationId, conexao.id)) {
          return { revogadoNoProvedor: false, motivo: 'acesso_compartilhado' };
        }
        return DESFECHO[await executor.executar({ provedor, credentialId, connectionId: conexao.id })];
      } catch (erro) {
        logger.warn('conexao.revogar_no_provedor.falhou', {
          connectionId: conexao.id,
          platform: conexao.platform,
          error: erro instanceof Error ? erro.message : 'desconhecido',
        });
        return DESFECHO.falhou;
      }
    },
  };
}
