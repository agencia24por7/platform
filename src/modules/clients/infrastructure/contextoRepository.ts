import { withTenant, withoutTenant } from '@/shared/db/tenant';
import type { Epistemico, Fonte, Revisao, SecaoKey } from '@/modules/clients/domain/contexto/catalogo';
import type {
  ArquivoDeContexto,
  ContextoBruto,
  DadosDoItem,
  EntradaDeCampo,
  ItemDeLista,
  Marcacao,
} from '@/modules/clients/domain/contexto/tipos';

export type Gravado<T> = { readonly ok: true; readonly valor: T } | { readonly ok: false; readonly versaoAtual: number | null };

export type LinkDeContexto = {
  readonly id: string;
  readonly clientId: string;
  readonly secoes: readonly SecaoKey[];
  readonly expiraEm: Date;
  readonly revogadoEm: Date | null;
  readonly criadoEm: Date;
  readonly criadoPor: string | null;
  readonly primeiroUsoEm: Date | null;
  readonly ultimoUsoEm: Date | null;
  readonly concluidoEm: Date | null;
  readonly nota: string | null;
  readonly conviteDeIntegracaoId: string | null;
};

export type EstadoDoBrainRegistrado = {
  readonly solicitadoEm: Date;
  readonly hashExportado: string | null;
  readonly exportadoEm: Date | null;
  readonly versaoDoEsquema: number | null;
  readonly ultimaTentativaEm: Date | null;
  readonly ultimoErro: string | null;
  readonly tentativas: number;
};

export type RevisaoRegistrada = {
  readonly id: string;
  readonly alvo: 'campo' | 'item';
  readonly secao: string;
  readonly chave: string;
  readonly itemId: string | null;
  readonly operacao: 'criar' | 'alterar' | 'status' | 'remover';
  readonly antes: Record<string, unknown> | null;
  readonly depois: Record<string, unknown> | null;
  readonly versao: number | null;
  readonly autorId: string | null;
  readonly linkId: string | null;
  readonly em: Date;
};

export type EscopoDoLink = {
  readonly linkId: string;
  readonly organizationId: string;
  readonly clientId: string;
  readonly nomeDaOrganizacao: string;
  readonly nomeDoCliente: string;
  readonly secoes: readonly string[];
  readonly expiraEm: Date;
  readonly concluidoEm: Date | null;
  readonly nota: string | null;
  readonly usoDeArquivosBytes: number;
};

export type VistoPeloLink = {
  readonly campos: readonly {
    readonly secao: SecaoKey;
    readonly fieldKey: string;
    readonly valor: unknown;
    readonly epistemico: Epistemico;
    readonly fonte: Fonte;
    readonly versao: number;
  }[];
  readonly itens: readonly {
    readonly id: string;
    readonly secao: SecaoKey;
    readonly listKey: string;
    readonly posicao: number;
    readonly dados: DadosDoItem;
    readonly epistemico: Epistemico;
    readonly fonte: Fonte;
    readonly versao: number;
  }[];
  readonly arquivos: readonly {
    readonly id: string;
    readonly secao: SecaoKey;
    readonly fieldKey: string;
    readonly itemId: string | null;
    readonly nome: string;
    readonly mime: string;
    readonly tamanhoBytes: number;
    readonly fonte: Fonte;
  }[];
};

export type ResultadoPeloLink = 'ok' | 'conflito' | 'recusado' | 'fora_do_escopo' | 'nao_encontrado' | 'limite' | 'cota_excedida';

export type NovoArquivo = {
  readonly id: string;
  readonly clientId: string;
  readonly secao: SecaoKey;
  readonly fieldKey: string;
  readonly itemId: string | null;
  readonly caminho: string;
  readonly nome: string;
  readonly mime: string;
  readonly tamanhoBytes: number;
  readonly sha256: string;
};

