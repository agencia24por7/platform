import { createAuditRepository } from '@/modules/audit/infrastructure/auditRepository';
import { createColetaService } from '@/modules/coleta/application/coletaService';
import { createColetaRepository } from '@/modules/coleta/infrastructure/coletaRepository';
import { createColetorProvisioner } from '@/modules/coleta/infrastructure/coletorProvisioner';
import { createBigQueryGravador } from '@/modules/coleta/infrastructure/bigQueryGravador';
import { createClientService } from '@/modules/clients/application/clientService';
import { createClientRepository } from '@/modules/clients/infrastructure/clientRepository';
import { createAuthorizationService } from '@/modules/connections/application/authorizationService';
import { createConnectionService } from '@/modules/connections/application/connectionService';
import { createAdAccountRepository } from '@/modules/connections/infrastructure/adAccountRepository';
import { createConnectionRepository } from '@/modules/connections/infrastructure/connectionRepository';
import { createConnectionInviteRepository } from '@/modules/connections/infrastructure/connectionInviteRepository';
import { createDiscoveredAccountRepository } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import { createTaskRepository } from '@/modules/connections/infrastructure/taskRepository';
import { createN8nCredentialVault } from '@/modules/connections/infrastructure/n8nCredentialVault';
import { createCredentialTester } from '@/modules/connections/infrastructure/credentialTester';
import { createPlatformDiscovery } from '@/modules/connections/infrastructure/platformDiscovery';
import { createIdentityService } from '@/modules/identity/application/identityService';
import { createUserRepository } from '@/modules/identity/infrastructure/userRepository';
import { createIngestionService } from '@/modules/ingestion/application/ingestionService';
import { createMetricsRepository } from '@/modules/ingestion/infrastructure/metricsRepository';
import { createSyncRunRepository } from '@/modules/ingestion/infrastructure/syncRunRepository';
import { createTeamService } from '@/modules/team/application/teamService';
import { createTeamRepository } from '@/modules/team/infrastructure/teamRepository';
import { createOrganizationService } from '@/modules/organizations/application/organizationService';
import { createOrganizationRepository } from '@/modules/organizations/infrastructure/organizationRepository';

function build() {
  const audit = createAuditRepository();
  const adAccounts = createAdAccountRepository();
  const connectionRepository = createConnectionRepository();
  const discoveredAccounts = createDiscoveredAccountRepository();
  const organizations = createOrganizationService(createOrganizationRepository(), audit);

  const clientRepository = createClientRepository();
  const vault = createN8nCredentialVault();
  const credentialTester = createCredentialTester();

  return {
    audit,
    discoveredAccounts,
    connectionInvites: createConnectionInviteRepository(),
    tasks: createTaskRepository(),
    organizations,
    identity: createIdentityService(createUserRepository(), audit),
    clients: createClientService(clientRepository, audit),
    team: createTeamService(createTeamRepository(), audit),
    connections: createConnectionService(
      connectionRepository,
      adAccounts,
      audit,
      clientRepository,
      vault,
      credentialTester,
    ),
    authorization: createAuthorizationService(
      organizations,
      connectionRepository,
      discoveredAccounts,
      createPlatformDiscovery(),
      vault,
      audit,
      createColetorProvisioner(),
    ),
    ingestion: createIngestionService(
      createSyncRunRepository(),
      createMetricsRepository(),
      adAccounts,
      audit,
    ),
    coleta: createColetaService(createColetaRepository(), audit, createBigQueryGravador()),
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
