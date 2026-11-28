import { withTenant, withoutTenant } from '@/shared/db/tenant';
import { err, ok, type Result } from '@/shared/result/result';
import type {
  ErroDeEstrategia,
  EventoDaVersao,
  Execucao,
  MudancaDaExecucao,
  NovaExecucao,
  NovaVersao,
  NovoEvento,
  OpcoesDeReserva,
  PedidoDaExecucao,
  Plano,
  PlanoDoCliente,
  ReferenciaDaVersao,
  RepositorioDeEstrategia,
  Versao,
  VersaoResumo,
} from '@/modules/strategy/application/portas';
import { CHAVE_DE_IDEMPOTENCIA_COM_OUTRO_PEDIDO, mesmoPedidoDePlano } from '@/modules/strategy/application/portas';
import type { FocoDoPlano, Plataforma } from '@/modules/strategy/domain/index';
import { PAPEL_NO_BANCO } from '@/modules/strategy/domain/referencias';
import { traduzirErroDoBanco } from '@/modules/strategy/infrastructure/errosDoBanco';

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
type Json = Parameters<Tx['json']>[0];

type PlanoRow = {
  id: string;
  organization_id: string;
  client_id: string;
  plan_type_key: string;
  plataformas: Plataforma[] | null;
  whatsapp: string | null;
  landing_page_id: string | null;
  foco: FocoDoPlano | null;
  created_at: Date;
};

const colunasDoPlano = (tx: Tx) => tx`id, organization_id, client_id, plan_type_key, plataformas, whatsapp, landing_page_id, foco, created_at`;

type VersaoRow = {
  id: string;
  plan_id: string;
  organization_id: string;
  client_id: string;
  status: VersaoResumo['status'];
  schema_version: number;
  supersedes_id: string | null;
  author_kind: 'usuario' | 'agente';
  author_user_id: string | null;
  agent_id: string | null;
  agent_run_id: string | null;
  redacted_at: Date | null;
  created_at: Date;
};

type VersaoComConteudoRow = VersaoRow & { content: unknown };
type RefRow = { urn: string; content_hash: string; role: 'evidencia_favor' | 'evidencia_contra' | 'premissa' };

type EventoRow = {
  id: string;
  version_id: string;
  kind: EventoDaVersao['tipo'];
  actor_kind: EventoDaVersao['atorTipo'];
  actor_user_id: string | null;
  agent_id: string | null;
  agent_run_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
};

type ExecucaoRow = {
  id: string;
  plan_id: string;
  organization_id: string;
  client_id: string;
  kind: Execucao['tipo'];
  pedido: Record<string, unknown>;
  base_version_id: string | null;
  status: Execucao['status'];
  etapa: Execucao['etapa'];
  rodada: number;
  tentativas: number;
  falhas: number;
  erro_codigo: Execucao['erroCodigo'];
  agent_run_id: string;
  requested_by: string | null;
  requested_kind: 'usuario' | 'sistema';
  lease_until: Date | null;
  created_at: Date;
  updated_at: Date;
};

const colunasDaVersao = (tx: Tx) =>
  tx`id, plan_id, organization_id, client_id, status, schema_version, supersedes_id, author_kind, author_user_id, agent_id, agent_run_id, redacted_at, created_at`;

const colunasDaExecucao = (tx: Tx) =>
  tx`id, plan_id, organization_id, client_id, kind, pedido, base_version_id, status, etapa, rodada, tentativas, falhas, erro_codigo, agent_run_id, requested_by, requested_kind, lease_until, created_at, updated_at`;

const colunasDoEvento = (tx: Tx) => tx`id, version_id, kind, actor_kind, actor_user_id, agent_id, agent_run_id, payload, created_at`;

const PAPEL_DO_BANCO_PARA_O_DOMINIO: Readonly<Record<RefRow['role'], ReferenciaDaVersao['papel']>> = Object.fromEntries(
  Object.entries(PAPEL_NO_BANCO).map(([dominio, banco]) => [banco, dominio]),
) as Record<RefRow['role'], ReferenciaDaVersao['papel']>;

const LIMITE_DE_REQUEST_ID = 120;

