import { sql } from '@/shared/db/client';
import { withTenant, type TenantSession } from '@/shared/db/tenant';
import type { Platform } from '@/modules/connections/domain/connection';
import type { Alvo, TipoDeSegredo } from '@/modules/tokens/domain/token';
import type {
  MarcadorDeReautorizacao,
  MudancaDeToken,
  NovoSegredo,
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

async function lerLinha(tx: TenantSession, connectionId: string): Promise<RegistroDeToken | null> {
  const linhas = (await tx`
    SELECT t.connection_id, t.organization_id, n.platform::text AS platform, t.tipo, t.ciphertext, t.segredo_expira_em,
           t.access_token_ciphertext, t.access_expires_at, t.refreshed_at, t.versao
    FROM integrations.connection_tokens t
    JOIN integrations.connections n ON n.id = t.connection_id
    WHERE t.connection_id = ${connectionId}`) as unknown as Linha[];
  return linhas[0] ? paraRegistro(linhas[0]) : null;
}

export async function gravarSegredoNaTransacao(tx: TenantSession, alvo: Alvo, novo: NovoSegredo): Promise<void> {
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
      renovacao_iniciada_em = NULL,
      renovacao_dono = NULL,
      versao = integrations.connection_tokens.versao + 1`;
}

export async function versaoDoTokenNaTransacao(tx: TenantSession, connectionId: string): Promise<number | null> {
  const linhas = (await tx`
    SELECT versao FROM integrations.connection_tokens WHERE connection_id = ${connectionId}
    FOR UPDATE`) as unknown as { versao: number }[];
  return linhas[0]?.versao ?? null;
}

export async function apagarTokenNaTransacao(tx: TenantSession, connectionId: string): Promise<void> {
  await tx`DELETE FROM integrations.connection_tokens WHERE connection_id = ${connectionId}`;
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
      return withTenant(alvo.organizationId, (tx) => lerLinha(tx, alvo.connectionId));
    },

    async guardar(alvo, novo) {
      await withTenant(alvo.organizationId, (tx) => gravarSegredoNaTransacao(tx, alvo, novo));
    },

    async reivindicarRenovacao(alvo, prazoMs, concessao) {
      return withTenant(alvo.organizationId, async (tx) => {
        const reivindicadas = (await tx`
          UPDATE integrations.connection_tokens
          SET renovacao_iniciada_em = now(), renovacao_dono = ${concessao}
          WHERE connection_id = ${alvo.connectionId}
            AND (renovacao_iniciada_em IS NULL OR renovacao_iniciada_em < now() - make_interval(secs => ${prazoMs / 1000}))
          RETURNING connection_id`) as unknown as unknown[];
        const registro = await lerLinha(tx, alvo.connectionId);
        return { registro, dono: reivindicadas.length > 0 && registro !== null };
      });
    },

    async concluirRenovacao(alvo, versaoLida, concessao, mudanca) {
      return withTenant(alvo.organizationId, async (tx) => {
        const colunas = { ...colunasDa(mudanca), renovacao_iniciada_em: null, renovacao_dono: null };
        const linhas = (await tx`
          UPDATE integrations.connection_tokens
          SET ${tx(colunas)}, versao = versao + 1
          WHERE connection_id = ${alvo.connectionId} AND versao = ${versaoLida}
          RETURNING tipo`) as unknown as { tipo: TipoDeSegredo }[];
        if (!linhas[0]) {
          await tx`
            UPDATE integrations.connection_tokens SET renovacao_iniciada_em = NULL, renovacao_dono = NULL
            WHERE connection_id = ${alvo.connectionId} AND renovacao_dono = ${concessao}`;
          return false;
        }
        if (mudanca.segredo && linhas[0].tipo === 'oauth_long_lived') {
          await tx`
            UPDATE integrations.connections SET expires_at = ${mudanca.segredo.expiraEm}
            WHERE id = ${alvo.connectionId}`;
        }
        return true;
      });
    },

    async liberarRenovacao(alvo, concessao, falha) {
      await withTenant(alvo.organizationId, async (tx) => {
        const colunas: Record<string, unknown> = { renovacao_iniciada_em: null, renovacao_dono: null };
        if (falha !== undefined) Object.assign(colunas, { ultima_falha_codigo: falha, ultima_falha_em: falha === null ? null : new Date() });
        await tx`
          UPDATE integrations.connection_tokens SET ${tx(colunas)}
          WHERE connection_id = ${alvo.connectionId} AND renovacao_dono = ${concessao}`;
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

    async comChaveAntiga(versaoPrimaria, limite) {
      const linhas = (await sql()`
        SELECT connection_id, organization_id FROM integrations.tokens_com_chave_antiga(${versaoPrimaria}, ${limite})`) as unknown as {
        connection_id: string;
        organization_id: string;
      }[];
      return linhas.map((linha) => ({ connectionId: linha.connection_id, organizationId: linha.organization_id }));
    },
  };
}

export function createMarcadorDeReautorizacao(): MarcadorDeReautorizacao {
  return {
    async marcar(alvo: Alvo, _motivo: string, versaoLida: number) {
      await withTenant(alvo.organizationId, async (tx) => {
        await tx`
          UPDATE integrations.connections n SET status = 'reauth_pending'
          WHERE n.id = ${alvo.connectionId} AND n.status IN ('active', 'expiring', 'degraded')
            AND EXISTS (
              SELECT 1 FROM integrations.connection_tokens t
              WHERE t.connection_id = n.id AND t.versao = ${versaoLida})`;
      });
    },
  };
}
