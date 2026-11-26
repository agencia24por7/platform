import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { consume } from '@/shared/security/rateLimit';
import { createCredencialService, type CredencialService } from '../application/credencialService.ts';
import { createExecutor, type Executor } from '../application/execucao.ts';
import { createModelosService, type ModelosService } from '../application/modelosService.ts';
import { criarRegistro, type FerramentaRegistrada, type RegistroDeFerramentas } from '../domain/ferramenta.ts';
import { fornecedoresHabilitados } from '../domain/tarefa.ts';
import { TAREFAS_INTERNAS } from '../domain/tarefasInternas.ts';
import { criarRotaMcp } from '../interface/rotaMcp.ts';
import { escolherChaveMestra } from '@/modules/tokens/infrastructure/chavesMestras';
import { createSeladorDeEnvelope } from '@/modules/tokens/infrastructure/envelope';
import { createCatalogoDeModelos } from './catalogoDeModelos.ts';
import { comCatalogoDeTeste, comModeloDeTeste } from './costuraDeTeste.ts';
import { createCredencialRepository } from './credencialRepository.ts';
import { createModelosRepository } from './modelosRepository.ts';
import { criarPortaAiSdk, modeloDoFornecedor } from './portaAiSdk.ts';
import { CORPO_MAXIMO_DO_MCP, criarManipuladorMcp } from './servidorMcp.ts';

export type ModuloDeIa = {
  readonly registro: RegistroDeFerramentas;
  readonly credenciais: CredencialService;
  readonly executor: Executor;
  readonly modelos: ModelosService;
  mcp(request: Request): Promise<Response>;
};

export function criarIa(audit: AuditRecorder, ferramentas: readonly FerramentaRegistrada[]): ModuloDeIa {
  const config = env();
  const registro = criarRegistro(ferramentas);
  const credenciais = createCredencialService(createCredencialRepository(), registro, audit);
  const avisar = (evento: string, dados: Record<string, unknown>) => logger.warn(evento, dados);
  const manipular = criarManipuladorMcp(registro, avisar);
  const fornecedores = fornecedoresHabilitados(config.IA_FORNECEDORES_HABILITADOS);
  const modelos = createModelosService({
    repositorio: createModelosRepository(),
    selador: createSeladorDeEnvelope(escolherChaveMestra(config)),
    catalogo: comCatalogoDeTeste(createCatalogoDeModelos(), config),
    audit,
    fornecedores,
    tarefas: TAREFAS_INTERNAS,
    avisar,
  });

  return {
    registro,
    credenciais,
    modelos,
    executor: createExecutor({
      resolver: modelos.resolver,
      porta: criarPortaAiSdk(comModeloDeTeste(modeloDoFornecedor, config)),
      registro,
      fornecedores,
      livro: modelos.livro,
      avisar,
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
