import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { consume } from '@/shared/security/rateLimit';
import { createCredencialService, type CredencialService } from '../application/credencialService.ts';
import { createExecutor, resolvedorSemConfiguracao, type Executor } from '../application/execucao.ts';
import { criarRegistro, type FerramentaRegistrada, type RegistroDeFerramentas } from '../domain/ferramenta.ts';
import { fornecedoresHabilitados } from '../domain/tarefa.ts';
import { criarRotaMcp } from '../interface/rotaMcp.ts';
import { createCredencialRepository } from './credencialRepository.ts';
import { criarPortaAiSdk } from './portaAiSdk.ts';
import { CORPO_MAXIMO_DO_MCP, criarManipuladorMcp } from './servidorMcp.ts';

export type ModuloDeIa = {
  readonly registro: RegistroDeFerramentas;
  readonly credenciais: CredencialService;
  readonly executor: Executor;
  mcp(request: Request): Promise<Response>;
};

export function criarIa(audit: AuditRecorder, ferramentas: readonly FerramentaRegistrada[]): ModuloDeIa {
  const config = env();
  const registro = criarRegistro(ferramentas);
  const credenciais = createCredencialService(createCredencialRepository(), registro, audit);
  const manipular = criarManipuladorMcp(registro, (evento, dados) => logger.warn(evento, dados));

  return {
    registro,
    credenciais,
    executor: createExecutor({
      resolver: resolvedorSemConfiguracao,
      porta: criarPortaAiSdk(),
      registro,
      fornecedores: fornecedoresHabilitados(config.IA_FORNECEDORES_HABILITADOS),
      registrarUso: async (uso) => logger.info('ia.execucao', uso),
      avisar: (evento, dados) => logger.warn(evento, dados),
    }),
    mcp: criarRotaMcp({
      habilitado: config.IA_MCP_HABILITADO === 'true',
      origemDoApp: new URL(config.TRIA_APP_BASE_URL).origin,
      chamadasPorMinuto: config.IA_MCP_CHAMADAS_POR_MINUTO,
      corpoMaximo: CORPO_MAXIMO_DO_MCP,
      autenticar: (candidata, origem) => credenciais.autenticar(candidata, origem),
      manipular,
      consumir: consume,
    }),
  };
}
