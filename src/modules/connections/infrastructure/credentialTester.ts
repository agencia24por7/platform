import { failure } from '@/shared/result/failure';
import { err, ok } from '@/shared/result/result';
import { MOTIVO_DA_CHAVE, partesDaChaveZapi } from '@/modules/connections/domain/chaveDeApi';
import { logger } from '@/shared/logging/logger';
import type { CredentialTester } from '@/modules/connections/application/credentialTester';

const TIMEOUT_MS = 10_000;

export function createCredentialTester(): CredentialTester {
  return {
    async testar(platform, chave) {
      if (platform === 'apify') {
        try {
          const resposta = await fetch('https://api.apify.com/v2/users/me', {
            headers: { Authorization: `Bearer ${chave}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (resposta.ok) return ok(undefined);
          logger.warn('credentialTester.apify.recusada', { status: resposta.status });
          return err(failure('validation', MOTIVO_DA_CHAVE.chave_recusada));
        } catch (error) {
          logger.warn('credentialTester.apify.falhou', {
            error: error instanceof Error ? error.message : 'desconhecido',
          });
          return err(failure('unavailable', 'Não deu para checar a chave com a Apify agora.'));
        }
      }

      if (platform === 'zapi') {
        const partes = partesDaChaveZapi(chave);
        if (!partes) return err(failure('validation', MOTIVO_DA_CHAVE.chave_zapi_incompleta));

        try {
          const resposta = await fetch(
            `https://api.z-api.io/instances/${partes.instanceId}/token/${partes.token}/status`,
            { signal: AbortSignal.timeout(TIMEOUT_MS) },
          );
          if (!resposta.ok) {
            logger.warn('credentialTester.zapi.recusada', { status: resposta.status });
            return err(failure('validation', MOTIVO_DA_CHAVE.chave_recusada));
          }
          const dados = (await resposta.json().catch(() => null)) as { connected?: boolean } | null;
          if (!dados?.connected) {
            return err(
              failure('validation', 'A instância existe, mas não está conectada a um WhatsApp ainda.'),
            );
          }
          return ok(undefined);
        } catch (error) {
          logger.warn('credentialTester.zapi.falhou', {
            error: error instanceof Error ? error.message : 'desconhecido',
          });
          return err(failure('unavailable', 'Não deu para checar a instância com o Z-API agora.'));
        }
      }

      return err(failure('validation', MOTIVO_DA_CHAVE.plataforma_invalida));
    },
  };
}