export type ContextoRepository = {
  carregar(organizationId: string, clientId: string): Promise<{ readonly nome: string; readonly contexto: ContextoBruto } | null>;
  lerEntrada(organizationId: string, clientId: string, fieldKey: string): Promise<EntradaDeCampo | null>;
  gravarEntrada(
    organizationId: string,
    input: {
      readonly clientId: string;
      readonly secao: SecaoKey;
      readonly fieldKey: string;
      readonly valor: unknown;
      readonly marcacao: Marcacao;
      readonly versaoEsperada: number;
      readonly autorId: string | null;
    },
  ): Promise<Gravado<EntradaDeCampo>>;
  apagarEntrada(
    organizationId: string,
    input: { readonly clientId: string; readonly fieldKey: string; readonly versaoEsperada: number },
  ): Promise<Gravado<null>>;
  lerItem(organizationId: string, clientId: string, itemId: string): Promise<ItemDeLista | null>;
  contarItens(organizationId: string, clientId: string, listKey: string): Promise<number>;
  inserirItem(
    organizationId: string,
    input: {
      readonly clientId: string;
      readonly secao: SecaoKey;
      readonly listKey: string;
      readonly dados: DadosDoItem;
      readonly marcacao: Marcacao;
      readonly autorId: string | null;
    },
  ): Promise<ItemDeLista>;
  alterarItem(
    organizationId: string,
    input: {
      readonly clientId: string;
      readonly itemId: string;
      readonly dados: DadosDoItem;
      readonly marcacao: Marcacao;
      readonly versaoEsperada: number;
      readonly autorId: string | null;
    },
  ): Promise<Gravado<ItemDeLista>>;
  removerItem(
    organizationId: string,
    input: { readonly clientId: string; readonly itemId: string; readonly versaoEsperada: number },
  ): Promise<Gravado<null>>;
  reordenar(
    organizationId: string,
    input: { readonly clientId: string; readonly listKey: string; readonly ordem: readonly string[]; readonly autorId: string | null },
  ): Promise<void>;
  listarRevisoes(
    organizationId: string,
    clientId: string,
    filtro: { readonly limite: number; readonly chave: string | null },
  ): Promise<readonly RevisaoRegistrada[]>;
  usoDeArquivos(organizationId: string, clientId: string): Promise<number>;
  registrarArquivo(
    organizationId: string,
    input: NovoArquivo & { readonly fonte: Fonte; readonly compartilhavel: boolean; readonly autorId: string | null },
  ): Promise<ArquivoDeContexto>;
  lerArquivo(organizationId: string, clientId: string, fileId: string): Promise<ArquivoDeContexto | null>;
  removerArquivo(organizationId: string, clientId: string, fileId: string): Promise<ArquivoDeContexto | null>;
  criarLink(
    organizationId: string,
    input: {
      readonly clientId: string;
      readonly tokenHash: string;
      readonly secoes: readonly SecaoKey[];
      readonly expiraEm: Date;
      readonly nota: string | null;
      readonly criadoPor: string | null;
      readonly conviteDeIntegracaoId: string | null;
    },
  ): Promise<LinkDeContexto>;
  listarLinks(organizationId: string, clientId: string): Promise<readonly LinkDeContexto[]>;
  lerLink(organizationId: string, clientId: string, linkId: string): Promise<LinkDeContexto | null>;
  revogarLink(organizationId: string, clientId: string, linkId: string): Promise<LinkDeContexto | null>;
  conviteDoCliente(organizationId: string, clientId: string, inviteId: string): Promise<{ readonly status: string } | null>;
  estadoDoBrain(organizationId: string, clientId: string): Promise<EstadoDoBrainRegistrado | null>;
  registrarTentativaDoBrain(
    organizationId: string,
    clientId: string,
    resultado:
      | { readonly ok: true; readonly hash: string; readonly versaoDoEsquema: number; readonly gravado: boolean }
      | { readonly ok: false; readonly erro: string },
  ): Promise<void>;
  brainsPendentes(limite: number, esperaSegundos: number): Promise<readonly { readonly organizationId: string; readonly clientId: string }[]>;
  abrirLink(tokenHash: string): Promise<EscopoDoLink | null>;
  lerPeloLink(tokenHash: string, campos: readonly string[]): Promise<VistoPeloLink | null>;
  salvarCampoPeloLink(
    tokenHash: string,
    input: {
      readonly secao: string;
      readonly fieldKey: string;
      readonly valor: unknown;
      readonly epistemico: Epistemico;
      readonly versaoEsperada: number;
    },
  ): Promise<{ readonly resultado: ResultadoPeloLink; readonly versao: number | null }>;
  salvarItemPeloLink(
    tokenHash: string,
    input: {
      readonly secao: string;
      readonly listKey: string;
      readonly itemId: string | null;
      readonly dados: DadosDoItem;
      readonly epistemico: Epistemico;
      readonly versaoEsperada: number;
    },
  ): Promise<{ readonly resultado: ResultadoPeloLink; readonly itemId: string | null; readonly versao: number | null }>;
  removerItemPeloLink(tokenHash: string, itemId: string, versaoEsperada: number): Promise<ResultadoPeloLink>;
  concluirPeloLink(tokenHash: string): Promise<Date | null>;
  registrarArquivoPeloLink(tokenHash: string, input: NovoArquivo & { readonly cotaBytes: number }): Promise<ResultadoPeloLink>;
  hashPeloConvite(inviteToken: string): Promise<string | null>;
};

