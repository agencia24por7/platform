import type { Ator } from '@/modules/audit/domain/actor';
import type { MemberRole } from '@/modules/identity/domain/user';
import { canAdminister, canOperate } from '@/modules/identity/domain/user';
import { failure, type Failure } from '@/shared/result/failure';
import { err, ok, type Result } from '@/shared/result/result';
import type { AuditRecorder } from '@/modules/audit/application/auditRecorder';
import type { AdAccount, NewAdAccount } from '@/modules/connections/domain/adAccount';
import { isValidExternalId, normalizeExternalId, recusaParaDesvincularConta } from '@/modules/connections/domain/adAccount';
import type { Connection, Platform } from '@/modules/connections/domain/connection';
import { MENSAGEM_DE_CONEXAO_ALTERADA, ROTULO_DA_PLATAFORMA } from '@/modules/connections/domain/connection';
import {
  MOTIVO_DA_CHAVE,
  contaDaChave,
  identidadeDaConexao,
  rotuloDaChave,
  usaChaveDeApi,
  validarChave,
} from '@/modules/connections/domain/chaveDeApi';
import type { CredentialTester } from '@/modules/connections/application/credentialTester';
import type { AdAccountRepository } from '@/modules/connections/infrastructure/adAccountRepository';
import type { ConnectionRepository } from '@/modules/connections/infrastructure/connectionRepository';
import type { DiscoveredAccountRepository } from '@/modules/connections/infrastructure/discoveredAccountRepository';
import { logger } from '@/shared/logging/logger';
import { avisarMudancaDePosse, semAvisoDePosse, type AvisoDePosse } from '@/modules/connections/application/avisoDePosse';
import { liberarContasDaConexao } from '@/modules/connections/application/liberacaoDeContas';
import {
  avisoDaRevogacao,
  resultadoDaRevogacaoNoCofre,
  type ConexaoARevogar,
  type DecisaoDeRevogacao,
  type RevogadoNoProvedor,
} from '@/modules/privacidade/domain/revogacao';
import type { ResultadoDoExpurgoDaConexao } from '@/modules/privacidade/application/expurgoDeFontes';
import type { CofreDeTokens } from '@/modules/tokens/application/cofreDeTokens';
import { randomBytes, randomUUID } from 'node:crypto';

function violouUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && (erro as { code?: unknown }).code === '23505';
}

export type LinkAccountInput = Omit<NewAdAccount, 'organizationId'> & {
  readonly organizationId: string;
  readonly platform: Platform;
};

export type ConnectionService = {
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
  }, ator: Ator): Promise<Result<ResultadoDaRemocao, Failure>>;
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

export type PrivacidadeDaRemocao = {
  decidirRevogacao(conexao: ConexaoARevogar): Promise<DecisaoDeRevogacao>;
  expurgarDadosDaConexao(input: {
    readonly organizationId: string;
    readonly connectionId: string;
    readonly platform: Platform;
  }): Promise<ResultadoDoExpurgoDaConexao>;
};

export const semPrivacidadeNaRemocao: PrivacidadeDaRemocao = {
  decidirRevogacao: async () => ({ tentar: false, resultado: { revogadoNoProvedor: 'nao_suportado', motivo: 'plataforma_sem_revogacao' } }),
  expurgarDadosDaConexao: async () => ({ enfileirados: 0, concluidos: 0 }),
};

export type ResultadoDaRemocao = {
  readonly revogadoNoProvedor: RevogadoNoProvedor;
  readonly avisoDeRevogacao: string | null;
  readonly expurgo: ResultadoDoExpurgoDaConexao;
};

const MENSAGEM_DE_REMOCAO_QUE_FALHOU_DEPOIS_DE_REVOGAR =
  'O acesso já foi revogado no provedor, mas a conexão mudou enquanto era removida. Ela continua na lista; recarregue e remova de novo.';

export type CofreDaConexao = Pick<CofreDeTokens, 'selar' | 'revogarEApagar' | 'esquecer'>;