export function pedidoParaOBanco(pedido: PedidoDaExecucao): Record<string, unknown> {
  if (pedido.tipo === 'criar') return { ...pedido.intencao };
  if (pedido.tipo === 'ajustar') return { instrucao: pedido.instrucao };
  if (pedido.tipo === 'corrigir_gate') return {};
  return { motivo: pedido.motivo };
}

function paraPlano(row: PlanoRow): Plano {
  return {
    id: row.id,
    organizationId: row.organization_id,
    clientId: row.client_id,
    tipo: row.plan_type_key,
    plataformas: row.plataformas,
    whatsapp: row.whatsapp,
    landingPageId: row.landing_page_id,
    foco: row.foco ?? null,
    criadoEm: row.created_at,
  };
}

function paraVersaoResumo(row: VersaoRow): VersaoResumo {
  return {
    id: row.id,
    planoId: row.plan_id,
    organizationId: row.organization_id,
    clientId: row.client_id,
    status: row.status,
    schemaVersion: row.schema_version,
    supersedesId: row.supersedes_id,
    autorTipo: row.author_kind,
    autorUsuarioId: row.author_user_id,
    agentId: row.agent_id,
    agentRunId: row.agent_run_id,
    redigidaEm: row.redacted_at,
    criadaEm: row.created_at,
  };
}

function paraEvento(row: EventoRow): EventoDaVersao {
  return {
    id: row.id,
    versaoId: row.version_id,
    tipo: row.kind,
    atorTipo: row.actor_kind,
    atorUsuarioId: row.actor_user_id,
    agentId: row.agent_id,
    agentRunId: row.agent_run_id,
    payload: row.payload,
    criadoEm: row.created_at,
  };
}

function paraExecucao(row: ExecucaoRow): Execucao {
  return {
    id: row.id,
    planoId: row.plan_id,
    organizationId: row.organization_id,
    clientId: row.client_id,
    tipo: row.kind,
    pedido: row.pedido,
    versaoBaseId: row.base_version_id,
    status: row.status,
    etapa: row.etapa,
    rodada: row.rodada,
    tentativas: row.tentativas,
    falhas: row.falhas,
    erroCodigo: row.erro_codigo,
    agentRunId: row.agent_run_id,
    solicitadoPor: row.requested_by,
    solicitadoTipo: row.requested_kind,
    leaseAte: row.lease_until,
    criadaEm: row.created_at,
    atualizadaEm: row.updated_at,
  };
}

async function definirRequestId(tx: Tx, requestId: string): Promise<void> {
  await tx`SELECT set_config('app.request_id', ${requestId.slice(0, LIMITE_DE_REQUEST_ID)}, true)`;
}

async function comTraducao<T>(trabalho: () => Promise<T>): Promise<Result<T, ErroDeEstrategia>> {
  try {
    return ok(await trabalho());
  } catch (erro) {
    const traduzido = traduzirErroDoBanco(erro);
    if (traduzido === null) throw erro;
    return err(traduzido);
  }
}

const PLANO_DA_CHAVE_NAO_ENCONTRADO: ErroDeEstrategia = { codigo: 'nao_encontrado', mensagem: 'O plano desta chave de idempotência não está acessível.' };

class NaoEncontrado extends Error {
  constructor() {
    super('nao_encontrado');
  }
}

class ExecucaoPerdidaNoBanco extends Error {
  constructor() {
    super('execucao_perdida');
  }
}

async function comTraducaoOuAusencia<T>(trabalho: () => Promise<T>): Promise<Result<T, ErroDeEstrategia>> {
  try {
    return ok(await trabalho());
  } catch (erro) {
    if (erro instanceof NaoEncontrado) return err({ codigo: 'nao_encontrado', mensagem: 'Registro não encontrado.' });
    if (erro instanceof ExecucaoPerdidaNoBanco) return err({ codigo: 'execucao_perdida', mensagem: 'A execução não é mais deste worker.' });
    const traduzido = traduzirErroDoBanco(erro);
    if (traduzido === null) throw erro;
    return err(traduzido);
  }
}

