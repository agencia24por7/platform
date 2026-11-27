import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { MemberRole } from '@/modules/identity/domain/user';
import { CATALOGOS_DE_TESTE, CLIENTE_ID, ORGANIZACAO_ID, intencaoDeTeste, pacoteDeTeste, planoCompleto } from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createEstrategiaService } = await import('./estrategiaService.ts');
const { criarRepositorioEmMemoria } = await import('../infrastructure/repositorioEmMemoria.ts');
const { ok } = await import('../../../shared/result/result.ts');

const ator = { userId: '99999999-9999-4999-8999-999999999999', requestId: 'req-1', sourceIp: '10.0.0.1' };
const como = (papelDeQuemAge: MemberRole, organizationId = ORGANIZACAO_ID) => ({ organizationId, papelDeQuemAge });
const OUTRA_ORG = '55555555-5555-4555-8555-555555555555';
const OUTRO_CLIENTE = '44444444-4444-4444-8444-444444444444';

const codigoDe = (r: { ok: boolean; error?: { details?: Record<string, string>; code: string } }) => (r.ok ? 'ok' : (r.error?.details?.['codigo'] ?? r.error?.code));

async function montar(pedido: Record<string, unknown>, tipo: 'criar' | 'ajustar' | 'corrigir_gate', terminarCom: 'falhou' | 'concluida' = 'falhou', erro: 'ia_falha' | 'gate_reprovado' = 'ia_falha') {
  const repositorio = criarRepositorioEmMemoria();
  const auditorias: AuditEvent[] = [];
  const servico = createEstrategiaService({
    repositorio,
    audit: { async record(e) { auditorias.push(e); }, async list() { return []; }, async search() { return []; } },
    leitorDoBrain: { async lerPacote() { return ok(pacoteDeTeste()); } },
    destino: { async listarLandingPages() { return ok([]); }, async lerWhatsapp() { return ok(null); } } as never,
    catalogos: CATALOGOS_DE_TESTE,
  });
  const plano = await repositorio.criarPlano({ organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID }, 'aquisicao');
  assert.ok(plano.ok);
  let versaoId: string | null = null;
  if (tipo !== 'criar') {
    const versao = await repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
      planoId: plano.value.id,
      conteudo: planoCompleto(),
      schemaVersion: 1,
      supersedesId: null,
      autoria: { tipo: 'pessoa', userId: ator.userId },
      referencias: [],
      requestId: 'r',
    });
    assert.ok(versao.ok);
    versaoId = versao.value.id;
  }
  const criada = await repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
    planoId: plano.value.id,
    pedido: pedido as never,
    versaoBaseId: versaoId,
    agentRunId: 'run-0',
    solicitadoPor: ator.userId,
    requestId: 'r',
  });
  assert.ok(criada.ok);
  const reservada = await repositorio.reservarExecucao(ORGANIZACAO_ID, criada.value.id, { leaseMs: 60_000, agora: new Date() });
  assert.ok(reservada);
  const fim = await repositorio.atualizarExecucao(ORGANIZACAO_ID, criada.value.id, { status: terminarCom, ...(terminarCom === 'falhou' ? { erroCodigo: erro } : { etapa: 'fim' as const }), leaseAte: null }, reservada.tentativas);
  assert.ok(fim.ok);
  return { repositorio, servico, auditorias, planoId: plano.value.id, versaoId, anteriorId: criada.value.id, agentRunAnterior: criada.value.agentRunId };
}

const pedidoDe = (m: { planoId: string }) => ({ clienteId: CLIENTE_ID, planoId: m.planoId });
const INTENCAO = intencaoDeTeste();

