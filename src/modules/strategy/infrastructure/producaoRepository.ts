import { withTenant, withoutTenant } from '@/shared/db/tenant';
import { err, ok } from '@/shared/result/result';
import type { ErroDeEstrategia } from '@/modules/strategy/application/portas';
import type { MudancaDaProducao, RegistroDeProducao, RepositorioDeProducao } from '@/modules/strategy/application/portasDaProducao';
import { traduzirErroDoBanco } from '@/modules/strategy/infrastructure/errosDoBanco';

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
type Json = Parameters<Tx['json']>[0];

type Linha = {
  id: string;
  organization_id: string;
  client_id: string;
  plan_id: string;
  version_id: string;
  numero: number;
  status: RegistroDeProducao['status'];
  conteudo: unknown;
  progresso: Record<string, unknown>;
  erro_codigo: RegistroDeProducao['erroCodigo'];
  motivo: string | null;
  tentativas: number;
  falhas: number;
  lease_until: Date | null;
  agent_run_id: string;
  requested_by: string | null;
  created_at: Date;
  updated_at: Date;
  concluido_em: Date | null;
  redigido_em: Date | null;
};

const LIMITE_DE_REQUEST_ID = 120;

const colunas = (tx: Tx) =>
  tx`p.id, p.organization_id, p.client_id, p.plan_id, p.version_id, p.numero, p.status, p.conteudo, p.progresso, p.erro_codigo, p.motivo,
     p.tentativas, p.falhas, p.lease_until, p.agent_run_id, p.requested_by, p.created_at, p.updated_at, p.concluido_em, p.redigido_em`;

const colunasDoRetorno = (tx: Tx) =>
  tx`id, organization_id, client_id, plan_id, version_id, numero, status, conteudo, progresso, erro_codigo, motivo,
     tentativas, falhas, lease_until, agent_run_id, requested_by, created_at, updated_at, concluido_em, redigido_em`;

function paraRegistro(linha: Linha): RegistroDeProducao {
  return {
    id: linha.id,
    organizationId: linha.organization_id,
    clientId: linha.client_id,
    planoId: linha.plan_id,
    versaoId: linha.version_id,
    numero: linha.numero,
    status: linha.status,
    conteudo: linha.conteudo,
    progresso: linha.progresso,
    erroCodigo: linha.erro_codigo,
    motivo: linha.motivo,
    tentativas: linha.tentativas,
    falhas: linha.falhas,
    leaseAte: linha.lease_until,
    agentRunId: linha.agent_run_id,
    solicitadoPor: linha.requested_by,
    criadoEm: linha.created_at,
    atualizadoEm: linha.updated_at,
    concluidoEm: linha.concluido_em,
    redigidoEm: linha.redigido_em,
  };
}

const PENDENTE_DUPLICADA: ErroDeEstrategia = { codigo: 'execucao_ativa', mensagem: 'Este plano já tem um plano de produção em geração.' };
const SEM_VERSAO_VIGENTE: ErroDeEstrategia = { codigo: 'conflito', mensagem: 'O plano de produção só nasce de versão vigente.' };
const NAO_ENCONTRADO: ErroDeEstrategia = { codigo: 'nao_encontrado', mensagem: 'Plano não encontrado.' };
const RESERVA_PERDIDA: ErroDeEstrategia = { codigo: 'execucao_perdida', mensagem: 'A geração não é mais deste worker.' };

function traduzir(erro: unknown): ErroDeEstrategia | null {
  if (erro === null || typeof erro !== 'object') return null;
  const { code, constraint_name: restricao, message } = erro as { code?: unknown; constraint_name?: unknown; message?: unknown };
  if (code === '23505' && restricao === 'strategy_production_plans_uma_pendente') return PENDENTE_DUPLICADA;
  if (code === '23514' && typeof message === 'string' && /vers[ãa]o vigente/i.test(message)) return SEM_VERSAO_VIGENTE;
  if (code === 'P0002') return NAO_ENCONTRADO;
  return traduzirErroDoBanco(erro);
}

const COLUNAS_DA_MUDANCA: Readonly<Record<keyof MudancaDaProducao, string>> = {
  status: 'status',
  conteudo: 'conteudo',
  progresso: 'progresso',
  erroCodigo: 'erro_codigo',
  motivo: 'motivo',
  falhas: 'falhas',
  leaseAte: 'lease_until',
};

