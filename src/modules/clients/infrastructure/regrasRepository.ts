import { withTenant } from '@/shared/db/tenant';
import type {
  Categoria,
  Decisao,
  DefinicaoDeLimite,
  Forca,
  Natureza,
  Origem,
  Status,
  Unidade,
  Valor,
} from '@/modules/clients/domain/regras/index';

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

export type TipoDeEscopo = 'cliente' | 'plataforma';

export type DefinicaoDoBanco = DefinicaoDeLimite & { readonly tiposDeEscopo: readonly TipoDeEscopo[] };

export type TipoDeEventoDoApp = 'efetivada' | 'rejeitada' | 'revogada';

export type EventoDeDecisao = {
  readonly id: string;
  readonly decisaoId: string;
  readonly tipo: 'proposta' | 'efetivada' | 'rejeitada' | 'superada' | 'revogada' | 'redigida';
  readonly atorTipo: 'usuario' | 'agente' | 'sistema';
  readonly atorUsuarioId: string | null;
  readonly motivo: string | null;
  readonly sucessoraId: string | null;
  readonly requestId: string | null;
  readonly em: Date;
};

export type NovaDecisao = {
  readonly clienteId: string;
  readonly categoria: Categoria;
  readonly natureza: Natureza;
  readonly origem: Origem;
  readonly forca: Forca;
  readonly chave: string | null;
  readonly escopo: string;
  readonly titulo: string;
  readonly contexto: string | null;
  readonly texto: string | null;
  readonly valor: Valor | null;
  readonly vigenciaInicio: string | null;
  readonly vigenciaFimInclusivo: string | null;
  readonly status: 'proposta' | 'vigente';
  readonly supersedesId: string | null;
  readonly decididoPor: string | null;
  readonly emNomeDe: string | null;
  readonly evidencia: string | null;
  readonly semConfirmacaoDoAnunciante: boolean;
  readonly agentId: string | null;
  readonly agentRunId: string | null;
  readonly agentSetHash: string | null;
  readonly chaveDeIdempotencia: string | null;
  readonly definicaoChave: string | null;
  readonly definicaoVersao: number | null;
};

export type NovoEvento = {
  readonly clienteId: string;
  readonly decisaoId: string;
  readonly tipo: TipoDeEventoDoApp;
  readonly atorTipo: 'usuario' | 'agente';
  readonly atorUsuarioId: string | null;
  readonly motivo: string | null;
};

export type TetoDoAgente = 'execucao' | 'dia';

export type Gravacao<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly motivo: 'conflito'; readonly restricao: string | null }
  | { readonly ok: false; readonly motivo: 'teto'; readonly teto: TetoDoAgente };

export type TetosDoAgente = { readonly porExecucao: number; readonly porDia: number };

export type FiltrosDaLinhaDoTempo = {
  readonly categoria?: Categoria | null;
  readonly origem?: Origem | null;
  readonly status?: Status | null;
  readonly natureza?: Natureza | null;
  readonly cursor?: number | null;
  readonly limite: number;
};

export type PaginaDaLinhaDoTempo = {
  readonly itens: readonly Decisao[];
  readonly proximoCursor: number | null;
};

export type HistoricoDaChave = {
  readonly decisao: Decisao;
  readonly eventos: readonly EventoDeDecisao[];
};

export type ContagemDeProntidao = {
  readonly essenciaisFaltando: readonly { readonly chave: string; readonly nome: string }[];
  readonly vigentes: number;
  readonly propostasPendentes: number;
  readonly aRevisar: number;
};

export type ContagemDoAgente = {
  readonly naExecucao: number;
  readonly noPeriodo: number;
};

export type OpcoesDeDefinicoes = { readonly todasAsVersoes?: boolean };