describe('tentar de novo', () => {
  it('recusa erro não repetível (POST direto) com tipo_nao_repetivel', async () => {
    const m = await montar({ tipo: 'criar', intencao: INTENCAO }, 'criar', 'falhou', 'gate_reprovado');
    assert.equal(codigoDe(await m.servico.tentarDeNovo(como('operator'), pedidoDe(m), ator)), 'tipo_nao_repetivel');
  });

  it('criar: recusa com base_mudou quando a pessoa já tem versão no plano', async () => {
    const m = await montar({ tipo: 'criar', intencao: INTENCAO }, 'criar');
    const versao = await m.repositorio.criarVersaoRascunho(ORGANIZACAO_ID, {
      planoId: m.planoId,
      conteudo: planoCompleto(),
      schemaVersion: 1,
      supersedesId: null,
      autoria: { tipo: 'pessoa', userId: ator.userId },
      referencias: [],
      requestId: 'r',
    });
    assert.ok(versao.ok);
    assert.equal(codigoDe(await m.servico.tentarDeNovo(como('operator'), pedidoDe(m), ator)), 'base_mudou');
  });

  it('criar: abre nova execução com o mesmo pedido, sem versão base e chave nova, e audita sem dado pessoal', async () => {
    const m = await montar({ tipo: 'criar', intencao: INTENCAO }, 'criar');
    const r = await m.servico.tentarDeNovo(como('operator'), pedidoDe(m), ator);
    assert.ok(r.ok, JSON.stringify(r));
    assert.notEqual(r.value.execucao.id, m.anteriorId);
    assert.notEqual(r.value.execucao.agentRunId, m.agentRunAnterior);
    assert.equal(r.value.execucao.tipo, 'criar');
    assert.equal(r.value.execucao.versaoBaseId, null);
    assert.deepEqual(r.value.execucao.pedido, { ...INTENCAO });
    const auditoria = m.auditorias.find((a) => a.action === 'strategy.run.retry')!;
    assert.equal(auditoria.metadata?.execucaoAnteriorId, m.anteriorId);
    assert.equal(auditoria.metadata?.kind, 'criar');
    assert.ok(!JSON.stringify(auditoria.metadata).includes(INTENCAO.objetivo));
  });

  it('ajustar: repete a instrução na mesma versão base', async () => {
    const m = await montar({ tipo: 'ajustar', instrucao: 'mais verba' }, 'ajustar');
    const r = await m.servico.tentarDeNovo(como('operator'), pedidoDe(m), ator);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.value.execucao.versaoBaseId, m.versaoId);
    assert.deepEqual(r.value.execucao.pedido, { instrucao: 'mais verba' });
  });

  it('recusa viewer, plano de outra organização e de outro cliente', async () => {
    const m = await montar({ tipo: 'criar', intencao: INTENCAO }, 'criar');
    assert.equal(codigoDe(await m.servico.tentarDeNovo(como('viewer'), pedidoDe(m), ator)), 'forbidden');
    assert.equal(codigoDe(await m.servico.tentarDeNovo(como('operator', OUTRA_ORG), pedidoDe(m), ator)), 'not_found');
    assert.equal(codigoDe(await m.servico.tentarDeNovo(como('operator'), { clienteId: OUTRO_CLIENTE, planoId: m.planoId }, ator)), 'not_found');
  });

  it('recusa com execução ativa e quando a última não falhou', async () => {
    const m = await montar({ tipo: 'criar', intencao: INTENCAO }, 'criar');
    assert.ok((await m.servico.tentarDeNovo(como('operator'), pedidoDe(m), ator)).ok);
    assert.equal(codigoDe(await m.servico.tentarDeNovo(como('operator'), pedidoDe(m), ator)), 'execucao_ativa');
    const concluida = await montar({ tipo: 'criar', intencao: INTENCAO }, 'criar', 'concluida');
    assert.equal(codigoDe(await concluida.servico.tentarDeNovo(como('operator'), pedidoDe(concluida), ator)), 'sem_falha_para_repetir');
  });

  it('não repete corrigir_gate', async () => {
    const m = await montar({ tipo: 'corrigir_gate' }, 'corrigir_gate');
    assert.equal(codigoDe(await m.servico.tentarDeNovo(como('operator'), pedidoDe(m), ator)), 'tipo_nao_repetivel');
  });
});
