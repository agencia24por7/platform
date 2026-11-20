import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { credenciaisDaPlataforma } from '@/modules/connections/application/credenciaisOauth';
import { falaOauth } from '@/modules/connections/domain/oauth';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { consume } from '@/shared/security/rateLimit';
import { createCofreDeTokens } from '@/modules/tokens/application/cofreDeTokens';
import { createAcessoDoWorker } from '@/modules/tokens/application/acessoDoWorker';
import { escolherChaveMestra } from '@/modules/tokens/infrastructure/chavesMestras';
import { createCifraEnvelope } from '@/modules/tokens/infrastructure/envelope';
import { createFabricaDeProvedores } from '@/modules/tokens/infrastructure/provedores';
import { comProvedorDeTeste } from '@/modules/tokens/infrastructure/provedorDeTeste';
import { createResolvedorDeOrigem } from '@/modules/tokens/infrastructure/resolvedorDeOrigem';
import { createMarcadorDeReautorizacao, createTokenRepository } from '@/modules/tokens/infrastructure/tokenRepository';

const PEDIDOS_POR_EXECUCAO = 30;
const JANELA_MS = 60_000;

export function criarModuloDeTokens(audit: AuditRecorder) {
  const config = env();
  const provedoresReais = createFabricaDeProvedores((platform) =>
    falaOauth(platform) ? credenciaisDaPlataforma(platform) : {},
  );

  const cofre = createCofreDeTokens({
    repositorio: createTokenRepository(),
    cifra: createCifraEnvelope(escolherChaveMestra(config)),
    provedores: comProvedorDeTeste(provedoresReais, config),
    marcador: createMarcadorDeReautorizacao(),
    registro: { info: logger.info, aviso: logger.warn, erro: logger.error },
  });

  const acesso = createAcessoDoWorker({
    resolvedor: createResolvedorDeOrigem(),
    cofre,
    audit,
    limitar: (chave) => consume(chave, PEDIDOS_POR_EXECUCAO, JANELA_MS).allowed,
  });

  return { cofre, acesso };
}
