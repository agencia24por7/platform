import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { MemberRole } from '@/modules/identity/domain/user';
import { CATALOGOS_DE_TESTE, CLIENTE_ID, ORGANIZACAO_ID, pacoteDeTeste, planoCompleto } from '../domain/fixturesDeTeste.ts';

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
const como = (papelDeQuemAge: MemberRole) => ({ organizationId: ORGANIZACAO_ID, papelDeQuemAge });
const LANDING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const { plataformas: _p, whatsapp: _w, destino: _d, utm: _u, foco: _f, ...INTENCAO_BASE } = planoCompleto().intencao;
const CHAVE = '12345678-1234-4234-8234-123456789abc';

function montar() {
  const repositorio = criarRepositorioEmMemoria();
  const auditorias: string[] = [];
  const servico = createEstrategiaService({
    repositorio,
    audit: { async record(e) { auditorias.push(e.action); }, async list() { return []; }, async search() { return []; } },
    leitorDoBrain: { async lerPacote() { return ok(pacoteDeTeste()); } },
    destino: {
      async listarLandingPages() {
        return ok([{ id: LANDING_ID, organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID, url: 'https://exemplo.com.br/oferta', rotulo: 'Oferta', criadaEm: new Date(), arquivadaEm: null }]);
      },
      async lerWhatsapp() { return ok('+5511912345678'); },
    } as never,
    catalogos: CATALOGOS_DE_TESTE,
  });
  return { repositorio, servico, auditorias };
}

const pedido = (extra: Record<string, unknown> = {}) => ({
  clienteId: CLIENTE_ID,
  tipoDePlano: 'aquisicao' as const,
  plataformas: ['meta' as const],
  landingPageId: LANDING_ID,
  foco: { tipo: 'marca' as const },
  intencao: INTENCAO_BASE,
  ...extra,
});

describe('pedir plano: idempotência do formulário', () => {
  it('o mesmo nonce devolve o plano e a execução já criados, sem duplicar nem auditar de novo', async () => {
    const m = await montar();
    const primeira = await m.servico.pedirPlano(como('operator'), pedido({ chaveDeIdempotencia: CHAVE }), ator);
    const segunda = await m.servico.pedirPlano(como('operator'), pedido({ chaveDeIdempotencia: CHAVE.toUpperCase() }), ator);
    assert.ok(primeira.ok && segunda.ok);
    assert.equal(segunda.value.plano.id, primeira.value.plano.id);
    assert.equal(segunda.value.execucao.id, primeira.value.execucao.id);
    assert.equal(m.repositorio.estado.execucoes.length, 1);
    assert.equal(m.auditorias.filter((a) => a === 'strategy.plan.requested').length, 1);
  });

  it('o mesmo nonce com conteúdo diferente é conflito, sem criar nada', async () => {
    const m = await montar();
    await m.servico.pedirPlano(como('operator'), pedido({ chaveDeIdempotencia: CHAVE }), ator);
    const outra = await m.servico.pedirPlano(como('operator'), pedido({ chaveDeIdempotencia: CHAVE, plataformas: ['google'] }), ator);
    assert.equal(!outra.ok && outra.error.code, 'conflict');
    assert.equal(m.repositorio.estado.execucoes.length, 1);
  });

  it('nonce diferente ou ausente cria planos independentes; nonce inválido é recusado', async () => {
    const m = await montar();
    await m.servico.pedirPlano(como('operator'), pedido({ chaveDeIdempotencia: CHAVE }), ator);
    const outro = await m.servico.pedirPlano(como('operator'), pedido({ chaveDeIdempotencia: '87654321-1234-4234-8234-123456789abc' }), ator);
    const sem = await m.servico.pedirPlano(como('operator'), pedido(), ator);
    assert.ok(outro.ok && sem.ok);
    assert.equal(m.repositorio.estado.execucoes.length, 3);
    const invalido = await m.servico.pedirPlano(como('operator'), pedido({ chaveDeIdempotencia: 'abc' }), ator);
    assert.equal(invalido.ok, false);
  });

  it('o modelo de criação entrega um nonce novo a cada renderização', async () => {
    const m = await montar();
    const a = await m.servico.modeloDeCriacao(como('operator'), { clienteId: CLIENTE_ID });
    const b = await m.servico.modeloDeCriacao(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(a.ok && b.ok);
    assert.match(a.value.chaveDeIdempotencia, /^[0-9a-f-]{36}$/);
    assert.notEqual(a.value.chaveDeIdempotencia, b.value.chaveDeIdempotencia);
  });
});