type EntradaRow = {
  section: SecaoKey;
  field_key: string;
  value: unknown;
  epistemic: Epistemico;
  source: Fonte;
  review: Revisao;
  shareable: boolean;
  version: number;
  updated_at: Date;
  updated_by: string | null;
  updated_via_link: string | null;
};

type ItemRow = {
  id: string;
  section: SecaoKey;
  list_key: string;
  position: number;
  data: DadosDoItem;
  epistemic: Epistemico;
  source: Fonte;
  review: Revisao;
  shareable: boolean;
  version: number;
  updated_at: Date;
  updated_via_link: string | null;
};

type ArquivoRow = {
  id: string;
  section: SecaoKey;
  field_key: string;
  item_id: string | null;
  object_path: string;
  filename: string;
  mime: string;
  size_bytes: string | number;
  sha256: string;
  source: Fonte;
  shareable: boolean;
  created_at: Date;
};

type LinkRow = {
  id: string;
  client_id: string;
  sections: SecaoKey[];
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  created_by: string | null;
  first_used_at: Date | null;
  last_used_at: Date | null;
  submitted_at: Date | null;
  note: string | null;
  connection_invite_id: string | null;
};

const paraEntrada = (row: EntradaRow): EntradaDeCampo => ({
  secao: row.section,
  fieldKey: row.field_key,
  valor: row.value,
  epistemico: row.epistemic,
  fonte: row.source,
  revisao: row.review,
  compartilhavel: row.shareable,
  versao: row.version,
  atualizadoEm: row.updated_at,
  atualizadoPor: row.updated_by,
  viaLink: row.updated_via_link !== null,
});

const paraItem = (row: ItemRow): ItemDeLista => ({
  id: row.id,
  secao: row.section,
  listKey: row.list_key,
  posicao: row.position,
  dados: row.data,
  epistemico: row.epistemic,
  fonte: row.source,
  revisao: row.review,
  compartilhavel: row.shareable,
  versao: row.version,
  atualizadoEm: row.updated_at,
  viaLink: row.updated_via_link !== null,
});

const paraArquivo = (row: ArquivoRow): ArquivoDeContexto => ({
  id: row.id,
  secao: row.section,
  fieldKey: row.field_key,
  itemId: row.item_id,
  caminho: row.object_path,
  nome: row.filename,
  mime: row.mime,
  tamanhoBytes: Number(row.size_bytes),
  sha256: row.sha256,
  fonte: row.source,
  compartilhavel: row.shareable,
  criadoEm: row.created_at,
});

