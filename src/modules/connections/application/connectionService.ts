import type { Ator } from '@/modules/audit/domain/actor';
import type { MemberRole } from '@/modules/identity/domain/user';
import { canAdminister, canOperate } from '@/modules/identity/domain/user';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { AdAccount, NewAdAccount } from '@/modules/connections/domain/adAccount';
import { isValidExternalId, normalizeExternalId, recusaParaDesvincularConta } from '@/modules/connections/domain/adAccount';
import type { Connection, NewConnection, Platform } from '@/modules/connections/domain/connection';
import {
  ROTULO_DA_PLATAFORMA,
  grantTypesFor,
  missingScopes,
} from '@/modules/connections/domain/connection';
import {
  MOTIVO_DA_CHAVE,
  contaDaChave,
  identidadeDaConexao,
  rotuloDaChave,
  usaChaveDeApi,
  validarChave,
} from '@/modules/connections/domain/chaveDeApi';
import type { CredentialVault } from '@/modules/connections/application/credentialVault';
import type { CredentialTester } from '@/modules/connections/application/credentialTester';
import type { AdAccountRepository } from '@/modules/connections/infrastructure/adAccountRepository';
import type { ConnectionRepository } from '@/modules/connections/infrastructure/connectionRepository';
import type { DiscoveredAccountRepository } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import { logger } from '@/shared/logging/logger';
import { avisarMudancaDePosse, semAvisoDePosse, type AvisoDePosse } from '@/modules/connections/application/avisoDePosse';
import { liberarContasDaConexao } from '@/modules/connections/application/liberacaoDeContas';
import { randomBytes } from 'node:crypto';

export type LinkAccountInput = Omit<NewAdAccount, 'organizationId'> & {
  readonly organizationId: string;
  readonly platform: Platform;
};

export type ConnectionService = {
  createConnection(input: NewConnection, ator: Ator): Promise<Result<Connection, Failure>>;
  linkAccount(input: LinkAccountInput, ator: Ator): Promise<Result<AdAccount, Failure>>;
  listConnections(organizationId: string): Promise<readonly Connection[]>;
  listAccountsByClient(organizationId: string, clientId: string): Promise<readonly AdAccount[]>;
  listAccounts(organizationId: string): Promise<readonly (AdAccount & { clientName: string })[]>;
  guardarChave(input: {
    organizationId: string;
    organizationSlug: string;
    papelDeQuemAge: MemberRole;
    platform: Platform;
    chave: string;
  }, ator: Ator): Promise<Result<Connection, Failure>>;
  removerConexao(input: {
    organizationId: string;
    papelDeQuemAge: MemberRole;
    connectionId: string;
  }, ator: Ator): Promise<Result<void, Failure>>;
  reassignAccount(input: {
    organizationId: string;
    papelDeQuemAge: MemberRole;
    accountId: string;
    clientId: string;
  }, ator: Ator): Promise<Result<AdAccount, Failure>>;
  setAccountSync(input: {
    organizationId: string;
    papelDeQuemAge: MemberRole;
    accountId: string;
    enabled: boolean;
  }, ator: Ator): Promise<Result<AdAccount, Failure>>;
  unlinkAccount(input: {
    organizationId: string;
    papelDeQuemAge: MemberRole;
    accountId: string;
  }, ator: Ator): Promise<Result<AdAccount, Failure>>;
};

export type ClientOwnership = {
  findById(organizationId: string, id: string): Promise<{ readonly id: string; readonly name: string } | null>;
};

export type ProvisionadorDeColetor = {
  provisionar(input: { readonly platform: Platform; readonly credentialRef: string; readonly label: string }): Promise<string | null>;
  remover(workflowId: string): Promise<boolean>;
};