async function lerReferencias(tx: Tx, versaoId: string): Promise<ReferenciaDaVersao[]> {
  const rows = (await tx`
    SELECT urn, content_hash, role FROM core.strategy_plan_refs WHERE version_id = ${versaoId} ORDER BY urn, role
  `) as unknown as RefRow[];
  return rows.map((row) => ({ urn: row.urn, hash: row.content_hash, papel: PAPEL_DO_BANCO_PARA_O_DOMINIO[row.role] }));
}

async function lerVersaoNaTx(tx: Tx, organizationId: string, versaoId: string): Promise<Versao | null> {
  const rows = (await tx`
    SELECT ${colunasDaVersao(tx)}, content FROM core.strategy_plan_versions v
     WHERE id = ${versaoId} AND organization_id = ${organizationId}
       AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = v.plan_id AND p.removido_em IS NULL)
  `) as unknown as VersaoComConteudoRow[];
  const row = rows[0];
  if (!row) return null;
  return { ...paraVersaoResumo(row), conteudo: row.content, referencias: await lerReferencias(tx, versaoId) };
}

async function lerExecucaoNaTx(tx: Tx, organizationId: string, execucaoId: string): Promise<Execucao | null> {
  const rows = (await tx`
    SELECT ${colunasDaExecucao(tx)} FROM core.strategy_plan_runs r
     WHERE id = ${execucaoId} AND organization_id = ${organizationId}
       AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = r.plan_id AND p.removido_em IS NULL)
  `) as unknown as ExecucaoRow[];
  return rows[0] ? paraExecucao(rows[0]) : null;
}

const COLUNAS_DE_MUDANCA: Readonly<Record<keyof MudancaDaExecucao, string>> = {
  status: 'status',
  etapa: 'etapa',
  rodada: 'rodada',
  tentativas: 'tentativas',
  falhas: 'falhas',
  erroCodigo: 'erro_codigo',
  leaseAte: 'lease_until',
};

async function reservar(tx: Tx, execucaoId: string, opcoes: OpcoesDeReserva): Promise<Execucao | null> {
  const rows = (await tx`
    UPDATE core.strategy_plan_runs
       SET status = 'rodando', tentativas = tentativas + 1, lease_until = now() + ${opcoes.leaseMs}::int * interval '1 millisecond'
     WHERE id = ${execucaoId}
    RETURNING ${colunasDaExecucao(tx)}
  `) as unknown as ExecucaoRow[];
  if (!rows[0] || rows[0].status === 'falhou') return null;
  return paraExecucao(rows[0]);
}

async function definirFicha(tx: Tx, autoria: NovaVersao['autoria']): Promise<void> {
  if (autoria.tipo !== 'agente') return;
  await tx`SELECT set_config('orla.ficha_execucao', ${String(autoria.ficha)}, true)`;
}

async function inserirEvento(tx: Tx, organizationId: string, novo: NovoEvento): Promise<EventoDaVersao> {
  await definirFicha(tx, novo.autoria);
  const agente = novo.autoria.tipo === 'agente' ? novo.autoria : null;
  const usuario = novo.autoria.tipo === 'pessoa' ? novo.autoria.userId : null;
  const rows = (await tx`
    INSERT INTO core.strategy_plan_events
      (organization_id, client_id, version_id, kind, actor_kind, actor_user_id, payload,
       agent_id, agent_run_id, idempotency_key, request_id)
    SELECT v.organization_id, v.client_id, v.id, ${novo.tipo}::text, ${agente ? 'agente' : 'usuario'}::text, ${usuario}::uuid,
           ${tx.json(novo.payload as Json)}, ${agente?.agentId ?? null}::text, ${agente?.agentRunId ?? null}::text,
           ${agente?.chaveDeIdempotencia ?? null}::text, ${novo.requestId.slice(0, LIMITE_DE_REQUEST_ID)}::text
      FROM core.strategy_plan_versions v
     WHERE v.id = ${novo.versaoId} AND v.organization_id = ${organizationId}
       AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = v.plan_id AND p.removido_em IS NULL)
    RETURNING ${colunasDoEvento(tx)}
  `) as unknown as EventoRow[];
  if (!rows[0]) throw new NaoEncontrado();
  return paraEvento(rows[0]);
}

