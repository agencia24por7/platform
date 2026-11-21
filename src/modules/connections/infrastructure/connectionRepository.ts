import { withTenant, type TenantSession } from '@/shared/db/tenant';
import type { Connection, NewConnection } from '@/modules/connections/domain/connection';
import type { NovoSegredo } from '@/modules/tokens/application/portas';
import {
  apagarTokenNaTransacao,
  gravarSegredoNaTransacao,
  versaoDoTokenNaTransacao,
} from '@/modules/tokens/infrastructure/tokenRepository';

type Row = {
  id: string;
  organization_id: string;
  platform: Connection['platform'];
  grant_type: Connection['grantType'];
  label: string;
  external_id: string;
  account_email: string | null;
  scopes: string[];
  status: Connection['status'];
  expires_at: Date | null;
  authorized_at: Date;
  webhook_token: string | null;
  authorized_via: Connection['authorizedVia'];
  versao_do_token: number | null;
};

const toConnection = (row: Row): Connection => ({
  id: row.id,
  organizationId: row.organization_id,
  platform: row.platform,
  grantType: row.grant_type,
  label: row.label,
  externalId: row.external_id,
  accountEmail: row.account_email,
  scopes: row.scopes,
  status: row.status,
  expiresAt: row.expires_at,
  authorizedAt: row.authorized_at,
  webhookToken: row.webhook_token,
  authorizedVia: row.authorized_via,
  versaoDoToken: row.versao_do_token,
});

export type NovaConexaoComId = NewConnection & { readonly id: string };

export type ConnectionRepository = {
  insert(input: NovaConexaoComId, segredo: NovoSegredo): Promise<Connection>;
  findById(organizationId: string, id: string): Promise<Connection | null>;
  findByExternalId(organizationId: string, platform: string, externalId: string): Promise<Connection | null>;
  renew(input: NovaConexaoComId, segredo: NovoSegredo, versaoDoTokenEsperada: number | null): Promise<Connection | null>;
  list(organizationId: string): Promise<readonly Connection[]>;
  revogar(organizationId: string, id: string, versaoDoTokenEsperada: number | null): Promise<boolean>;
};

async function lerConexao(tx: TenantSession, id: string): Promise<Connection | null> {
  const rows = (await tx`
    SELECT c.*, t.versao AS versao_do_token
    FROM integrations.connections c
    LEFT JOIN integrations.connection_tokens t ON t.connection_id = c.id
    WHERE c.id = ${id}`) as unknown as Row[];
  return rows[0] ? toConnection(rows[0]) : null;
}

async function travarConexao(tx: TenantSession, id: string, condicao: 'qualquer' | 'nao_revogada'): Promise<boolean> {
  const rows = (condicao === 'nao_revogada'
    ? await tx`SELECT id FROM integrations.connections WHERE id = ${id} AND status <> 'revoked' FOR UPDATE`
    : await tx`SELECT id FROM integrations.connections WHERE id = ${id} FOR UPDATE`) as unknown as unknown[];
  return rows.length > 0;
}

export function createConnectionRepository(): ConnectionRepository {
  return {
    async insert(input, segredo) {
      return withTenant(input.organizationId, async (tx) => {
        await tx`
          INSERT INTO integrations.connections
            (id, organization_id, platform, grant_type, label, external_id, account_email, scopes, expires_at, status, webhook_token, authorized_via)
          VALUES (${input.id}, ${input.organizationId}, ${input.platform}, ${input.grantType}, ${input.label},
                  ${input.externalId}, ${input.accountEmail ?? null}, ${input.scopes as string[]}::text[], ${input.expiresAt},
                  ${input.status ?? 'active'}, ${input.webhookToken ?? null}, ${input.authorizedVia})`;
        await gravarSegredoNaTransacao(tx, { organizationId: input.organizationId, connectionId: input.id }, segredo);
        return (await lerConexao(tx, input.id))!;
      });
    },

    async renew(input, segredo, versaoDoTokenEsperada) {
      return withTenant(input.organizationId, async (tx) => {
        if (!(await travarConexao(tx, input.id, 'qualquer'))) return null;
        if ((await versaoDoTokenNaTransacao(tx, input.id)) !== versaoDoTokenEsperada) return null;

        await tx`
          UPDATE integrations.connections
          SET label          = ${input.label},
              account_email  = ${input.accountEmail ?? null},
              scopes         = ${input.scopes as string[]}::text[],
              status         = ${input.status ?? 'active'},
              expires_at     = ${input.expiresAt},
              authorized_at  = now()
          WHERE id = ${input.id}`;
        await gravarSegredoNaTransacao(tx, { organizationId: input.organizationId, connectionId: input.id }, segredo);
        return lerConexao(tx, input.id);
      });
    },

    async findById(organizationId, id) {
      return withTenant(organizationId, (tx) => lerConexao(tx, id));
    },

    async findByExternalId(organizationId, platform, externalId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT c.*, t.versao AS versao_do_token
          FROM integrations.connections c
          LEFT JOIN integrations.connection_tokens t ON t.connection_id = c.id
          WHERE c.platform = ${platform}::integrations.platform AND c.external_id = ${externalId}`) as unknown as Row[];
        return rows[0] ? toConnection(rows[0]) : null;
      });
    },

    async list(organizationId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT c.*, t.versao AS versao_do_token
          FROM integrations.connections c
          LEFT JOIN integrations.connection_tokens t ON t.connection_id = c.id
          ORDER BY c.authorized_at DESC`) as unknown as Row[];
        return rows.map(toConnection);
      });
    },

    async revogar(organizationId, id, versaoDoTokenEsperada) {
      return withTenant(organizationId, async (tx) => {
        if (!(await travarConexao(tx, id, 'nao_revogada'))) return false;
        if ((await versaoDoTokenNaTransacao(tx, id)) !== versaoDoTokenEsperada) return false;

        await apagarTokenNaTransacao(tx, id);
        await tx`
          UPDATE integrations.connections
          SET status        = 'revoked',
              account_email = NULL,
              webhook_token = NULL
          WHERE id = ${id}`;
        return true;
      });
    },
  };
}
