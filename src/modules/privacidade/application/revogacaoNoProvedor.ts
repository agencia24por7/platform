import {
  provedorDaPlataforma,
  type ConexaoARevogar,
  type DecisaoDeRevogacao,
} from '@/modules/privacidade/domain/revogacao';
import { logger } from '@/shared/logging/logger';

export type AcessosCompartilhados = {
  compartilhado(organizationId: string, connectionId: string): Promise<boolean>;
};

export type PoliticaDeRevogacao = {
  decidir(conexao: ConexaoARevogar): Promise<DecisaoDeRevogacao>;
};

export function createPoliticaDeRevogacao(acessos: AcessosCompartilhados): PoliticaDeRevogacao {
  return {
    async decidir(conexao) {
      if (!provedorDaPlataforma(conexao.platform)) {
        return { tentar: false, resultado: { revogadoNoProvedor: 'nao_suportado', motivo: 'plataforma_sem_revogacao' } };
      }
      if (conexao.grantType !== 'oauth_user') {
        return { tentar: false, resultado: { revogadoNoProvedor: 'nao_suportado', motivo: 'autorizacao_sem_usuario' } };
      }

      try {
        if (await acessos.compartilhado(conexao.organizationId, conexao.id)) {
          return { tentar: false, resultado: { revogadoNoProvedor: false, motivo: 'acesso_compartilhado' } };
        }
        return { tentar: true };
      } catch (erro) {
        logger.warn('conexao.revogar_no_provedor.compartilhamento_falhou', {
          connectionId: conexao.id,
          platform: conexao.platform,
          error: erro instanceof Error ? erro.message : 'desconhecido',
        });
        return { tentar: false, resultado: { revogadoNoProvedor: false, motivo: 'falhou' } };
      }
    },
  };
}