export type RegrasRepository = {
  clienteVisivel(organizationId: string, clientId: string): Promise<boolean>;
  listarDefinicoes(organizationId: string, opcoes?: OpcoesDeDefinicoes): Promise<readonly DefinicaoDoBanco[]>;
  definicaoAtiva(organizationId: string, chave: string): Promise<DefinicaoDoBanco | null>;
  listarVigentes(organizationId: string, clientId: string): Promise<readonly Decisao[]>;
  linhaDoTempo(organizationId: string, clientId: string, filtros: FiltrosDaLinhaDoTempo): Promise<PaginaDaLinhaDoTempo>;
  historicoDaChave(
    organizationId: string,
    clientId: string,
    chave: string,
    escopo: string | null,
  ): Promise<readonly HistoricoDaChave[]>;
  listarPropostas(organizationId: string, clientId: string, origem?: Origem | null): Promise<readonly Decisao[]>;
  buscarPorId(organizationId: string, clientId: string, decisaoId: string): Promise<Decisao | null>;
  buscarPorNumero(organizationId: string, clientId: string, numero: number): Promise<Decisao | null>;
  vigenteDaChave(
    organizationId: string,
    clientId: string,
    natureza: Natureza,
    chave: string,
    escopo: string,
  ): Promise<Decisao | null>;
  buscarPorIdempotencia(
    organizationId: string,
    clientId: string,
    agentId: string,
    chaveDeIdempotencia: string,
  ): Promise<Decisao | null>;
  inserirDecisao(
    organizationId: string,
    nova: NovaDecisao,
    requestId: string,
    tetos?: TetosDoAgente,
  ): Promise<Gravacao<Decisao>>;
  inserirEvento(organizationId: string, evento: NovoEvento, requestId: string): Promise<Gravacao<Decisao>>;
  filaDeRevisao(organizationId: string, clientId: string): Promise<readonly Decisao[]>;
  contagemParaProntidao(organizationId: string, clientId: string): Promise<ContagemDeProntidao>;
  contarDoAgente(
    organizationId: string,
    clientId: string,
    agentRunId: string,
    desde: Date,
  ): Promise<ContagemDoAgente>;
};

type DecisaoRow = {
  id: string;
  client_id: string;
  number: number;
  category: Categoria;
  nature: Natureza;
  origin: Origem;
  strength: Forca;
  key: string | null;
  scope: string;
  title: string;
  context: string | null;
  body: string | null;
  value: { valor: string; unidade: Unidade } | null;
  valid_from_text: string | null;
  valid_until_text: string | null;
  status: Status;
  supersedes_id: string | null;
  decided_by: string | null;
  on_behalf_of: string | null;
  evidence: string | null;
  without_advertiser_confirmation: boolean;
  via_link_id: string | null;
  agent_id: string | null;
  agent_run_id: string | null;
  agent_set_hash: string | null;
  idempotency_key: string | null;
  definition_key: string | null;
  definition_version: number | null;
  review_flag: string | null;
  revocation_reason: string | null;
  created_at: Date;
};

type DefinicaoRow = {
  key: string;
  version: number;
  name: string;
  description: string | null;
  category: 'investimento' | 'eficiencia';
  measure: DefinicaoDeLimite['medida'];
  unit: Unidade;
  period: DefinicaoDeLimite['periodo'];
  direction: DefinicaoDeLimite['sentido'];
  min_value: string;
  max_value: string;
  scopes: TipoDeEscopo[];
  essential: boolean;
  active: boolean;
};

type EventoRow = {
  id: string;
  decision_id: string;
  type: EventoDeDecisao['tipo'];
  actor_kind: EventoDeDecisao['atorTipo'];
  actor_user_id: string | null;
  reason: string | null;
  successor_id: string | null;
  request_id: string | null;
  occurred_at: Date;
};

const COLUNAS_DA_DECISAO = `
  d.id, d.client_id, d.number, d.category, d.nature, d.origin, d.strength, d.key, d.scope, d.title, d.context,
  d.body, d.value, d.valid_from::text AS valid_from_text, d.valid_until::text AS valid_until_text, d.status,
  d.supersedes_id, d.decided_by, d.on_behalf_of, d.evidence, d.without_advertiser_confirmation, d.via_link_id,
  d.agent_id, d.agent_run_id, d.agent_set_hash, d.idempotency_key, d.definition_key, d.definition_version,
  d.review_flag, d.created_at,
  (SELECT e.reason FROM core.client_decision_events e
    WHERE e.decision_id = d.id AND e.type = 'revogada' ORDER BY e.occurred_at DESC LIMIT 1) AS revocation_reason`;

