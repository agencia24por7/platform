import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { consume } from '@/shared/security/rateLimit';
import type { LimiteDeNovos, Notificador } from '@/modules/alertas/application/alertaService';

const TEMPO_LIMITE_DA_NOTIFICACAO_MS = 5_000;
const LIMITE_DE_ALERTAS_NOVOS_POR_HORA = 60;
const UMA_HORA_EM_MS = 3_600_000;

export function createNotificadorPorWebhook(): Notificador {
  return async (texto) => {
    const destinoDoAlerta = env().ALERT_WEBHOOK_URL;
    if (!destinoDoAlerta) return;
    try {
      const resposta = await fetch(destinoDoAlerta, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texto }),
        signal: AbortSignal.timeout(TEMPO_LIMITE_DA_NOTIFICACAO_MS),
      });
      if (!resposta.ok) logger.warn('alerta.webhook_recusou', { status: resposta.status });
    } catch (error) {
      logger.warn('alerta.webhook_falhou', { error: error instanceof Error ? error.name : 'desconhecido' });
    }
  };
}

export function createLimiteDeAlertasNovos(): LimiteDeNovos {
  return () => consume('alertas:novos', LIMITE_DE_ALERTAS_NOVOS_POR_HORA, UMA_HORA_EM_MS).allowed;
}