export function createProducaoRepository(): RepositorioDeProducao {
  return {
    async pedir(organizationId, novo) {
      try {
        const linhas = await withTenant(organizationId, async (tx) => {
          await tx`SELECT set_config('app.request_id', ${novo.requestId.slice(0, LIMITE_DE_REQUEST_ID)}, true)`;
          return (await tx`
            INSERT INTO core.strategy_production_plans (organization_id, client_id, plan_id, version_id, numero, agent_run_id, requested_by)
            VALUES (${organizationId}, ${novo.clientId}, ${novo.planoId}, ${novo.versaoId}, 1, ${novo.agentRunId}, ${novo.solicitadoPor})
            RETURNING ${colunasDoRetorno(tx)}
          `) as unknown as Linha[];
        });
        return linhas[0] ? ok(paraRegistro(linhas[0])) : err(NAO_ENCONTRADO);
      } catch (erro) {
        const traduzido = traduzir(erro);
        if (traduzido === null) throw erro;
        return err(traduzido);
      }
    },

    async listarDoPlano(organizationId, planoId, limite) {
      return withTenant(organizationId, async (tx) => {
        const linhas = (await tx`
          SELECT ${colunas(tx)} FROM core.strategy_production_plans p
           WHERE p.plan_id = ${planoId} AND p.organization_id = ${organizationId}
             AND EXISTS (SELECT 1 FROM core.strategy_plans pl WHERE pl.id = p.plan_id AND pl.removido_em IS NULL)
           ORDER BY p.created_at DESC, p.id DESC
           LIMIT ${Math.max(1, Math.min(limite, 50))}
        `) as unknown as Linha[];
        return linhas.map(paraRegistro);
      });
    },

    async ler(organizationId, id) {
      return withTenant(organizationId, async (tx) => {
        const linhas = (await tx`
          SELECT ${colunas(tx)} FROM core.strategy_production_plans p
           WHERE p.id = ${id} AND p.organization_id = ${organizationId}
             AND EXISTS (SELECT 1 FROM core.strategy_plans pl WHERE pl.id = p.plan_id AND pl.removido_em IS NULL)
        `) as unknown as Linha[];
        return linhas[0] ? paraRegistro(linhas[0]) : null;
      });
    },

    async descobrirPendentes(limite) {
      return withoutTenant(async (tx) => {
        const linhas = (await tx`
          SELECT organization_id, client_id, id FROM core.strategy_producao_pendentes(${limite}::int)
        `) as unknown as { organization_id: string; client_id: string; id: string }[];
        return linhas.map((linha) => ({ organizationId: linha.organization_id, clientId: linha.client_id, id: linha.id }));
      });
    },

    async reservar(organizationId, id, leaseMs) {
      return withTenant(organizationId, async (tx) => {
        const candidatas = (await tx`
          SELECT p.id FROM core.strategy_production_plans p
           WHERE p.id = ${id} AND p.organization_id = ${organizationId} AND p.status = 'pendente'
             AND (p.lease_until IS NULL OR p.lease_until < now())
             AND EXISTS (SELECT 1 FROM core.strategy_plans pl WHERE pl.id = p.plan_id AND pl.removido_em IS NULL)
           FOR UPDATE SKIP LOCKED
        `) as unknown as { id: string }[];
        if (!candidatas[0]) return null;
        const linhas = (await tx`
          UPDATE core.strategy_production_plans
             SET tentativas = tentativas + 1, lease_until = now() + ${leaseMs}::int * interval '1 millisecond'
           WHERE id = ${id} AND organization_id = ${organizationId}
          RETURNING ${colunasDoRetorno(tx)}
        `) as unknown as Linha[];
        return linhas[0] ? paraRegistro(linhas[0]) : null;
      });
    },

    async atualizar(organizationId, id, ficha, mudanca) {
      const alteracoes: Record<string, unknown> = {};
      for (const chave of Object.keys(COLUNAS_DA_MUDANCA) as (keyof MudancaDaProducao)[]) {
        const valor = mudanca[chave];
        if (valor === undefined) continue;
        alteracoes[COLUNAS_DA_MUDANCA[chave]] = valor;
      }
      const nomes = Object.keys(alteracoes);
      if (nomes.length === 0) return err({ codigo: 'invalido', mensagem: 'Nenhuma mudança informada.' });
      try {
        const linhas = await withTenant(organizationId, async (tx) => {
          const valores: Record<string, unknown> = { ...alteracoes };
          if ('conteudo' in valores && valores['conteudo'] !== null) valores['conteudo'] = tx.json(valores['conteudo'] as Json);
          if ('progresso' in valores) valores['progresso'] = tx.json(valores['progresso'] as Json);
          return (await tx`
            UPDATE core.strategy_production_plans SET ${tx(valores as never, ...nomes)}
             WHERE id = ${id} AND organization_id = ${organizationId}
               AND status = 'pendente' AND tentativas = ${ficha}::int AND lease_until > now()
            RETURNING ${colunasDoRetorno(tx)}
          `) as unknown as Linha[];
        });
        return linhas[0] ? ok(paraRegistro(linhas[0])) : err(RESERVA_PERDIDA);
      } catch (erro) {
        const traduzido = traduzir(erro);
        if (traduzido === null) throw erro;
        return err(traduzido);
      }
    },
  };
}