const UM_DIA_MS = 24 * 60 * 60 * 1000;

function dataDoBanco(texto: string): Date {
  return new Date(`${texto}T00:00:00.000Z`);
}

function valorDoBanco(valor: DecisaoRow['value']): Valor | null {
  if (!valor) return null;
  if (valor.unidade === 'brl_centavos') return { unidade: 'brl_centavos', centavos: valor.valor, moeda: 'BRL' };
  return { unidade: valor.unidade, decimal: valor.valor };
}

function valorParaOBanco(valor: Valor): { valor: string; unidade: Unidade } {
  return {
    valor: valor.unidade === 'brl_centavos' ? valor.centavos : valor.decimal,
    unidade: valor.unidade,
  };
}

function paraDecisao(row: DecisaoRow): Decisao {
  const inicio = row.valid_from_text ? dataDoBanco(row.valid_from_text) : row.created_at;
  const fim = row.valid_until_text ? new Date(dataDoBanco(row.valid_until_text).getTime() + UM_DIA_MS) : null;
  return {
    id: row.id,
    clienteId: row.client_id,
    numero: row.number,
    categoria: row.category,
    natureza: row.nature,
    origem: row.origin,
    forca: row.strength,
    chave: row.key,
    escopo: row.scope,
    titulo: row.title,
    contexto: row.context,
    texto: row.body,
    valor: valorDoBanco(row.value),
    vigenciaInicio: inicio,
    vigenciaFim: fim,
    status: row.status,
    supersedesId: row.supersedes_id,
    decididoPor: row.decided_by,
    emNomeDe: row.on_behalf_of,
    evidencia: row.evidence,
    semConfirmacaoDoAnunciante: row.without_advertiser_confirmation,
    viaLinkId: row.via_link_id,
    agentId: row.agent_id,
    agentRunId: row.agent_run_id,
    agentSetHash: row.agent_set_hash,
    chaveDeIdempotencia: row.idempotency_key,
    definicaoChave: row.definition_key,
    definicaoVersao: row.definition_version,
    revisarEConverterEmLimite: row.review_flag === 'revisar_e_converter_em_limite',
    motivoDaRevogacao: row.revocation_reason,
    criadoEm: row.created_at,
  };
}

function paraDefinicao(row: DefinicaoRow): DefinicaoDoBanco {
  return {
    key: row.key,
    version: row.version,
    nome: row.name,
    descricao: row.description ?? '',
    categoria: row.category,
    medida: row.measure,
    unidade: row.unit,
    periodo: row.period,
    sentido: row.direction,
    faixaMin: row.min_value,
    faixaMax: row.max_value,
    escoposAceitos: row.scopes.includes('cliente') ? ['cliente'] : [],
    tiposDeEscopo: row.scopes,
    essencial: row.essential,
    ativo: row.active,
  };
}

function paraEvento(row: EventoRow): EventoDeDecisao {
  return {
    id: row.id,
    decisaoId: row.decision_id,
    tipo: row.type,
    atorTipo: row.actor_kind,
    atorUsuarioId: row.actor_user_id,
    motivo: row.reason,
    sucessoraId: row.successor_id,
    requestId: row.request_id,
    em: row.occurred_at,
  };
}

const MENSAGENS_DE_CONFLITO = [/n[ãa]o est[áa] mais vigente/i, /transi[çc][ãa]o inv[áa]lida/i, /s[óo] decis[ãa]o vigente pode ser superada/i];

type ErroDoBanco = { code?: unknown; constraint_name?: unknown; message?: unknown };

export function ehConflitoDeDecisao(erro: unknown): boolean {
  const e = erro as ErroDoBanco | null;
  if (!e || typeof e !== 'object') return false;
  if (e.code === '23505') return true;
  if (e.code === '23514' && typeof e.message === 'string') {
    const mensagem = e.message;
    return MENSAGENS_DE_CONFLITO.some((padrao) => padrao.test(mensagem));
  }
  return false;
}

