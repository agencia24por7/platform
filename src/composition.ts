import { createAuditRepository } from '@/modules/audit/infrastructure/auditRepository';
import { createColetaService } from '@/modules/coleta/application/coletaService';
import { createColetaRepository } from '@/modules/coleta/infrastructure/coletaRepository';
import { createBigQueryGravador } from '@/modules/coleta/infrastructure/bigQueryGravador';
import { createClientService } from '@/modules/clients/application/clientService';
import { createClientRepository } from '@/modules/clients/infrastructure/clientRepository';
import { createContextoService } from '@/modules/clients/application/contextoService';
import { adaptarArmazenamento } from '@/modules/clients/infrastructure/armazenamentoAdaptado';
import { criarArmazenamentoDeContexto } from '@/shared/storage/criarArmazenamentoDeContexto';
import { env } from '@/shared/config/env';
import { createContextoRepository } from '@/modules/clients/infrastructure/contextoRepository';
import { createAuthorizationService } from '@/modules/connections/application/authorizationService';
import { createConnectionService } from '@/modules/connections/application/connectionService';
import { createAdAccountRepository } from '@/modules/connections/infrastructure/adAccountRepository';
import { createConnectionRepository } from '@/modules/connections/infrastructure/connectionRepository';
import { createConnectionInviteRepository } from '@/modules/connections/infrastructure/connectionInviteRepository';
import { createDiscoveredAccountRepository } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import { createTaskRepository } from '@/modules/connections/infrastructure/taskRepository';
import { createCredentialTester } from '@/modules/connections/infrastructure/credentialTester';
import { createPlatformDiscovery } from '@/modules/connections/infrastructure/platformDiscovery';
import { createIdentityService } from '@/modules/identity/application/identityService';
import { createUserRepository } from '@/modules/identity/infrastructure/userRepository';
import { createIngestionService } from '@/modules/ingestion/application/ingestionService';
import { createMetricsRepository } from '@/modules/ingestion/infrastructure/metricsRepository';
import { createSyncRunRepository } from '@/modules/ingestion/infrastructure/syncRunRepository';
import { createTeamService } from '@/modules/team/application/teamService';
import { createTeamRepository } from '@/modules/team/infrastructure/teamRepository';
import { createRecursoService } from '@/modules/connections/application/recursoService';
import { createOrganizationService } from '@/modules/organizations/application/organizationService';
import { createOrganizationRepository } from '@/modules/organizations/infrastructure/organizationRepository';
import { createRetencaoService } from '@/modules/privacidade/application/retencaoService';
import { createRetencaoRepository } from '@/modules/privacidade/infrastructure/retencaoRepository';
import { createAlertaService } from '@/modules/alertas/application/alertaService';
import { createAlertaRepository } from '@/modules/alertas/infrastructure/alertaRepository';
import { createLimiteDeAlertasNovos, createNotificadorPorWebhook } from '@/modules/alertas/infrastructure/alertaNotificador';
import { createDimensoesService } from '@/modules/coleta/application/dimensoesService';
import { createDimensoesRepository } from '@/modules/coleta/infrastructure/dimensoesRepository';
import { createDimensoesBigQuery } from '@/modules/coleta/infrastructure/dimensoesBigQuery';
import { criarBrain } from '@/modules/brain/infrastructure/criarBrain';
import { criarModuloDeTokens } from '@/modules/tokens/infrastructure/criarModuloDeTokens';
import { createPoliticaDeRevogacao } from '@/modules/privacidade/application/revogacaoNoProvedor';
import { createExpurgoDeFontesService } from '@/modules/privacidade/application/expurgoDeFontes';
import { createPedidosDeExclusaoService } from '@/modules/privacidade/application/pedidosDeExclusao';
import {
  createAcessosCompartilhados,
  createFilaDeExpurgo,
  createPedidosDeExclusaoRepository,
} from '@/modules/privacidade/infrastructure/privacidadeRepository';
import { createExpurgoNoBigQuery } from '@/modules/privacidade/infrastructure/expurgoNoBigQuery';

function build() {
  const audit = createAuditRepository();
  const adAccounts = createAdAccountRepository();
  const connectionRepository = createConnectionRepository();
  const discoveredAccounts = createDiscoveredAccountRepository();
  const organizations = createOrganizationService(createOrganizationRepository(), audit);

  const clientRepository = createClientRepository();
  const tokens = criarModuloDeTokens(audit);
  const credentialTester = createCredentialTester();
  const dimensoes = createDimensoesService(createDimensoesRepository(), createDimensoesBigQuery(), audit);
  const politicaDeRevogacao = createPoliticaDeRevogacao(createAcessosCompartilhados());
  const expurgoDeFontes = createExpurgoDeFontesService(createFilaDeExpurgo(), createExpurgoNoBigQuery(), audit);
  const config = env();
  const contexto = createContextoService({
    repositorio: createContextoRepository(),
    audit,
    armazenamento: adaptarArmazenamento(criarArmazenamentoDeContexto(env())),
  });

  const identity = createIdentityService(createUserRepository(), audit);

  return {
    audit,
    discoveredAccounts,
    recursos: createRecursoService(discoveredAccounts, clientRepository, audit, dimensoes),
    connectionInvites: createConnectionInviteRepository(),
    tasks: createTaskRepository(),
    organizations,
    identity,
    clients: createClientService(clientRepository, audit),
    contexto,
    team: createTeamService(createTeamRepository(), audit),
    connections: createConnectionService(
      connectionRepository,
      adAccounts,
      audit,
      clientRepository,
      tokens.cofre,
      credentialTester,
      discoveredAccounts,
      dimensoes,
      {
        decidirRevogacao: (conexao) => politicaDeRevogacao.decidir(conexao),
        expurgarDadosDaConexao: (input) => expurgoDeFontes.expurgarDadosDaConexao(input),
      },
    ),
    authorization: createAuthorizationService(
      organizations,
      connectionRepository,
      discoveredAccounts,
      createPlatformDiscovery(),
      tokens.cofre,
      audit,
    ),
    ingestion: createIngestionService(
      createSyncRunRepository(),
      createMetricsRepository(),
      adAccounts,
      audit,
    ),
    coleta: createColetaService(createColetaRepository(), audit, createBigQueryGravador()),
    retencao: createRetencaoService(createRetencaoRepository(), audit),
    alertas: createAlertaService(createAlertaRepository(), audit, createNotificadorPorWebhook(), createLimiteDeAlertasNovos(), (userId) =>
      identity.operadorDaPlataforma(userId, env().PLATAFORMA_OPERADORES)),
    dimensoes,
    brain: criarBrain(audit, contexto),
    tokens,
    expurgoDeFontes,
    pedidosDeExclusao: createPedidosDeExclusaoService(createPedidosDeExclusaoRepository(), {
      segredoDoApp: config.META_APP_SECRET,
      pimenta: config.META_EXCLUSAO_PEPPER ?? config.TRIA_SESSION_SECRET,
      pimentasAnteriores: config.META_EXCLUSAO_PEPPER ? [config.TRIA_SESSION_SECRET] : [],
      enderecoPublico: config.TRIA_APP_BASE_URL,
    }),
  };
}

export type Modules = ReturnType<typeof build>;

declare global {
  var __triaModules: Modules | undefined;
}

export function modules(): Modules {
  globalThis.__triaModules ??= build();
  return globalThis.__triaModules;
}