async function travarPlanoAtivo(tx: Tx, organizationId: string, planoId: string): Promise<void> {
  const rows = (await tx`
    SELECT 1 AS ok FROM core.strategy_plans WHERE id = ${planoId}::uuid AND organization_id = ${organizationId}::uuid AND removido_em IS NULL FOR SHARE
  `) as unknown as unknown[];
  if (rows.length === 0) throw new NaoEncontrado();
}

async function inserirVersao(tx: Tx, organizationId: string, nova: NovaVersao): Promise<Versao> {
  await travarPlanoAtivo(tx, organizationId, nova.planoId);
  await definirFicha(tx, nova.autoria);
  const agente = nova.autoria.tipo === 'agente' ? nova.autoria : null;
  const usuario = nova.autoria.tipo === 'pessoa' ? nova.autoria.userId : null;
  const rows = (await tx`
      INSERT INTO core.strategy_plan_versions
        (organization_id, client_id, plan_id, content, schema_version, supersedes_id, author_kind,
         author_user_id, agent_id, agent_run_id, idempotency_key)
      SELECT p.organization_id, p.client_id, p.id, ${tx.json(nova.conteudo as Json)}, ${nova.schemaVersion}::int,
             ${nova.supersedesId}::uuid, ${agente ? 'agente' : 'usuario'}::text, ${usuario}::uuid,
             ${agente?.agentId ?? null}::text, ${agente?.agentRunId ?? null}::text, ${agente?.chaveDeIdempotencia ?? null}::text
        FROM core.strategy_plans p
       WHERE p.id = ${nova.planoId} AND p.organization_id = ${organizationId} AND p.removido_em IS NULL
      RETURNING id, organization_id, client_id
    `) as unknown as { id: string; organization_id: string; client_id: string }[];
  const criada = rows[0];
  if (!criada) throw new NaoEncontrado();
  if (nova.referencias.length > 0) {
    const linhas = nova.referencias.map((ref) => ({
      organization_id: criada.organization_id,
      client_id: criada.client_id,
      version_id: criada.id,
      urn: ref.urn,
      content_hash: ref.hash,
      role: PAPEL_NO_BANCO[ref.papel],
    }));
    await tx`INSERT INTO core.strategy_plan_refs ${tx(linhas, 'organization_id', 'client_id', 'version_id', 'urn', 'content_hash', 'role')}`;
  }
  for (const inicial of nova.eventosIniciais ?? []) {
    await inserirEvento(tx, organizationId, { ...inicial, versaoId: criada.id, requestId: nova.requestId });
  }
  const gravada = await lerVersaoNaTx(tx, organizationId, criada.id);
  if (!gravada) throw new Error('versao gravada nao encontrada');
  return gravada;
}

async function inserirExecucao(tx: Tx, organizationId: string, clientId: string, nova: NovaExecucao): Promise<Execucao> {
  await travarPlanoAtivo(tx, organizationId, nova.planoId);
  const rows = (await tx`
    INSERT INTO core.strategy_plan_runs
      (organization_id, client_id, plan_id, kind, pedido, base_version_id, agent_run_id, requested_by, requested_kind)
    SELECT p.organization_id, p.client_id, p.id, ${nova.pedido.tipo}::text, ${tx.json(pedidoParaOBanco(nova.pedido) as Json)},
           ${nova.versaoBaseId}::uuid, ${nova.agentRunId}::text, ${nova.solicitadoPor}::uuid, 'usuario'
      FROM core.strategy_plans p
     WHERE p.id = ${nova.planoId}::uuid AND p.organization_id = ${organizationId}::uuid AND p.client_id = ${clientId}::uuid AND p.removido_em IS NULL
    RETURNING ${colunasDaExecucao(tx)}
  `) as unknown as ExecucaoRow[];
  if (!rows[0]) throw new NaoEncontrado();
  return paraExecucao(rows[0]);
}