const TETOS_DO_BANCO: Readonly<Record<string, TetoDoAgente>> = { ORT01: 'execucao', ORT02: 'dia' };

function tetoDoErro(erro: unknown): TetoDoAgente | null {
  const codigo = (erro as ErroDoBanco | null)?.code;
  return typeof codigo === 'string' ? (TETOS_DO_BANCO[codigo] ?? null) : null;
}

function restricaoDoErro(erro: unknown): string | null {
  const nome = (erro as ErroDoBanco | null)?.constraint_name;
  return typeof nome === 'string' ? nome : null;
}

async function comConflito<T>(trabalho: () => Promise<T>): Promise<Gravacao<T>> {
  try {
    return { ok: true, valor: await trabalho() };
  } catch (erro) {
    if (ehConflitoDeDecisao(erro)) return { ok: false, motivo: 'conflito', restricao: restricaoDoErro(erro) };
    const teto = tetoDoErro(erro);
    if (teto) return { ok: false, motivo: 'teto', teto };
    throw erro;
  }
}

async function definirRequestId(tx: Tx, requestId: string): Promise<void> {
  await tx`SELECT set_config('app.request_id', ${requestId.slice(0, 120)}, true)`;
}

async function lerDecisao(tx: Tx, clientId: string, decisaoId: string): Promise<Decisao | null> {
  const rows = (await tx.unsafe(
    `SELECT ${COLUNAS_DA_DECISAO} FROM core.client_decisions d WHERE d.client_id = $1 AND d.id = $2`,
    [clientId, decisaoId],
  )) as unknown as DecisaoRow[];
  return rows[0] ? paraDecisao(rows[0]) : null;
}

async function lerDecisoes(tx: Tx, condicao: string, parametros: (string | number | null)[]): Promise<Decisao[]> {
  const rows = (await tx.unsafe(
    `SELECT ${COLUNAS_DA_DECISAO} FROM core.client_decisions d WHERE ${condicao}`,
    parametros,
  )) as unknown as DecisaoRow[];
  return rows.map(paraDecisao);
}

