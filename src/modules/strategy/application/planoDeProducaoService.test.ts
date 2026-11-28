import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import { CLIENTE_ID, ORGANIZACAO_ID, OUTRO_CLIENTE_ID, planoCompletoBruto } from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createPlanoDeProducaoService } = await import('@/modules/strategy/application/planoDeProducaoService');
const { criarProducaoEmMemoria } = await import('@/modules/strategy/infrastructure/producaoEmMemoria');

const PLANO_ID = '44444444-4444-4444-8444-444444444444';
const VERSAO_ID = '55555555-5555-4555-8555-555555555555';
const ATOR = { userId: '66666666-6666-4666-8666-666666666666', requestId: 'req-1', sourceIp: null };

function montar(vigente: boolean) {
  const repositorio = criarProducaoEmMemoria();
  const auditoria: { action: string; metadata: Record<string, unknown> }[] = [];
  const resumo = { id: VERSAO_ID, planoId: PLANO_ID, redigidaEm: null, status: 'vigente' };
  const servico = createPlanoDeProducaoService({
    repositorio,
    estrategia: {
      buscarPlanoPorId: async (org, id) => (org === ORGANIZACAO_ID && id === PLANO_ID ? ({ id, organizationId: org, clientId: CLIENTE_ID } as never) : null),
      estadoDoPlano: async () => ({ vigente: vigente ? resumo : null }) as never,
      lerVersao: async () => ({ ...resumo, conteudo: planoCompletoBruto() }) as never,
    },
    audit: { record: async (evento: { action: string; metadata: Record<string, unknown> }) => void auditoria.push(evento) } as never,
  });
  return { servico, repositorio, auditoria };
}

const comando = (papel: 'owner' | 'admin' | 'operator' | 'viewer') => ({ organizationId: ORGANIZACAO_ID, papelDeQuemAge: papel });

describe('serviço do plano de produção', () => {
  it('operator pede a partir da versão vigente; auditoria só com ids', async () => {
    const { servico, auditoria } = montar(true);
    const pedido = await servico.pedir(comando('operator'), { clienteId: CLIENTE_ID, planoId: PLANO_ID }, ATOR);
    assert.ok(pedido.ok);
    assert.equal(pedido.value.versaoId, VERSAO_ID);
    assert.equal(pedido.value.status, 'pendente');
    assert.equal(auditoria[0]?.action, 'strategy.production.requested');
    assert.deepEqual(Object.keys(auditoria[0]!.metadata).sort(), ['clientId', 'numero', 'planoId', 'versaoId']);
  });

  it('viewer não pede nem lê', async () => {
    const { servico } = montar(true);
    const pedido = await servico.pedir(comando('viewer'), { clienteId: CLIENTE_ID, planoId: PLANO_ID }, ATOR);
    assert.ok(!pedido.ok && pedido.error.code === 'forbidden');
    const painel = await servico.painel(comando('viewer'), { clienteId: CLIENTE_ID, planoId: PLANO_ID });
    assert.ok(!painel.ok && painel.error.code === 'forbidden');
  });

  it('sem versão autorizada recusa com conflito', async () => {
    const { servico } = montar(false);
    const pedido = await servico.pedir(comando('owner'), { clienteId: CLIENTE_ID, planoId: PLANO_ID }, ATOR);
    assert.ok(!pedido.ok && pedido.error.code === 'conflict');
  });

  it('plano de outro cliente é não encontrado', async () => {
    const { servico } = montar(true);
    const pedido = await servico.pedir(comando('owner'), { clienteId: OUTRO_CLIENTE_ID, planoId: PLANO_ID }, ATOR);
    assert.ok(!pedido.ok && pedido.error.code === 'not_found');
  });

  it('segundo pedido com um pendente recusa; o painel lista as gerações', async () => {
    const { servico } = montar(true);
    assert.ok((await servico.pedir(comando('admin'), { clienteId: CLIENTE_ID, planoId: PLANO_ID }, ATOR)).ok);
    const segundo = await servico.pedir(comando('admin'), { clienteId: CLIENTE_ID, planoId: PLANO_ID }, ATOR);
    assert.ok(!segundo.ok && segundo.error.code === 'conflict');
    const painel = await servico.painel(comando('operator'), { clienteId: CLIENTE_ID, planoId: PLANO_ID });
    assert.ok(painel.ok);
    assert.equal(painel.value.geracoes.length, 1);
    assert.ok(painel.value.planoDeMarketing);
  });
});