async function estadosDosPlanos(tx: Tx, organizationId: string, clientId: string | null, planoId: string | null): Promise<PlanoDoCliente[]> {
  const porCliente = clientId === null ? tx`` : tx`AND client_id = ${clientId}`;
  const porPlano = planoId === null ? tx`` : tx`AND id = ${planoId}`;
  const planos = (await tx`
    SELECT ${colunasDoPlano(tx)}
      FROM core.strategy_plans
     WHERE organization_id = ${organizationId} AND removido_em IS NULL ${porCliente} ${porPlano}
     ORDER BY created_at DESC, id DESC
  `) as unknown as PlanoRow[];
  if (planos.length === 0) return [];
  const ids = planos.map((plano) => plano.id);
  const versoes = (await tx`
    SELECT ${colunasDaVersao(tx)}
      FROM core.strategy_plan_versions
     WHERE organization_id = ${organizationId} AND plan_id IN ${tx(ids)}
     ORDER BY created_at DESC, id DESC
  `) as unknown as VersaoRow[];
  const ultimas = (await tx`
    SELECT DISTINCT ON (plan_id) ${colunasDaExecucao(tx)}
      FROM core.strategy_plan_runs
     WHERE organization_id = ${organizationId} AND plan_id IN ${tx(ids)}
     ORDER BY plan_id, created_at DESC, id DESC
  `) as unknown as ExecucaoRow[];
  const objetivos = (await tx`
    SELECT DISTINCT ON (plan_id) plan_id, pedido->>'objetivo' AS objetivo
      FROM core.strategy_plan_runs
     WHERE organization_id = ${organizationId} AND plan_id IN ${tx(ids)} AND kind = 'criar'
     ORDER BY plan_id, created_at, id
  `) as unknown as { plan_id: string; objetivo: string | null }[];
  return planos.map((plano): PlanoDoCliente => {
    const doPlano = versoes.filter((v) => v.plan_id === plano.id);
    const recente = doPlano[0];
    const vigente = doPlano.find((v) => v.status === 'vigente');
    const aberta = doPlano.find((v) => v.status === 'rascunho' || v.status === 'proposto');
    const ultima = ultimas.find((e) => e.plan_id === plano.id);
    const datas = [plano.created_at, recente?.created_at, ultima?.updated_at].filter((data): data is Date => data instanceof Date);
    return {
      plano: paraPlano(plano),
      maisRecente: recente ? paraVersaoResumo(recente) : null,
      vigente: vigente ? paraVersaoResumo(vigente) : null,
      aberta: aberta ? paraVersaoResumo(aberta) : null,
      objetivo: objetivos.find((o) => o.plan_id === plano.id)?.objetivo ?? null,
      ultimaExecucao: ultima ? paraExecucao(ultima) : null,
      atualizadoEm: new Date(Math.max(...datas.map((data) => data.getTime()))),
    };
  });
}