export function createConnectionService(
  connections: ConnectionRepository,
  accounts: AdAccountRepository,
  audit: AuditRecorder,
  clients: ClientOwnership,
  vault: CredentialVault,
  tester: CredentialTester,
  workflows: ProvisionadorDeColetor,
  contasDescobertas: Pick<DiscoveredAccountRepository, 'replace' | 'liberarDaConexao'>,
  aviso: AvisoDePosse = semAvisoDePosse,
): ConnectionService {
  async function provisionarColetor(organizationId: string, connection: Connection): Promise<string | null> {
    try {
      const coletorRef = await workflows.provisionar({
        platform: connection.platform,
        credentialRef: connection.credentialRef,
        label: connection.label,
      });
      if (!coletorRef) return null;
      const anterior = await connections.trocarColetorRef(organizationId, connection.id, coletorRef);
      if (anterior && anterior !== coletorRef) await workflows.remover(anterior);
      return coletorRef;
    } catch (error) {
      logger.warn('coletor.provisionar.ignorado', {
        platform: connection.platform,
        connectionId: connection.id,
        error: error instanceof Error ? error.message : 'desconhecido',
      });
      return null;
    }
  }

  return {
    async guardarChave(input, ator) {
      if (!usaChaveDeApi(input.platform)) {
        return err(failure('validation', MOTIVO_DA_CHAVE.plataforma_invalida));
      }
      if (!canAdminister(input.papelDeQuemAge)) {
        return err(failure('forbidden', MOTIVO_DA_CHAVE.sem_permissao));
      }

      const motivo = validarChave(input.chave);
      if (motivo) return err(failure('validation', MOTIVO_DA_CHAVE[motivo]));
      if (!vault.available) return err(failure('unavailable', MOTIVO_DA_CHAVE.cofre_indisponivel));

      const chave = input.chave.trim();

      const teste = await tester.testar(input.platform, chave);
      if (!teste.ok) return err(teste.error);

      const apelido = rotuloDaChave(chave);
      const identidade = identidadeDaConexao();
      const label = ROTULO_DA_PLATAFORMA[input.platform];

      const credentialRef = await vault.store({
        label: `ORLA · ${label} · ${input.organizationSlug}`,
        platform: input.platform,
        accessToken: chave,
        refreshToken: null,
        clientId: '',
        clientSecret: '',
      });

      const existente = await connections.findByExternalId(
        input.organizationId,
        input.platform,
        identidade,
      );

      const webhookToken =
        existente?.webhookToken ?? (input.platform === 'zapi' ? randomBytes(24).toString('base64url') : null);

      const proposta = {
        organizationId: input.organizationId,
        platform: input.platform,
        grantType: 'api_key' as const,
        label: `${label} · ${apelido}`,
        externalId: identidade,
        accountEmail: null,
        scopes: [],
        credentialRef,
        status: 'active' as const,
        expiresAt: null,
        webhookToken,
        authorizedVia: 'staff' as const,
      };

      const connection = existente
        ? await connections.renew({ ...proposta, id: existente.id })
        : await connections.insert(proposta);

      if (existente && existente.credentialRef !== credentialRef) {
        await vault.discard(existente.credentialRef);
      }

      await contasDescobertas.replace(input.organizationId, connection.id, [
        contaDaChave({ platform: input.platform, externalId: connection.externalId, label: connection.label }),
      ]);

      const coletorRef = await provisionarColetor(input.organizationId, connection);

      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'connection.key_stored',
        targetType: 'connection',
        targetId: connection.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { platform: input.platform, apelido, rotacionou: Boolean(existente), coletorProvisionado: Boolean(coletorRef) },
      });

      return ok(connection);
    },

    async removerConexao(input, ator) {
      if (!canAdminister(input.papelDeQuemAge)) {
        return err(failure('forbidden', 'Só quem administra a organização pode remover uma conexão.'));
      }

      const conexao = await connections.findById(input.organizationId, input.connectionId);
      if (!conexao || conexao.status === 'revoked') {
        return err(failure('not_found', 'Conexão não encontrada.'));
      }

      const descarte = await vault.discard(conexao.credentialRef);
      if (descarte === 'falhou' || descarte === 'sem_permissao') {
        return err(
          failure('conflict', 'Não deu para apagar a credencial no cofre. Nada foi alterado; tente de novo.'),
        );
      }

      const revogada = await connections.revogar(input.organizationId, conexao.id);
      if (!revogada) return err(failure('not_found', 'Conexão não encontrada.'));

      const liberadas = await liberarContasDaConexao(
        contasDescobertas,
        clients,
        audit,
        { organizationId: input.organizationId, connectionId: conexao.id },
        ator,
      );

      for (const workflowId of [revogada.coletorRef, revogada.executorRef]) {
        if (workflowId) await workflows.remover(workflowId);
      }

      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'connection.removed',
        targetType: 'connection',
        targetId: conexao.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { platform: conexao.platform, contasLiberadas: liberadas.length },
      });

      if (liberadas.length > 0) avisarMudancaDePosse(aviso, 'connection_account.unlink');
      return ok(undefined);
    },

    async createConnection(input, ator) {
      if (!grantTypesFor(input.platform).includes(input.grantType)) {
        return err(failure('validation', 'Caminho de autorização incompatível com a plataforma.'));
      }

      const absent = missingScopes(input.platform, input.scopes);
      if (absent.length > 0) {
        return err(failure('validation', `Escopo obrigatório ausente: ${absent.join(', ')}.`));
      }

      const existente = await connections.findByExternalId(input.organizationId, input.platform, input.externalId);
      if (existente && existente.status !== 'revoked') {
        return err(failure('conflict', 'Esta autorização já existe nesta organização.'));
      }

      const connection = existente
        ? await connections.renew({ ...input, id: existente.id })
        : await connections.insert(input);

      await audit.record({
        organizationId: connection.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'connection.create',
        targetType: 'connection',
        targetId: connection.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: {
          platform: connection.platform,
          grantType: connection.grantType,
          scopes: connection.scopes,
          credentialRefPresent: connection.credentialRef.length > 0,
        },
      });

      return ok(connection);
    },

    async linkAccount(input, ator) {
      if (!(await clients.findById(input.organizationId, input.clientId))) {
        return err(failure('validation', 'Cliente não encontrado nesta organização.'));
      }

      const connection = await connections.findById(input.organizationId, input.connectionId);
      if (!connection) return err(failure('validation', 'Autorização não encontrada nesta organização.'));
      if (connection.platform !== input.platform) {
        return err(failure('validation', 'A conta não pertence à plataforma desta autorização.'));
      }
      if (connection.status === 'revoked') {
        return err(failure('conflict', 'Autorização revogada. Reautorize antes de vincular contas.'));
      }

      const externalId = normalizeExternalId(input.platform, input.externalId);
      if (!isValidExternalId(input.platform, externalId)) {
        return err(
          failure(
            'validation',
            input.platform === 'google'
              ? 'ID do Google Ads deve ter o formato 123-456-7890.'
              : 'ID do Meta deve ter o formato act_1234567890.',
          ),
        );
      }

      const jaVinculada = await accounts.findByExternalId(input.organizationId, input.platform, externalId);
      if (jaVinculada && jaVinculada.status !== 'unlinked') {
        const dono = await clients.findById(input.organizationId, jaVinculada.clientId);
        return err(
          failure(
            'conflict',
            `Esta conta já está vinculada a ${dono?.name ?? 'outro cliente'}. Uma conta de anúncio ` +
              'pertence a um cliente por vez, para que a métrica tenha um dono só. Abra esse cliente e ' +
              'use Mover para trazê-la.',
          ),
        );
      }

      const reativada = jaVinculada !== null;
      const account = reativada
        ? await accounts.reativar(input.organizationId, jaVinculada.id, { ...input, externalId })
        : await accounts.insert({ ...input, externalId });
      if (!account) return err(failure('conflict', 'A conta mudou enquanto você vinculava. Recarregue a página.'));

      await audit.record({
        organizationId: account.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: reativada ? 'ad_account.relinked' : 'ad_account.link',
        targetType: 'ad_account',
        targetId: account.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: {
          platform: account.platform,
          externalId: account.externalId,
          clientId: account.clientId,
          connectionId: account.connectionId,
          syncEnabled: account.syncEnabled,
        },
      });

      avisarMudancaDePosse(aviso, reativada ? 'ad_account.relinked' : 'ad_account.link');
      return ok(account);
    },

    listConnections: (organizationId) => connections.list(organizationId),
    listAccountsByClient: (organizationId, clientId) => accounts.listByClient(organizationId, clientId),
    async reassignAccount(input, ator) {
      if (!canOperate(input.papelDeQuemAge)) {
        return err(failure('forbidden', 'Seu papel não permite mover contas entre clientes.'));
      }

      const conta = await accounts.findById(input.organizationId, input.accountId);
      if (!conta) return err(failure('not_found', 'Conta não encontrada nesta organização.'));

      const destino = await clients.findById(input.organizationId, input.clientId);
      if (!destino) return err(failure('validation', 'Cliente de destino não pertence a esta organização.'));
      if (conta.clientId === input.clientId) return ok(conta);

      const origem = await clients.findById(input.organizationId, conta.clientId);
      const movida = await accounts.reassign(input.organizationId, input.accountId, input.clientId);
      if (!movida) return err(failure('not_found', 'Conta não encontrada nesta organização.'));

      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'ad_account.reassigned',
        targetType: 'ad_account',
        targetId: movida.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: {
          externalId: movida.externalId,
          de: origem?.name ?? conta.clientId,
          para: destino.name,
          historico: 'scd2',
        },
      });

      avisarMudancaDePosse(aviso, 'ad_account.reassigned');
      return ok(movida);
    },

    async unlinkAccount(input, ator) {
      const conta = await accounts.findById(input.organizationId, input.accountId);
      const recusa = recusaParaDesvincularConta(input.papelDeQuemAge, conta);
      if (recusa) return err(failure(recusa.codigo, recusa.mensagem));

      const solta = await accounts.desvincular(input.organizationId, input.accountId);
      if (!solta) return err(failure('conflict', 'A conta mudou enquanto você desvinculava. Recarregue a página.'));

      const cliente = await clients.findById(input.organizationId, conta!.clientId);
      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'ad_account.unlinked',
        targetType: 'ad_account',
        targetId: solta.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: {
          platform: solta.platform,
          externalId: solta.externalId,
          de: cliente?.name ?? conta!.clientId,
          historico: 'scd2',
        },
      });

      avisarMudancaDePosse(aviso, 'ad_account.unlinked');
      return ok(solta);
    },

    async setAccountSync(input, ator) {
      if (!canOperate(input.papelDeQuemAge)) {
        return err(failure('forbidden', 'Seu papel não permite pausar ou retomar a coleta.'));
      }

      const conta = await accounts.findById(input.organizationId, input.accountId);
      if (!conta) return err(failure('not_found', 'Conta não encontrada nesta organização.'));
      if (conta.syncEnabled === input.enabled) return ok(conta);

      const alterada = await accounts.setSync(input.organizationId, input.accountId, input.enabled);
      if (!alterada) return err(failure('not_found', 'Conta não encontrada nesta organização.'));

      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: input.enabled ? 'ad_account.sync_resumed' : 'ad_account.sync_paused',
        targetType: 'ad_account',
        targetId: alterada.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { externalId: alterada.externalId, name: alterada.name },
      });

      return ok(alterada);
    },

    listAccounts: (organizationId) => accounts.listByOrganization(organizationId),
  };
}