export function createConnectionService(
  connections: ConnectionRepository,
  accounts: AdAccountRepository,
  audit: AuditRecorder,
  clients: ClientOwnership,
  cofre: CofreDaConexao,
  tester: CredentialTester,
  contasDescobertas: Pick<DiscoveredAccountRepository, 'replace' | 'liberarDaConexao'>,
  aviso: AvisoDePosse = semAvisoDePosse,
  privacidade: PrivacidadeDaRemocao = semPrivacidadeNaRemocao,
): ConnectionService {
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
      const chave = input.chave.trim();

      const teste = await tester.testar(input.platform, chave);
      if (!teste.ok) return err(teste.error);

      const apelido = rotuloDaChave(chave);
      const identidade = identidadeDaConexao();
      const label = ROTULO_DA_PLATAFORMA[input.platform];

      const existente = await connections.findByExternalId(input.organizationId, input.platform, identidade);
      const connectionId = existente?.id ?? randomUUID();
      const selado = await cofre.selar({ connectionId, platform: input.platform }, { tipo: 'api_key', segredo: chave });
      if (!selado.ok) return err(failure('unavailable', MOTIVO_DA_CHAVE.cofre_indisponivel));

      const webhookToken =
        existente?.webhookToken ?? (input.platform === 'zapi' ? randomBytes(24).toString('base64url') : null);

      const proposta = {
        id: connectionId,
        organizationId: input.organizationId,
        platform: input.platform,
        grantType: 'api_key' as const,
        label: `${label} · ${apelido}`,
        externalId: identidade,
        accountEmail: null,
        scopes: [],
        status: 'active' as const,
        expiresAt: null,
        webhookToken,
        authorizedVia: 'staff' as const,
      };

      let connection: Connection | null;
      try {
        connection = existente
          ? await connections.renew(proposta, selado.value, existente.versaoDoToken)
          : await connections.insert(proposta, selado.value);
      } catch (erro) {
        if (!violouUnicidade(erro)) throw erro;
        return err(failure('conflict', MENSAGEM_DE_CONEXAO_ALTERADA));
      }
      cofre.esquecer(connectionId);

      if (!connection) return err(failure('conflict', MENSAGEM_DE_CONEXAO_ALTERADA));

      await contasDescobertas.replace(input.organizationId, connection.id, [
        contaDaChave({ platform: input.platform, externalId: connection.externalId, label: connection.label }),
      ]);

      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'connection.key_stored',
        targetType: 'connection',
        targetId: connection.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: { platform: input.platform, apelido, rotacionou: Boolean(existente), segredoNoCofre: 'api_key' },
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

      const decisao = await privacidade.decidirRevogacao(conexao).catch(
        (): DecisaoDeRevogacao => ({ tentar: false, resultado: { revogadoNoProvedor: false, motivo: 'falhou' } }),
      );

      const remocao = await cofre.revogarEApagar(
        { organizationId: input.organizationId, connectionId: conexao.id },
        {
          revogarNoProvedor: decisao.tentar,
          apagar: (versaoLida) => connections.revogar(input.organizationId, conexao.id, versaoLida),
        },
      );
      const revogacao = decisao.tentar ? resultadoDaRevogacaoNoCofre(remocao.revogacao) : decisao.resultado;

      if (!remocao.apagado) {
        if (revogacao.revogadoNoProvedor === true) {
          await audit.record({
            organizationId: input.organizationId,
            actorType: 'user',
            actorId: ator.userId,
            action: 'connection.provider_revoked',
            targetType: 'connection',
            targetId: conexao.id,
            requestId: ator.requestId,
            sourceIp: ator.sourceIp,
            metadata: { platform: conexao.platform, revogadoNoProvedor: true, tokenNoCofre: true },
          });
        }
        const atual = await connections.findById(input.organizationId, conexao.id);
        if (!atual || atual.status === 'revoked') return err(failure('not_found', 'Conexão não encontrada.'));
        return err(failure('conflict', revogacao.revogadoNoProvedor === true ? MENSAGEM_DE_REMOCAO_QUE_FALHOU_DEPOIS_DE_REVOGAR : MENSAGEM_DE_CONEXAO_ALTERADA));
      }

      const liberadas = await liberarContasDaConexao(
        contasDescobertas,
        clients,
        audit,
        { organizationId: input.organizationId, connectionId: conexao.id },
        ator,
      );

      const expurgo = await privacidade
        .expurgarDadosDaConexao({ organizationId: input.organizationId, connectionId: conexao.id, platform: conexao.platform })
        .catch((): ResultadoDoExpurgoDaConexao => ({ enfileirados: 0, concluidos: 0 }));

      await audit.record({
        organizationId: input.organizationId,
        actorType: 'user',
        actorId: ator.userId,
        action: 'connection.removed',
        targetType: 'connection',
        targetId: conexao.id,
        requestId: ator.requestId,
        sourceIp: ator.sourceIp,
        metadata: {
          platform: conexao.platform,
          contasLiberadas: liberadas.length,
          tokenApagado: true,
          revogadoNoProvedor: revogacao.revogadoNoProvedor,
          motivoDaRevogacao: revogacao.motivo,
          ...(expurgo.enfileirados > 0 ? { expurgoDeFontes: expurgo } : {}),
        },
      });

      if (liberadas.length > 0) avisarMudancaDePosse(aviso, 'connection_account.unlink');
      return ok({
        revogadoNoProvedor: revogacao.revogadoNoProvedor,
        avisoDeRevogacao: avisoDaRevogacao(conexao.platform, revogacao),
        expurgo,
      });
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
          deId: conta.clientId,
          para: destino.name,
          paraId: destino.id,
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
          deId: conta!.clientId,
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
