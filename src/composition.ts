import { createAuditRepository } from '@/modules/audit/infrastructure/auditRepository';
import { createColetaService } from '@/modules/coleta/application/coletaService';
import { createColetaRepository } from '@/modules/coleta/infrastructure/coletaRepository';
import { createBigQueryGravador } from '@/modules/coleta/infrastructure/bigQueryGravador';
import { createClientService } from '@/modules/clients/application/clientService';
import { createClientRepository } from '@/modules/clients/infrastructure/clientRepository';
import { createContextoService, criarAgendadorEmMemoria } from '@/modules/clients/application/contextoService';
import { adaptarArmazenamento } from '@/modules/clients/infrastructure/armazenamentoAdaptado';
import { criarArmazenamentoDeContexto } from '@/shared/storage/criarArmazenamentoDeContexto';
import { env } from '@/shared/config/env';
import { criarAvisoLimitado } from '@/shared/logging/avisoLimitado';
import { logger } from '@/shared/logging/logger';
import { createRegrasService } from '@/modules/clients/application/regrasService';
import { createRegrasRepository } from '@/modules/clients/infrastructure/regrasRepository';
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
import { ferramentasDoBrain } from '@/modules/brain/interface/ferramentas';
import { criarIa } from '@/modules/ia/infrastructure/criarIa';
import { createDestinoService } from '@/modules/clients/application/destinoService';
import { createDestinoRepository } from '@/modules/clients/infrastructure/destinoRepository';
import { createEstrategiaService } from '@/modules/strategy/application/estrategiaService';
import { createMotorDoPlano } from '@/modules/strategy/application/motorDoPlano';
import { createProcessadorDeExecucoes } from '@/modules/strategy/application/processadorDeExecucoes';
import { criarAvaliadorDeLimites } from '@/modules/strategy/infrastructure/avaliadorDeLimites';
import { criarLeitorDoBrain } from '@/modules/strategy/infrastructure/leitorDoBrain';
import { createEstrategiaRepository } from '@/modules/strategy/infrastructure/estrategiaRepository';
import { comValidacao } from '@/modules/strategy/infrastructure/ia/comValidacao';
import { criarIaDaCamada } from '@/modules/strategy/infrastructure/ia/iaDaCamada';
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
  const tokens = criarModuloDeTokens(audit, [(versaoPrimaria, limite) => ia.modelos.recifrar(versaoPrimaria, limite)]);
  const credentialTester = createCredentialTester();
  const dimensoes = createDimensoesService(createDimensoesRepository(), createDimensoesBigQuery(), audit);
  const politicaDeRevogacao = createPoliticaDeRevogacao(createAcessosCompartilhados());
  const expurgoDeFontes = createExpurgoDeFontesService(createFilaDeExpurgo(), createExpurgoNoBigQuery(), audit);
  const config = env();
  const armazenamentoDoContexto = adaptarArmazenamento(criarArmazenamentoDeContexto(env()));
  const contexto = createContextoService({
    repositorio: createContextoRepository(),
    audit,
    armazenamento: armazenamentoDoContexto,
    ...(config.NODE_ENV === 'production' ? { avisarSemEndereco: criarAvisoDeAcessoSemEndereco() } : {}),
  });
  const agendadorDoBrainDeRegras = criarAgendadorEmMemoria()((escopo) => contexto.publicarBrain(escopo));
  const regras = createRegrasService({
    repositorio: createRegrasRepository(),
    audit,
    agendarBrain: (escopo) => {
      if (armazenamentoDoContexto.configurado) agendadorDoBrainDeRegras.agendar(escopo);
    },
  });

  const identity = createIdentityService(createUserRepository(), audit);
  const destino = createDestinoService(createDestinoRepository(), audit);
  const estrategiaRepository = createEstrategiaRepository();
  const brain = criarBrain(audit, contexto, regras);
  const ia = criarIa(audit, ferramentasDoBrain(brain));
  const leitorDoBrainDaEstrategia = criarLeitorDoBrain({ brain });
  const executorDeIA = comValidacao(criarIaDaCamada(ia.executor));
  const avaliadorDeLimites = criarAvaliadorDeLimites({ regras });
  const motorDoPlano = createMotorDoPlano({
    repositorio: estrategiaRepository,
    executorDeIA,
    leitorDoBrain: leitorDoBrainDaEstrategia,
    avaliadorDeLimites,
    audit,
  });

  return {
    audit,
    discoveredAccounts,
    recursos: createRecursoService(discoveredAccounts, clientRepository, audit, dimensoes),
    connectionInvites: createConnectionInviteRepository(),
    tasks: createTaskRepository(),
    organizations,
    identity,
    clients: createClientService(clientRepository, audit),
    destino,
    contexto,
    regras,
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
    brain,
    ia,
    strategy: {
      service: createEstrategiaService({ repositorio: estrategiaRepository, audit, leitorDoBrain: leitorDoBrainDaEstrategia, destino }),
    },
    strategyDoWorker: {
      processador: createProcessadorDeExecucoes({ repositorio: estrategiaRepository, motor: motorDoPlano }),
    },
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

function criarAvisoDeAcessoSemEndereco(): () => void {
  return criarAvisoLimitado({
    janelaMs: 60_000,
    emitir: (contexto) => logger.warn('contexto.publico.sem_endereco_confiavel', contexto),
  });
}