const paraLink = (row: LinkRow): LinkDeContexto => ({
  id: row.id,
  clientId: row.client_id,
  secoes: row.sections,
  expiraEm: row.expires_at,
  revogadoEm: row.revoked_at,
  criadoEm: row.created_at,
  criadoPor: row.created_by,
  primeiroUsoEm: row.first_used_at,
  ultimoUsoEm: row.last_used_at,
  concluidoEm: row.submitted_at,
  nota: row.note,
  conviteDeIntegracaoId: row.connection_invite_id,
});

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

async function versaoDaEntrada(tx: Tx, clientId: string, fieldKey: string): Promise<number> {
  const rows = (await tx`
    SELECT version FROM core.client_context_entries WHERE client_id = ${clientId} AND field_key = ${fieldKey}`) as unknown as {
    version: number;
  }[];
  return rows[0]?.version ?? 0;
}

async function versaoDoItem(tx: Tx, clientId: string, itemId: string): Promise<number | null> {
  const rows = (await tx`
    SELECT version FROM core.client_context_items WHERE client_id = ${clientId} AND id = ${itemId}`) as unknown as {
    version: number;
  }[];
  return rows[0]?.version ?? null;
}

function json(tx: Tx, valor: unknown) {
  return tx.json(valor as Parameters<Tx['json']>[0]);
}

