import { sql } from '@/shared/db/client';
import { withTenant, type TenantSession } from '@/shared/db/tenant';
import type { Platform } from '@/modules/connections/domain/connection';
import type { Alvo, TipoDeSegredo } from '@/modules/tokens/domain/token';
import type {
  MarcadorDeReautorizacao,
  MudancaDeToken,
  RegistroDeToken,
  RepositorioDeTokens,
} from '@/modules/tokens/application/portas';

type Linha = {
  connection_id: string;
  organization_id: string;
  platform: Platform;
  tipo: TipoDeSegredo;
  ciphertext: Buffer;
  segredo_expira_em: Date | null;
  access_token_ciphertext: Buffer | null;
  access_expires_at: Date | null;
  refreshed_at: Date | null;
  versao: number;
};

function paraRegistro(linha: Linha): RegistroDeToken {
  return {
    connectionId: linha.connection_id,
    organizationId: linha.organization_id,
    platform: linha.platform,
    tipo: linha.tipo,
    segredo: Buffer.from(linha.ciphertext),
    segredoExpiraEm: linha.segredo_expira_em,
    acesso: linha.access_token_ciphertext ? Buffer.from(linha.access_token_ciphertext) : null,
    acessoExpiraEm: linha.access_expires_at,
    renovadoEm: linha.refreshed_at,
    versao: linha.versao,
  };
}

async function lerLinha(tx: TenantSession, connectionId: string, travar: boolean): Promise<RegistroDeToken | null> {
  const linhas = (travar
    ? await tx`
        SELECT t.connection_id, t.organization_id, n.platform::text AS platform, t.tipo, t.ciphertext, t.segredo_expira_em,
               t.access_token_ciphertext, t.access_expires_at, t.refreshed_at, t.versao
        FROM integrations.connection_tokens t
        JOIN integrations.connections n ON n.id = t.connection_id
        WHERE t.connection_id = ${connectionId}
        FOR UPDATE OF t`
    : await tx`
        SELECT t.connection_id, t.organization_id, n.platform::text AS platform, t.tipo, t.ciphertext, t.segredo_expira_em,
               t.access_token_ciphertext, t.access_expires_at, t.refreshed_at, t.versao
        FROM integrations.connection_tokens t
        JOIN integrations.connections n ON n.id = t.connection_id
        WHERE t.connection_id = ${connectionId}`) as unknown as Linha[];
  return linhas[0] ? paraRegistro(linhas[0]) : null;
}

function colunasDa(mudanca: MudancaDeToken): Record<string, unknown> {
  const colunas: Record<string, unknown> = {};
  if (mudanca.acesso === null) {
    Object.assign(colunas, { access_token_ciphertext: null, access_kms_key_version: null, access_expires_at: null });
  } else if (mudanca.acesso) {
    Object.assign(colunas, {
      access_token_ciphertext: mudanca.acesso.cifrado.bytes,
      access_kms_key_version: mudanca.acesso.cifrado.versaoDaChave,
      access_expires_at: mudanca.acesso.expiraEm,
    });
  }
  if (mudanca.segredo) {
    Object.assign(colunas, {
      ciphertext: mudanca.segredo.cifrado.bytes,
      kms_key_version: mudanca.segredo.cifrado.versaoDaChave,
      algoritmo: mudanca.segredo.cifrado.algoritmo,
      segredo_expira_em: mudanca.segredo.expiraEm,
    });
  }
  if (mudanca.falha !== undefined) {
    Object.assign(colunas, { ultima_falha_codigo: mudanca.falha, ultima_falha_em: mudanca.falha === null ? null : new Date() });
  }
  if (mudanca.renovadoEm) colunas.refreshed_at = mudanca.renovadoEm;
  return colunas;
}

export function createTokenRepository(): RepositorioDeTokens {
  return {
    async plataformaDa(alvo) {
      return withTenant(alvo.organizationId, async (tx) => {
        const linhas = (await tx`
          SELECT platform::text AS platform FROM integrations.connections WHERE id = ${alvo.connectionId}`) as unknown as {
          platform: Platform;
        }[];
        return linhas[0]?.platform ?? null;
      });
    },

    async carregar(alvo) {
      return withTenant(alvo.organizationId, (tx) => lerLinha(tx, alvo.connectionId, false));
    },

    async guardar(alvo, novo) {
      await withTenant(alvo.organizationId, async (tx) => {
        await tx`
          INSERT INTO integrations.connection_tokens
            (connection_id, organization_id, tipo, ciphertext, kms_key_version, algoritmo, segredo_expira_em)
          VALUES (${alvo.connectionId}, ${alvo.organizationId}, ${novo.tipo}, ${novo.cifrado.bytes},
                  ${novo.cifrado.versaoDaChave}, ${novo.cifrado.algoritmo}, ${novo.expiraEm})
          ON CONFLICT (connection_id) DO UPDATE SET
            tipo = EXCLUDED.tipo,
            ciphertext = EXCLUDED.ciphertext,
            kms_key_version = EXCLUDED.kms_key_version,
            algoritmo = EXCLUDED.algoritmo,
            segredo_expira_em = EXCLUDED.segredo_expira_em,
            access_token_ciphertext = NULL,
            access_kms_key_version = NULL,
            access_expires_at = NULL,
            ultima_falha_codigo = NULL,
            ultima_falha_em = NULL,
            versao = integrations.connection_tokens.versao + 1`;
      });
    },

    async comTrava(alvo, trabalho) {
      return withTenant(alvo.organizationId, async (tx) => {
        const registro = await lerLinha(tx, alvo.connectionId, true);
        let versao = registro?.versao ?? 0;

        return trabalho(registro, async (mudanca) => {
          if (!registro) return false;
          const colunas = colunasDa(mudanca);
          if (Object.keys(colunas).length === 0) return true;

          const linhas = (await tx`
            UPDATE integrations.connection_tokens
            SET ${tx(colunas)}, versao = versao + 1
            WHERE connection_id = ${alvo.connectionId} AND versao = ${versao}
            RETURNING versao`) as unknown as { versao: number }[];
          if (!linhas[0]) return false;
          versao = linhas[0].versao;

          if (mudanca.segredo && registro.tipo === 'oauth_long_lived') {
            await tx`
              UPDATE integrations.connections SET expires_at = ${mudanca.segredo.expiraEm}
              WHERE id = ${alvo.connectionId}`;
          }
          return true;
        });
      });
    },

    async apagar(alvo) {
      return withTenant(alvo.organizationId, async (tx) => {
        const linhas = (await tx`
          DELETE FROM integrations.connection_tokens WHERE connection_id = ${alvo.connectionId}
          RETURNING connection_id`) as unknown as unknown[];
        return linhas.length > 0;
      });
    },

    async aRenovar(antes, limite) {
      const linhas = (await sql()`
        SELECT connection_id, organization_id FROM integrations.tokens_a_renovar(${antes}, ${limite})`) as unknown as {
        connection_id: string;
        organization_id: string;
      }[];
      return linhas.map((linha) => ({ connectionId: linha.connection_id, organizationId: linha.organization_id }));
    },
  };
}

export function createMarcadorDeReautorizacao(): MarcadorDeReautorizacao {
  return {
    async marcar(alvo: Alvo) {
      await withTenant(alvo.organizationId, async (tx) => {
        await tx`
          UPDATE integrations.connections SET status = 'reauth_pending'
          WHERE id = ${alvo.connectionId} AND status IN ('active', 'expiring', 'degraded')`;
      });
    },
  };
}