export function createEstrategiaRepository(): RepositorioDeEstrategia {
  return {
    async clienteVisivel(organizationId, clientId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT 1 AS ok FROM core.clients WHERE id = ${clientId} AND organization_id = ${organizationId} LIMIT 1
        `) as unknown as unknown[];
        return rows.length > 0;
      });
    },

    async buscarPlanoPorId(organizationId, planoId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT ${colunasDoPlano(tx)}
            FROM core.strategy_plans WHERE id = ${planoId} AND organization_id = ${organizationId} AND removido_em IS NULL
        `) as unknown as PlanoRow[];
        return rows[0] ? paraPlano(rows[0]) : null;
      });
    },

    async clienteDoRecurso(organizationId, tipo, id) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await (tipo === 'plano'
          ? tx`SELECT client_id FROM core.strategy_plans WHERE id = ${id} AND organization_id = ${organizationId} AND removido_em IS NULL`
          : tipo === 'versao'
            ? tx`SELECT v.client_id FROM core.strategy_plan_versions v JOIN core.strategy_plans p ON p.id = v.plan_id
                  WHERE v.id = ${id} AND v.organization_id = ${organizationId} AND p.removido_em IS NULL`
            : tx`SELECT r.client_id FROM core.strategy_plan_runs r JOIN core.strategy_plans p ON p.id = r.plan_id
                  WHERE r.id = ${id} AND r.organization_id = ${organizationId} AND p.removido_em IS NULL`)) as unknown as { client_id: string }[];
        return rows[0]?.client_id ?? null;
      });
    },

    async removerPlano(organizationId, planoId, requestId) {
      return comTraducaoOuAusencia(() =>
        withTenant(organizationId, async (tx) => {
          await definirRequestId(tx, requestId);
          const travados = (await tx`
            SELECT id FROM core.strategy_plans WHERE id = ${planoId} AND organization_id = ${organizationId} AND removido_em IS NULL FOR UPDATE
          `) as unknown as { id: string }[];
          if (!travados[0]) throw new NaoEncontrado();
          const ativas = (await tx`
            SELECT 1 AS ok FROM core.strategy_plan_runs WHERE plan_id = ${planoId} AND organization_id = ${organizationId} AND status IN ('pendente', 'rodando') LIMIT 1
          `) as unknown as unknown[];
          if (ativas.length > 0) throw Object.assign(new Error('execução ativa'), { code: '23505', constraint_name: 'strategy_plan_runs_uma_ativa' });
          const atualizadas = await tx`
            UPDATE core.strategy_plans SET removido_em = now() WHERE id = ${planoId} AND organization_id = ${organizationId} AND removido_em IS NULL
          `;
          if (atualizadas.count !== 1) throw new NaoEncontrado();
          return { planoId };
        }),
      );
    },

    async criarPlanoComExecucao(escopo, novo, execucao) {
      const resultado = await comTraducao<Result<{ plano: Plano; execucao: Execucao; reaproveitado?: boolean }, ErroDeEstrategia>>(() =>
        withTenant(escopo.organizationId, async (tx) => {
          await definirRequestId(tx, execucao.requestId);
          const chave = novo.chaveDeIdempotencia ?? null;
          const rows = (await tx`
            INSERT INTO core.strategy_plans (organization_id, client_id, plan_type_key, plataformas, whatsapp, landing_page_id, foco, idempotency_key)
            VALUES (${escopo.organizationId}, ${escopo.clientId}, ${novo.tipo}, ${[...novo.plataformas]}::text[], ${novo.whatsapp}, ${novo.landingPageId}::uuid, ${tx.json(novo.foco as Json)}, ${chave})
            ON CONFLICT (organization_id, client_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
            RETURNING ${colunasDoPlano(tx)}
          `) as unknown as PlanoRow[];
          if (rows.length === 0) {
            const existentes = (await tx`
              SELECT ${colunasDoPlano(tx)} FROM core.strategy_plans
               WHERE organization_id = ${escopo.organizationId} AND client_id = ${escopo.clientId} AND idempotency_key = ${chave} AND removido_em IS NULL
            `) as unknown as PlanoRow[];
            const existente = existentes[0];
            if (!existente) return err(PLANO_DA_CHAVE_NAO_ENCONTRADO);
            const planoExistente = paraPlano(existente);
            if (!mesmoPedidoDePlano(planoExistente, novo)) return err(CHAVE_DE_IDEMPOTENCIA_COM_OUTRO_PEDIDO);
            const execucoes = (await tx`
              SELECT ${colunasDaExecucao(tx)} FROM core.strategy_plan_runs
               WHERE organization_id = ${escopo.organizationId} AND plan_id = ${existente.id}
               ORDER BY created_at ASC, id ASC LIMIT 1
            `) as unknown as ExecucaoRow[];
            const primeira = execucoes[0];
            if (!primeira) return err(PLANO_DA_CHAVE_NAO_ENCONTRADO);
            return ok({ plano: planoExistente, execucao: paraExecucao(primeira), reaproveitado: true });
          }
          const primeiroRegistro = rows[0];
          if (!primeiroRegistro) return err(PLANO_DA_CHAVE_NAO_ENCONTRADO);
          const plano = paraPlano(primeiroRegistro);
          const criada = await inserirExecucao(tx, escopo.organizationId, escopo.clientId, { ...execucao, planoId: plano.id });
          return ok({ plano, execucao: criada });
        }),
      );
      return resultado.ok ? resultado.value : resultado;
    },

    async listarPlanosDoCliente(escopo) {
      return withTenant(escopo.organizationId, (tx) => estadosDosPlanos(tx, escopo.organizationId, escopo.clientId, null));
    },

    async estadoDoPlano(organizationId, planoId) {
      return withTenant(organizationId, async (tx) => (await estadosDosPlanos(tx, organizationId, null, planoId))[0] ?? null);
    },

    async criarVersaoRascunho(organizationId, nova: NovaVersao) {
      return comTraducaoOuAusencia(() =>
        withTenant(organizationId, async (tx) => {
          await definirRequestId(tx, nova.requestId);
          return inserirVersao(tx, organizationId, nova);
        }),
      );
    },

    async criarVersaoManualComRevisao(organizationId, clientId, nova, execucao) {
      return comTraducaoOuAusencia(() =>
        withTenant(organizationId, async (tx) => {
          await definirRequestId(tx, nova.requestId);
          const versao = await inserirVersao(tx, organizationId, nova);
          const criada = await inserirExecucao(tx, organizationId, clientId, { ...execucao, versaoBaseId: versao.id });
          return { versao, execucao: criada };
        }),
      );
    },

    async registrarEvento(organizationId, novo: NovoEvento) {
      return comTraducaoOuAusencia(() =>
        withTenant(organizationId, async (tx) => {
          await definirRequestId(tx, novo.requestId);
          return inserirEvento(tx, organizationId, novo);
        }),
      );
    },

    async lerVersao(organizationId, versaoId) {
      return withTenant(organizationId, (tx) => lerVersaoNaTx(tx, organizationId, versaoId));
    },

    async listarVersoes(organizationId, planoId, limite) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT ${colunasDaVersao(tx)} FROM core.strategy_plan_versions
           WHERE plan_id = ${planoId} AND organization_id = ${organizationId}
             AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = plan_id AND p.removido_em IS NULL)
           ORDER BY created_at DESC, id DESC LIMIT ${limite}
        `) as unknown as VersaoRow[];
        return rows.map(paraVersaoResumo);
      });
    },

    async eventosDaVersao(organizationId, versaoId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT ${colunasDoEvento(tx)} FROM core.strategy_plan_events
           WHERE version_id = ${versaoId} AND organization_id = ${organizationId}
             AND EXISTS (SELECT 1 FROM core.strategy_plan_versions v JOIN core.strategy_plans p ON p.id = v.plan_id WHERE v.id = version_id AND p.removido_em IS NULL)
           ORDER BY created_at, id
        `) as unknown as EventoRow[];
        return rows.map(paraEvento);
      });
    },

    async criarExecucao(organizationId, clientId, nova: NovaExecucao) {
      return comTraducaoOuAusencia(() =>
        withTenant(organizationId, async (tx) => {
          await definirRequestId(tx, nova.requestId);
          return inserirExecucao(tx, organizationId, clientId, nova);
        }),
      );
    },

    async lerExecucao(organizationId, execucaoId) {
      return withTenant(organizationId, (tx) => lerExecucaoNaTx(tx, organizationId, execucaoId));
    },

    async execucaoAtiva(organizationId, planoId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT ${colunasDaExecucao(tx)} FROM core.strategy_plan_runs
           WHERE plan_id = ${planoId} AND organization_id = ${organizationId} AND status IN ('pendente', 'rodando')
             AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = plan_id AND p.removido_em IS NULL)
           LIMIT 1
        `) as unknown as ExecucaoRow[];
        return rows[0] ? paraExecucao(rows[0]) : null;
      });
    },

    async execucoesDoPlano(organizationId, planoId, limite) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT ${colunasDaExecucao(tx)} FROM core.strategy_plan_runs
           WHERE plan_id = ${planoId} AND organization_id = ${organizationId}
             AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = plan_id AND p.removido_em IS NULL)
           ORDER BY created_at DESC, id DESC LIMIT ${limite}
        `) as unknown as ExecucaoRow[];
        return rows.map(paraExecucao);
      });
    },

    async ultimaExecucao(organizationId, planoId) {
      return withTenant(organizationId, async (tx) => {
        const rows = (await tx`
          SELECT ${colunasDaExecucao(tx)} FROM core.strategy_plan_runs
           WHERE plan_id = ${planoId} AND organization_id = ${organizationId}
             AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = plan_id AND p.removido_em IS NULL)
           ORDER BY created_at DESC, id DESC LIMIT 1
        `) as unknown as ExecucaoRow[];
        return rows[0] ? paraExecucao(rows[0]) : null;
      });
    },

    async cancelarExecucao(organizationId, execucaoId, requestId) {
      return comTraducaoOuAusencia(() =>
        withTenant(organizationId, async (tx) => {
          await definirRequestId(tx, requestId);
          const rows = (await tx`
            UPDATE core.strategy_plan_runs SET status = 'cancelada'
             WHERE id = ${execucaoId} AND organization_id = ${organizationId} AND status IN ('pendente', 'rodando')
            RETURNING ${colunasDaExecucao(tx)}
          `) as unknown as ExecucaoRow[];
          if (rows[0]) return paraExecucao(rows[0]);
          const existente = await lerExecucaoNaTx(tx, organizationId, execucaoId);
          if (!existente) throw new NaoEncontrado();
          throw Object.assign(new Error('transição inválida: execução em estado final'), { code: '23514' });
        }),
      );
    },

    async atualizarExecucao(organizationId, execucaoId, mudanca, ficha) {
      const alteracoes: Record<string, unknown> = {};
      for (const chave of Object.keys(COLUNAS_DE_MUDANCA) as (keyof MudancaDaExecucao)[]) {
        if (mudanca[chave] !== undefined) alteracoes[COLUNAS_DE_MUDANCA[chave]] = mudanca[chave];
      }
      const colunas = Object.keys(alteracoes);
      if (colunas.length === 0) return err({ codigo: 'invalido', mensagem: 'Nenhuma mudança informada.' });
      return comTraducaoOuAusencia(() =>
        withTenant(organizationId, async (tx) => {
          const rows = (await tx`
            UPDATE core.strategy_plan_runs SET ${tx(alteracoes as never, ...colunas)}
             WHERE id = ${execucaoId} AND organization_id = ${organizationId}
               AND status = 'rodando' AND tentativas = ${ficha}::int
             AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = plan_id AND p.removido_em IS NULL)
            RETURNING ${colunasDaExecucao(tx)}
          `) as unknown as ExecucaoRow[];
          if (!rows[0]) {
            throw new ExecucaoPerdidaNoBanco();
          }
          return paraExecucao(rows[0]);
        }),
      );
    },

    async reservarProximaExecucao(organizationId, opcoes) {
      return withTenant(organizationId, async (tx) => {
        const candidatas = (await tx`
          SELECT id FROM core.strategy_plan_runs
           WHERE organization_id = ${organizationId}
             AND (status = 'pendente' OR (status = 'rodando' AND lease_until IS NOT NULL AND lease_until < now()))
             AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = plan_id AND p.removido_em IS NULL)
           ORDER BY created_at, id
           LIMIT 1
           FOR UPDATE SKIP LOCKED
        `) as unknown as { id: string }[];
        const alvo = candidatas[0];
        return alvo ? reservar(tx, alvo.id, opcoes) : null;
      });
    },

    async descobrirExecucoesPendentes(limite) {
      return withoutTenant(async (tx) => {
        const rows = (await tx`
          SELECT organization_id, client_id, id FROM core.strategy_runs_pendentes(${limite}::int)
        `) as unknown as { organization_id: string; client_id: string; id: string }[];
        return rows.map((row) => ({ organizationId: row.organization_id, clientId: row.client_id, id: row.id }));
      });
    },

    async reservarExecucao(organizationId, execucaoId, opcoes) {
      return withTenant(organizationId, async (tx) => {
        const candidatas = (await tx`
          SELECT id FROM core.strategy_plan_runs
           WHERE id = ${execucaoId} AND organization_id = ${organizationId}
             AND (status = 'pendente' OR (status = 'rodando' AND lease_until IS NOT NULL AND lease_until < now()))
             AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = plan_id AND p.removido_em IS NULL)
           FOR UPDATE SKIP LOCKED
        `) as unknown as { id: string }[];
        return candidatas[0] ? reservar(tx, execucaoId, opcoes) : null;
      });
    },
  };
}