export function createContextoRepository(): ContextoRepository {
  return {
    async carregar(organizationId, clientId) {
      return withTenant(organizationId, async (tx) => {
        const clientes = (await tx`SELECT name FROM core.clients WHERE id = ${clientId}`) as unknown as { name: string }[];
        if (!clientes[0]) return null;

        const [campos, itens, arquivos] = await Promise.all([
          tx`SELECT * FROM core.client_context_entries WHERE client_id = ${clientId} ORDER BY field_key`,
          tx`SELECT * FROM core.client_context_items WHERE client_id = ${clientId} ORDER BY list_key, position, id`,
          tx`SELECT * FROM core.client_context_files WHERE client_id = ${clientId} AND deleted_at IS NULL
             ORDER BY created_at, id`,
        ]);

        return {
          nome: clientes[0].name,
          contexto: {
            campos: (campos as unknown as EntradaRow[]).map(paraEntrada),
            itens: (itens as unknown as ItemRow[]).map(paraItem),
            arquivos: (arquivos as unknown as ArquivoRow[]).map(paraArquivo),
          },
        };
      });
    },

    async lerEntrada(organizationId, clientId, fieldKey) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.client_context_entries WHERE client_id = ${clientId} AND field_key = ${fieldKey}`) as unknown as EntradaRow[];
        return rows[0] ? paraEntrada(rows[0]) : null;
      });
    },

    async gravarEntrada(organizationId, input) {
      return withTenant(organizationId, async (tx) => {
        const m = input.marcacao;
        const rows =
          input.versaoEsperada === 0
            ? ((await tx`
                INSERT INTO core.client_context_entries
                  (organization_id, client_id, section, field_key, value, epistemic, source, review, shareable, updated_by)
                VALUES (${organizationId}, ${input.clientId}, ${input.secao}, ${input.fieldKey}, ${json(tx, input.valor)},
                        ${m.epistemico}, ${m.fonte}, ${m.revisao}, ${m.compartilhavel}, ${input.autorId})
                ON CONFLICT (client_id, field_key) DO NOTHING
                RETURNING *`) as unknown as EntradaRow[])
            : ((await tx`
                UPDATE core.client_context_entries
                   SET value = ${json(tx, input.valor)}, epistemic = ${m.epistemico}, source = ${m.fonte},
                       review = ${m.revisao}, shareable = ${m.compartilhavel}, version = version + 1,
                       updated_by = ${input.autorId}, updated_via_link = NULL
                 WHERE client_id = ${input.clientId} AND field_key = ${input.fieldKey} AND version = ${input.versaoEsperada}
                RETURNING *`) as unknown as EntradaRow[]);

        if (rows[0]) return { ok: true, valor: paraEntrada(rows[0]) };
        return { ok: false, versaoAtual: await versaoDaEntrada(tx, input.clientId, input.fieldKey) };
      });
    },

    async apagarEntrada(organizationId, input) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          DELETE FROM core.client_context_entries
           WHERE client_id = ${input.clientId} AND field_key = ${input.fieldKey} AND version = ${input.versaoEsperada}
          RETURNING id`) as unknown as { id: string }[];
        if (rows[0]) return { ok: true, valor: null };
        return { ok: false, versaoAtual: await versaoDaEntrada(tx, input.clientId, input.fieldKey) };
      });
    },

    async lerItem(organizationId, clientId, itemId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.client_context_items WHERE client_id = ${clientId} AND id = ${itemId}`) as unknown as ItemRow[];
        return rows[0] ? paraItem(rows[0]) : null;
      });
    },

    async contarItens(organizationId, clientId, listKey) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT count(*)::int AS total FROM core.client_context_items
           WHERE client_id = ${clientId} AND list_key = ${listKey}`) as unknown as { total: number }[];
        return rows[0]?.total ?? 0;
      });
    },

    async inserirItem(organizationId, input) {
      return withTenant(organizationId, async (tx) => {
        const m = input.marcacao;
        const rows = (await tx`
          INSERT INTO core.client_context_items
            (organization_id, client_id, section, list_key, position, data, epistemic, source, review, shareable, updated_by)
          VALUES (${organizationId}, ${input.clientId}, ${input.secao}, ${input.listKey},
                  coalesce((SELECT max(position) + 1 FROM core.client_context_items
                             WHERE client_id = ${input.clientId} AND list_key = ${input.listKey}), 0),
                  ${json(tx, input.dados)}, ${m.epistemico}, ${m.fonte}, ${m.revisao}, ${m.compartilhavel}, ${input.autorId})
          RETURNING *`) as unknown as ItemRow[];
        return paraItem(rows[0]!);
      });
    },

    async alterarItem(organizationId, input) {
      return withTenant(organizationId, async (tx) => {
        const m = input.marcacao;
        const rows = (await tx`
          UPDATE core.client_context_items
             SET data = ${json(tx, input.dados)}, epistemic = ${m.epistemico}, source = ${m.fonte}, review = ${m.revisao},
                 shareable = ${m.compartilhavel}, version = version + 1, updated_by = ${input.autorId},
                 updated_via_link = NULL
           WHERE client_id = ${input.clientId} AND id = ${input.itemId} AND version = ${input.versaoEsperada}
          RETURNING *`) as unknown as ItemRow[];
        if (rows[0]) return { ok: true, valor: paraItem(rows[0]) };
        return { ok: false, versaoAtual: await versaoDoItem(tx, input.clientId, input.itemId) };
      });
    },

    async removerItem(organizationId, input) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          DELETE FROM core.client_context_items
           WHERE client_id = ${input.clientId} AND id = ${input.itemId} AND version = ${input.versaoEsperada}
          RETURNING id`) as unknown as { id: string }[];
        if (rows[0]) return { ok: true, valor: null };
        return { ok: false, versaoAtual: await versaoDoItem(tx, input.clientId, input.itemId) };
      });
    },

    async reordenar(organizationId, input) {
      await withTenant(organizationId, async (tx) => {
        const posicoes = input.ordem.map((id, posicao) => ({ id, posicao }));
        await tx`
          UPDATE core.client_context_items i
             SET position = o.posicao, updated_by = ${input.autorId}
            FROM jsonb_to_recordset(${json(tx, posicoes)}) AS o(id uuid, posicao int)
           WHERE i.id = o.id AND i.client_id = ${input.clientId} AND i.list_key = ${input.listKey}`;
      });
    },

    async listarRevisoes(organizationId, clientId, filtro) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.client_context_revisions
           WHERE client_id = ${clientId} AND (${filtro.chave}::text IS NULL OR key = ${filtro.chave})
           ORDER BY occurred_at DESC, id
           LIMIT ${filtro.limite}`) as unknown as {
          id: string;
          target: 'campo' | 'item';
          section: string;
          key: string;
          item_id: string | null;
          operation: RevisaoRegistrada['operacao'];
          before: Record<string, unknown> | null;
          after: Record<string, unknown> | null;
          version: number | null;
          actor_user_id: string | null;
          via_link_id: string | null;
          occurred_at: Date;
        }[];
        return rows.map((row) => ({
          id: row.id,
          alvo: row.target,
          secao: row.section,
          chave: row.key,
          itemId: row.item_id,
          operacao: row.operation,
          antes: row.before,
          depois: row.after,
          versao: row.version,
          autorId: row.actor_user_id,
          linkId: row.via_link_id,
          em: row.occurred_at,
        }));
      });
    },

    async usoDeArquivos(organizationId, clientId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT coalesce(sum(size_bytes), 0)::bigint AS uso FROM core.client_context_files
           WHERE client_id = ${clientId} AND deleted_at IS NULL`) as unknown as { uso: string }[];
        return Number(rows[0]?.uso ?? 0);
      });
    },

    async registrarArquivo(organizationId, input) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          INSERT INTO core.client_context_files
            (id, organization_id, client_id, section, field_key, item_id, object_path, filename, mime, size_bytes,
             sha256, source, shareable, created_by)
          VALUES (${input.id}, ${organizationId}, ${input.clientId}, ${input.secao}, ${input.fieldKey}, ${input.itemId},
                  ${input.caminho}, ${input.nome}, ${input.mime}, ${input.tamanhoBytes}, ${input.sha256},
                  ${input.fonte}, ${input.compartilhavel}, ${input.autorId})
          RETURNING *`) as unknown as ArquivoRow[];
        return paraArquivo(rows[0]!);
      });
    },

    async lerArquivo(organizationId, clientId, fileId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.client_context_files
           WHERE client_id = ${clientId} AND id = ${fileId} AND deleted_at IS NULL`) as unknown as ArquivoRow[];
        return rows[0] ? paraArquivo(rows[0]) : null;
      });
    },

    async removerArquivo(organizationId, clientId, fileId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE core.client_context_files SET deleted_at = now()
           WHERE client_id = ${clientId} AND id = ${fileId} AND deleted_at IS NULL
          RETURNING *`) as unknown as ArquivoRow[];
        return rows[0] ? paraArquivo(rows[0]) : null;
      });
    },

    async criarLink(organizationId, input) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          INSERT INTO core.client_context_links
            (organization_id, client_id, token_hash, sections, expires_at, note, created_by, connection_invite_id)
          VALUES (${organizationId}, ${input.clientId}, ${input.tokenHash}, ${input.secoes as string[]}::text[],
                  ${input.expiraEm}, ${input.nota}, ${input.criadoPor}, ${input.conviteDeIntegracaoId})
          RETURNING *`) as unknown as LinkRow[];
        return paraLink(rows[0]!);
      });
    },

    async listarLinks(organizationId, clientId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.client_context_links WHERE client_id = ${clientId}
           ORDER BY created_at DESC`) as unknown as LinkRow[];
        return rows.map(paraLink);
      });
    },

    async lerLink(organizationId, clientId, linkId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.client_context_links WHERE client_id = ${clientId} AND id = ${linkId}`) as unknown as LinkRow[];
        return rows[0] ? paraLink(rows[0]) : null;
      });
    },

    async revogarLink(organizationId, clientId, linkId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          UPDATE core.client_context_links SET revoked_at = now()
           WHERE client_id = ${clientId} AND id = ${linkId} AND revoked_at IS NULL
          RETURNING *`) as unknown as LinkRow[];
        return rows[0] ? paraLink(rows[0]) : null;
      });
    },

    async conviteDoCliente(organizationId, clientId, inviteId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT status::text AS status FROM integrations.connection_invites
           WHERE id = ${inviteId} AND client_id = ${clientId}`) as unknown as { status: string }[];
        return rows[0] ?? null;
      });
    },

    async estadoDoBrain(organizationId, clientId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.client_context_brain WHERE client_id = ${clientId}`) as unknown as {
          requested_at: Date;
          exported_hash: string | null;
          exported_at: Date | null;
          schema_version: number | null;
          last_attempt_at: Date | null;
          last_error: string | null;
          attempts: number;
        }[];
        const row = rows[0];
        if (!row) return null;
        return {
          solicitadoEm: row.requested_at,
          hashExportado: row.exported_hash,
          exportadoEm: row.exported_at,
          versaoDoEsquema: row.schema_version,
          ultimaTentativaEm: row.last_attempt_at,
          ultimoErro: row.last_error,
          tentativas: row.attempts,
        };
      });
    },

    async registrarTentativaDoBrain(organizationId, clientId, resultado) {
      await withTenant(organizationId, async (tx) => {
        if (resultado.ok) {
          await tx`
            INSERT INTO core.client_context_brain
              (client_id, organization_id, exported_hash, exported_at, schema_version, last_attempt_at, attempts)
            VALUES (${clientId}, ${organizationId}, ${resultado.hash}, now(), ${resultado.versaoDoEsquema}, now(), 0)
            ON CONFLICT (client_id) DO UPDATE
              SET exported_hash = EXCLUDED.exported_hash,
                  exported_at = CASE WHEN ${resultado.gravado} THEN now() ELSE core.client_context_brain.exported_at END,
                  schema_version = EXCLUDED.schema_version, last_attempt_at = now(), last_error = NULL, attempts = 0`;
          return;
        }
        await tx`
          INSERT INTO core.client_context_brain (client_id, organization_id, last_attempt_at, last_error, attempts)
          VALUES (${clientId}, ${organizationId}, now(), ${resultado.erro.slice(0, 500)}, 1)
          ON CONFLICT (client_id) DO UPDATE
            SET last_attempt_at = now(), last_error = EXCLUDED.last_error,
                attempts = core.client_context_brain.attempts + 1`;
      });
    },

    async brainsPendentes(limite, esperaSegundos) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.contexto_brains_pendentes(${limite}, make_interval(secs => ${esperaSegundos}))`) as unknown as {
          organization_id: string;
          client_id: string;
        }[];
        return rows.map((row) => ({ organizationId: row.organization_id, clientId: row.client_id }));
      });
    },

    async abrirLink(tokenHash) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`SELECT * FROM core.contexto_link_abrir(${tokenHash})`) as unknown as {
          link_id: string;
          organization_id: string;
          client_id: string;
          organization_name: string;
          client_name: string;
          sections: string[];
          expires_at: Date;
          submitted_at: Date | null;
          note: string | null;
          uso_bytes: string | number;
        }[];
        const row = rows[0];
        if (!row) return null;
        return {
          linkId: row.link_id,
          organizationId: row.organization_id,
          clientId: row.client_id,
          nomeDaOrganizacao: row.organization_name,
          nomeDoCliente: row.client_name,
          secoes: row.sections,
          expiraEm: row.expires_at,
          concluidoEm: row.submitted_at,
          nota: row.note,
          usoDeArquivosBytes: Number(row.uso_bytes),
        };
      });
    },

    async lerPeloLink(tokenHash, campos) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT core.contexto_link_ler(${tokenHash}, ${campos as string[]}::text[]) AS visto`) as unknown as {
          visto: {
            campos: { section: SecaoKey; field_key: string; value: unknown; epistemic: Epistemico; source: Fonte; version: number }[];
            itens: {
              id: string;
              section: SecaoKey;
              list_key: string;
              position: number;
              data: DadosDoItem;
              epistemic: Epistemico;
              source: Fonte;
              version: number;
            }[];
            arquivos: {
              id: string;
              section: SecaoKey;
              field_key: string;
              item_id: string | null;
              filename: string;
              mime: string;
              size_bytes: number;
              source: Fonte;
            }[];
          } | null;
        }[];
        const visto = rows[0]?.visto;
        if (!visto) return null;
        return {
          campos: visto.campos.map((c) => ({
            secao: c.section,
            fieldKey: c.field_key,
            valor: c.value,
            epistemico: c.epistemic,
            fonte: c.source,
            versao: c.version,
          })),
          itens: visto.itens.map((i) => ({
            id: i.id,
            secao: i.section,
            listKey: i.list_key,
            posicao: i.position,
            dados: i.data,
            epistemico: i.epistemic,
            fonte: i.source,
            versao: i.version,
          })),
          arquivos: visto.arquivos.map((a) => ({
            id: a.id,
            secao: a.section,
            fieldKey: a.field_key,
            itemId: a.item_id,
            nome: a.filename,
            mime: a.mime,
            tamanhoBytes: Number(a.size_bytes),
            fonte: a.source,
          })),
        };
      });
    },

    async salvarCampoPeloLink(tokenHash, input) {
      return withoutTenant(async (tx) => {
        const valor = input.valor === null ? null : json(tx, input.valor);
        const rows = (await tx`
          SELECT * FROM core.contexto_link_salvar_campo(${tokenHash}, ${input.secao}, ${input.fieldKey}, ${valor}::jsonb,
                                                        ${input.epistemico}, ${input.versaoEsperada})`) as unknown as {
          resultado: ResultadoPeloLink;
          versao: number | null;
        }[];
        return rows[0] ?? { resultado: 'recusado', versao: null };
      });
    },

    async salvarItemPeloLink(tokenHash, input) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.contexto_link_salvar_item(${tokenHash}, ${input.secao}, ${input.listKey}, ${input.itemId},
                                                       ${json(tx, input.dados)}, ${input.epistemico}, ${input.versaoEsperada})`) as unknown as {
          resultado: ResultadoPeloLink;
          item_id: string | null;
          versao: number | null;
        }[];
        const row = rows[0];
        return row ? { resultado: row.resultado, itemId: row.item_id, versao: row.versao } : { resultado: 'recusado', itemId: null, versao: null };
      });
    },

    async removerItemPeloLink(tokenHash, itemId, versaoEsperada) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT core.contexto_link_remover_item(${tokenHash}, ${itemId}, ${versaoEsperada}) AS resultado`) as unknown as {
          resultado: ResultadoPeloLink;
        }[];
        return rows[0]?.resultado ?? 'recusado';
      });
    },

    async concluirPeloLink(tokenHash) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`SELECT core.contexto_link_concluir(${tokenHash}) AS em`) as unknown as { em: Date | null }[];
        return rows[0]?.em ?? null;
      });
    },

    async registrarArquivoPeloLink(tokenHash, input) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT core.contexto_link_registrar_arquivo(
            ${tokenHash}, ${input.id}, ${input.secao}, ${input.fieldKey}, ${input.itemId}, ${input.caminho},
            ${input.nome}, ${input.mime}, ${input.tamanhoBytes}, ${input.sha256}, ${input.cotaBytes}) AS resultado`) as unknown as {
          resultado: ResultadoPeloLink;
        }[];
        return rows[0]?.resultado ?? 'recusado';
      });
    },

    async hashPeloConvite(inviteToken) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`SELECT core.contexto_link_pelo_convite(${inviteToken}) AS hash`) as unknown as {
          hash: string | null;
        }[];
        return rows[0]?.hash ?? null;
      });
    },
  };
}