export function createRegrasRepository(): RegrasRepository {
  return {
    async clienteVisivel(organizationId, clientId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`SELECT 1 AS ok FROM core.clients WHERE id = ${clientId}`) as unknown as unknown[];
        return rows.length > 0;
      });
    },

    async listarDefinicoes(organizationId, opcoes = {}) {
      return withTenant(organizationId, async (tx) => {
        const rows = (opcoes.todasAsVersoes
          ? await tx`SELECT * FROM core.limit_definitions ORDER BY key, version`
          : await tx`
              SELECT DISTINCT ON (key) * FROM core.limit_definitions
               ORDER BY key, version DESC`) as unknown as DefinicaoRow[];
        const lista = rows.map(paraDefinicao);
        return opcoes.todasAsVersoes ? lista : lista.filter((definicao) => definicao.ativo);
      });
    },

    async definicaoAtiva(organizationId, chave) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT * FROM core.limit_definitions WHERE key = ${chave} ORDER BY version DESC LIMIT 1`) as unknown as DefinicaoRow[];
        const definicao = rows[0] ? paraDefinicao(rows[0]) : null;
        return definicao && definicao.ativo ? definicao : null;
      });
    },

    async listarVigentes(organizationId, clientId) {
      return withTenant(organizationId, (tx) =>
        lerDecisoes(tx, `d.client_id = $1 AND d.status = 'vigente' ORDER BY d.number`, [clientId]),
      );
    },

    async linhaDoTempo(organizationId, clientId, filtros) {
      return withTenant(organizationId, async (tx) => {
        const itens = await lerDecisoes(
          tx,
          `d.client_id = $1
           AND ($2::text IS NULL OR d.category = $2)
           AND ($3::text IS NULL OR d.origin = $3)
           AND ($4::text IS NULL OR d.status = $4)
           AND ($5::text IS NULL OR d.nature = $5)
           AND ($6::int IS NULL OR d.number < $6)
           ORDER BY d.number DESC LIMIT $7`,
          [
            clientId,
            filtros.categoria ?? null,
            filtros.origem ?? null,
            filtros.status ?? null,
            filtros.natureza ?? null,
            filtros.cursor ?? null,
            filtros.limite + 1,
          ],
        );
        const pagina = itens.slice(0, filtros.limite);
        const ultima = pagina[pagina.length - 1];
        return { itens: pagina, proximoCursor: itens.length > filtros.limite && ultima ? ultima.numero : null };
      });
    },

    async historicoDaChave(organizationId, clientId, chave, escopo) {
      return withTenant(organizationId, async (tx) => {
        const decisoes = await lerDecisoes(
          tx,
          `d.client_id = $1 AND d.key = $2 AND ($3::text IS NULL OR d.scope = $3) ORDER BY d.number DESC LIMIT 200`,
          [clientId, chave, escopo],
        );
        if (decisoes.length === 0) return [];
        const ids = decisoes.map((decisao) => decisao.id);
        const eventos = (await tx`
          SELECT id, decision_id, type, actor_kind, actor_user_id, reason, successor_id, request_id, occurred_at
            FROM core.client_decision_events
           WHERE client_id = ${clientId} AND decision_id = ANY(${ids}::uuid[])
           ORDER BY occurred_at, id`) as unknown as EventoRow[];
        return decisoes.map((decisao) => ({
          decisao,
          eventos: eventos.filter((evento) => evento.decision_id === decisao.id).map(paraEvento),
        }));
      });
    },

    async listarPropostas(organizationId, clientId, origem = null) {
      return withTenant(organizationId, (tx) =>
        lerDecisoes(
          tx,
          `d.client_id = $1 AND d.status = 'proposta' AND ($2::text IS NULL OR d.origin = $2) ORDER BY d.number DESC LIMIT 200`,
          [clientId, origem],
        ),
      );
    },

    async buscarPorId(organizationId, clientId, decisaoId) {
      return withTenant(organizationId, (tx) => lerDecisao(tx, clientId, decisaoId));
    },

    async buscarPorNumero(organizationId, clientId, numero) {
      return withTenant(organizationId, async (tx) => {
        const lista = await lerDecisoes(tx, `d.client_id = $1 AND d.number = $2`, [clientId, numero]);
        return lista[0] ?? null;
      });
    },

    async vigenteDaChave(organizationId, clientId, natureza, chave, escopo) {
      return withTenant(organizationId, async (tx) => {
        const lista = await lerDecisoes(
          tx,
          `d.client_id = $1 AND d.nature = $2 AND d.key = $3 AND d.scope = $4 AND d.status = 'vigente' LIMIT 1`,
          [clientId, natureza, chave, escopo],
        );
        return lista[0] ?? null;
      });
    },

    async buscarPorIdempotencia(organizationId, clientId, agentId, chaveDeIdempotencia) {
      return withTenant(organizationId, async (tx) => {
        const lista = await lerDecisoes(
          tx,
          `d.client_id = $1 AND d.agent_id = $2 AND d.idempotency_key = $3 LIMIT 1`,
          [clientId, agentId, chaveDeIdempotencia],
        );
        return lista[0] ?? null;
      });
    },

    async inserirDecisao(organizationId, nova, requestId, tetos) {
      return comConflito(() =>
        withTenant(organizationId, async (tx) => {
          await definirRequestId(tx, requestId);
          if (tetos) {
            await tx`SELECT set_config('orla.teto_agente_por_execucao', ${String(tetos.porExecucao)}, true),
                            set_config('orla.teto_agente_por_dia', ${String(tetos.porDia)}, true)`;
          }
          const valor = nova.valor ? tx.json(valorParaOBanco(nova.valor)) : null;
          const rows = (await tx`
            INSERT INTO core.client_decisions
              (organization_id, client_id, category, nature, origin, strength, key, scope, title, context, body, value,
               valid_from, valid_until, status, supersedes_id, decided_by, on_behalf_of, evidence,
               without_advertiser_confirmation, agent_id, agent_run_id, agent_set_hash, idempotency_key,
               definition_key, definition_version)
            VALUES
              (${organizationId}, ${nova.clienteId}, ${nova.categoria}, ${nova.natureza}, ${nova.origem}, ${nova.forca},
               ${nova.chave}, ${nova.escopo}, ${nova.titulo}, ${nova.contexto}, ${nova.texto}, ${valor},
               ${nova.vigenciaInicio}::date, ${nova.vigenciaFimInclusivo}::date, ${nova.status}, ${nova.supersedesId},
               ${nova.decididoPor}, ${nova.emNomeDe}, ${nova.evidencia}, ${nova.semConfirmacaoDoAnunciante},
               ${nova.agentId}, ${nova.agentRunId}, ${nova.agentSetHash}, ${nova.chaveDeIdempotencia},
               ${nova.definicaoChave}, ${nova.definicaoVersao})
            RETURNING id`) as unknown as { id: string }[];
          const gravada = await lerDecisao(tx, nova.clienteId, rows[0]!.id);
          if (!gravada) throw new Error('decisao gravada nao encontrada');
          return gravada;
        }),
      );
    },

    async inserirEvento(organizationId, evento, requestId) {
      return comConflito(() =>
        withTenant(organizationId, async (tx) => {
          await definirRequestId(tx, requestId);
          await tx`
            INSERT INTO core.client_decision_events
              (organization_id, client_id, decision_id, type, actor_kind, actor_user_id, reason, request_id)
            VALUES
              (${organizationId}, ${evento.clienteId}, ${evento.decisaoId}, ${evento.tipo}, ${evento.atorTipo},
               ${evento.atorUsuarioId}, ${evento.motivo}, ${requestId.slice(0, 120)})`;
          const atualizada = await lerDecisao(tx, evento.clienteId, evento.decisaoId);
          if (!atualizada) throw new Error('decisao nao encontrada apos o evento');
          return atualizada;
        }),
      );
    },

    async filaDeRevisao(organizationId, clientId) {
      return withTenant(organizationId, (tx) =>
        lerDecisoes(
          tx,
          `d.client_id = $1 AND d.review_flag IS NOT NULL AND d.status = 'vigente' ORDER BY d.number DESC LIMIT 200`,
          [clientId],
        ),
      );
    },

    async contagemParaProntidao(organizationId, clientId) {
      return withTenant(organizationId, async (tx) => {
        const faltando = (await tx`
          SELECT l.key, l.name
            FROM (SELECT DISTINCT ON (key) * FROM core.limit_definitions ORDER BY key, version DESC) l
           WHERE l.active AND l.essential
             AND NOT EXISTS (
               SELECT 1 FROM core.client_decisions d
                WHERE d.client_id = ${clientId} AND d.nature = 'limite' AND d.key = l.key AND d.status = 'vigente')
           ORDER BY l.key`) as unknown as { key: string; name: string }[];
        const totais = (await tx`
          SELECT count(*) FILTER (WHERE status = 'vigente')::int AS vigentes,
                 count(*) FILTER (WHERE status = 'proposta')::int AS propostas,
                 count(*) FILTER (WHERE status = 'vigente' AND review_flag IS NOT NULL)::int AS a_revisar
            FROM core.client_decisions WHERE client_id = ${clientId}`) as unknown as {
          vigentes: number;
          propostas: number;
          a_revisar: number;
        }[];
        return {
          essenciaisFaltando: faltando.map((linha) => ({ chave: linha.key, nome: linha.name })),
          vigentes: totais[0]?.vigentes ?? 0,
          propostasPendentes: totais[0]?.propostas ?? 0,
          aRevisar: totais[0]?.a_revisar ?? 0,
        };
      });
    },

    async contarDoAgente(organizationId, clientId, agentRunId, desde) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT count(*) FILTER (WHERE agent_run_id = ${agentRunId})::int AS na_execucao,
                 count(*) FILTER (WHERE created_at >= ${desde})::int AS no_periodo
            FROM core.client_decisions
           WHERE client_id = ${clientId} AND origin = 'agente'`) as unknown as { na_execucao: number; no_periodo: number }[];
        return { naExecucao: rows[0]?.na_execucao ?? 0, noPeriodo: rows[0]?.no_periodo ?? 0 };
      });
    },
  };
}
