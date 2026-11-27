import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { MemberRole } from '@/modules/identity/domain/user';
import type { LeitorDoBrain, ProdutoDoContexto } from '@/modules/strategy/application/portas';
import { CATALOGOS_DE_TESTE, CLIENTE_ID, ORGANIZACAO_ID, OUTRO_CLIENTE_ID, hashDeTeste, pacoteDeTeste, planoCompleto } from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createEstrategiaService } = await import('./estrategiaService.ts');
const { criarRepositorioEmMemoria } = await import('../infrastructure/repositorioEmMemoria.ts');
const { criarUrn } = await import('../../brain/domain/urn.ts');
const { err, ok } = await import('../../../shared/result/result.ts');

const ator = { userId: '99999999-9999-4999-8999-999999999999', requestId: 'req-1', sourceIp: '10.0.0.1' };
const como = (papelDeQuemAge: MemberRole, organizationId = ORGANIZACAO_ID) => ({ organizationId, papelDeQuemAge });
const LANDING_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const { plataformas: _p, whatsapp: _w, destino: _d, utm: _u, foco: _f, ...INTENCAO_BASE } = planoCompleto().intencao;

const urnDoProduto = (id: string, cliente = CLIENTE_ID) => criarUrn(ORGANIZACAO_ID, cliente, 'contexto_produto', id);
const produto = (id: string, rotulo: string, n: number, cliente = CLIENTE_ID): ProdutoDoContexto => {
  const urn = urnDoProduto(id, cliente);
  return { urn, rotulo, hash: hashDeTeste(n), entrada: { foco: true, urn, hash: hashDeTeste(n), tipo: 'contexto_produto', titulo: rotulo, resumo: '', somenteMetadados: false } };
};
const TENIS = produto('tenis', 'Tênis', 30);
const CAMISETA = produto('camiseta', 'Camiseta', 31);

function montar(opcoes: { produtos?: readonly ProdutoDoContexto[]; leituraFalha?: boolean } = {}) {
  const repositorio = criarRepositorioEmMemoria();
  const auditorias: { action: string; metadata: Record<string, unknown> }[] = [];
  const leitorDoBrain: LeitorDoBrain = {
    async lerPacote() {
      return ok(pacoteDeTeste());
    },
    async produtosDoContexto() {
      return opcoes.leituraFalha ? err({ codigo: 'brain_indisponivel', mensagem: 'fora' }) : ok(opcoes.produtos ?? [TENIS, CAMISETA]);
    },
  };
  const servico = createEstrategiaService({
    repositorio,
    audit: {
      async record(e) {
        auditorias.push({ action: e.action, metadata: e.metadata as Record<string, unknown> });
      },
      async list() {
        return [];
      },
      async search() {
        return [];
      },
    },
    leitorDoBrain,
    destino: {
      async listarLandingPages() {
        return ok([{ id: LANDING_ID, organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID, url: 'https://exemplo.com.br/oferta', rotulo: 'Oferta', criadaEm: new Date(), arquivadaEm: null }]);
      },
      async lerWhatsapp() {
        return ok('+5511912345678');
      },
    } as never,
    catalogos: CATALOGOS_DE_TESTE,
  });
  return { repositorio, servico, auditorias };
}

const pedido = (foco: unknown) => ({
  clienteId: CLIENTE_ID,
  tipoDePlano: 'aquisicao' as const,
  plataformas: ['meta' as const],
  landingPageId: LANDING_ID,
  foco: foco as never,
  intencao: INTENCAO_BASE,
});

describe('pedirPlano: foco do plano', () => {
  it('marca é aceita e grava o foco na intenção do pedido e no plano', async () => {
    const m = montar({ produtos: [] });
    const r = await m.servico.pedirPlano(como('operator'), pedido({ tipo: 'marca' }), ator);
    assert.ok(r.ok);
    assert.deepEqual(r.value.plano.foco, { tipo: 'marca' });
    assert.deepEqual((m.repositorio.estado.execucoes[0]!.pedido as { foco: unknown }).foco, { tipo: 'marca' });
    assert.equal(m.auditorias[0]?.metadata.foco, 'marca');
  });

  it('vários produtos: o servidor resolve rótulo e hash no Brain, nunca confia no formulário', async () => {
    const m = montar();
    const r = await m.servico.pedirPlano(como('operator'), pedido({ tipo: 'produtos', produtos: [TENIS.urn, CAMISETA.urn] }), ator);
    assert.ok(r.ok);
    assert.deepEqual(r.value.plano.foco, {
      tipo: 'produtos',
      produtos: [
        { urn: TENIS.urn, rotulo: 'Tênis', hash: hashDeTeste(30) },
        { urn: CAMISETA.urn, rotulo: 'Camiseta', hash: hashDeTeste(31) },
      ],
    });
    assert.equal(m.auditorias[0]?.metadata.produtos, 2);
    assert.ok(!JSON.stringify(m.auditorias).includes('Tênis'));
  });

  it('rótulo vindo no pedido é recusado pelo esquema (o servidor não aceita rótulo)', async () => {
    const m = montar();
    const r = await m.servico.pedirPlano(como('operator'), pedido({ tipo: 'produtos', produtos: [{ urn: TENIS.urn, rotulo: 'Falso' }] }), ator);
    assert.equal(!r.ok && r.error.code, 'validation');
    assert.equal(m.repositorio.estado.planos.length, 0);
  });

  it('produto de outro cliente, inexistente ou de lista vazia é validação e nada é gravado', async () => {
    const m = montar();
    for (const urn of [urnDoProduto('tenis', OUTRO_CLIENTE_ID), urnDoProduto('nao-existe')]) {
      const r = await m.servico.pedirPlano(como('operator'), pedido({ tipo: 'produtos', produtos: [TENIS.urn, urn] }), ator);
      assert.equal(!r.ok && r.error.code, 'validation', urn);
      assert.ok(!r.ok && r.error.details?.['foco.produtos']);
    }
    assert.equal(m.repositorio.estado.planos.length, 0);
    assert.equal(m.repositorio.estado.execucoes.length, 0);
  });

  it('sem foco é recusado; os dois juntos, vazio e duplicata também', async () => {
    const m = montar();
    const base = pedido({ tipo: 'marca' });
    const { foco: _foco, ...semFoco } = base;
    assert.equal((await m.servico.pedirPlano(como('operator'), semFoco as never, ator)).ok, false);
    for (const foco of [{ tipo: 'marca', produtos: [TENIS.urn] }, { tipo: 'produtos', produtos: [] }, { tipo: 'produtos', produtos: [TENIS.urn, TENIS.urn] }]) {
      assert.equal((await m.servico.pedirPlano(como('operator'), pedido(foco), ator)).ok, false);
    }
    assert.equal(m.repositorio.estado.planos.length, 0);
  });

  it('leitura dos produtos fora do ar: indisponível, mas marca continua possível', async () => {
    const m = montar({ leituraFalha: true });
    const r = await m.servico.pedirPlano(como('operator'), pedido({ tipo: 'produtos', produtos: [TENIS.urn] }), ator);
    assert.equal(!r.ok && r.error.code, 'unavailable');
    assert.ok((await m.servico.pedirPlano(como('operator'), pedido({ tipo: 'marca' }), ator)).ok);
  });

  it('o mesmo nonce com foco diferente é conflito', async () => {
    const m = montar();
    const chave = '12345678-1234-4234-8234-123456789abc';
    assert.ok((await m.servico.pedirPlano(como('operator'), { ...pedido({ tipo: 'marca' }), chaveDeIdempotencia: chave }, ator)).ok);
    const outro = await m.servico.pedirPlano(como('operator'), { ...pedido({ tipo: 'produtos', produtos: [TENIS.urn] }), chaveDeIdempotencia: chave }, ator);
    assert.equal(!outro.ok && outro.error.code, 'conflict');
  });

  it('o modelo de criação lista os produtos do cliente, e sinaliza indisponibilidade', async () => {
    const ok1 = await montar().servico.modeloDeCriacao(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(ok1.ok);
    assert.deepEqual(ok1.value.produtos.map((p) => p.rotulo), ['Tênis', 'Camiseta']);
    assert.equal(ok1.value.produtosIndisponiveis, false);
    const vazio = await montar({ produtos: [] }).servico.modeloDeCriacao(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(vazio.ok && vazio.value.produtos.length === 0 && vazio.value.podeCriar);
    const fora = await montar({ leituraFalha: true }).servico.modeloDeCriacao(como('operator'), { clienteId: CLIENTE_ID });
    assert.ok(fora.ok && fora.value.produtosIndisponiveis && fora.value.podeCriar);
  });
});

describe('removerPlano', () => {
  async function comPlano() {
    const m = montar({ produtos: [] });
    const criado = await m.servico.pedirPlano(como('operator'), pedido({ tipo: 'marca' }), ator);
    assert.ok(criado.ok);
    m.repositorio.estado.execucoes[0]!.status = 'concluida';
    return { ...m, planoId: criado.value.plano.id };
  }
  const entrada = (planoId: string, clienteId = CLIENTE_ID) => ({ clienteId, planoId });

  it('owner e admin removem; o plano some da lista, do painel, de clienteDoPlano e das ações', async () => {
    for (const papel of ['owner', 'admin'] as const) {
      const m = await comPlano();
      const r = await m.servico.removerPlano(como(papel), entrada(m.planoId), ator);
      assert.ok(r.ok, papel);
      const lista = await m.servico.listarPlanos(como(papel), { clienteId: CLIENTE_ID });
      assert.ok(lista.ok && lista.value.cards.length === 0);
      const painel = await m.servico.painelDoPlano(como(papel), { clienteId: CLIENTE_ID, planoId: m.planoId });
      assert.ok(painel.ok && painel.value.planos.length === 0 && painel.value.resumos.length === 0);
      assert.equal(await m.servico.clienteDoPlano(como(papel), m.planoId), null);
      const pedir = await m.servico.pedirMudanca(como(papel), { planoId: m.planoId, instrucao: 'mude algo aqui' }, ator);
      assert.equal(!pedir.ok && pedir.error.code, 'not_found');
      assert.equal(m.auditorias.at(-1)?.action, 'strategy.plan.removed');
      assert.deepEqual(Object.keys(m.auditorias.at(-1)!.metadata).sort(), ['clientId', 'tipoDePlano']);
    }
  });

  it('operator e viewer são negados e o plano continua', async () => {
    const m = await comPlano();
    for (const papel of ['operator', 'viewer'] as const) {
      const r = await m.servico.removerPlano(como(papel), entrada(m.planoId), ator);
      assert.equal(!r.ok && r.error.code, 'forbidden', papel);
    }
    assert.equal((await m.servico.listarPlanos(como('owner'), { clienteId: CLIENTE_ID })).ok && m.repositorio.estado.removidos.size, 0);
  });

  it('plano de outra organização ou de outro cliente: não encontrado', async () => {
    const m = await comPlano();
    const outraOrg = await m.servico.removerPlano(como('owner', '99999999-0000-4000-8000-000000000000'), entrada(m.planoId), ator);
    assert.equal(!outraOrg.ok && outraOrg.error.code, 'not_found');
    const outroCliente = await m.servico.removerPlano(como('owner'), entrada(m.planoId, OUTRO_CLIENTE_ID), ator);
    assert.equal(!outroCliente.ok && outroCliente.error.code, 'not_found');
    assert.equal(m.repositorio.estado.removidos.size, 0);
  });

  it('execução ativa recusa com a mensagem de cancelar antes', async () => {
    const m = montar({ produtos: [] });
    const criado = await m.servico.pedirPlano(como('operator'), pedido({ tipo: 'marca' }), ator);
    assert.ok(criado.ok);
    const r = await m.servico.removerPlano(como('owner'), entrada(criado.value.plano.id), ator);
    assert.ok(!r.ok);
    assert.equal(r.error.code, 'conflict');
    assert.match(r.error.message, /Cancele a execução antes/);
    assert.equal(m.repositorio.estado.removidos.size, 0);
  });

  it('já removido: não encontrado, e a remoção não se repete', async () => {
    const m = await comPlano();
    assert.ok((await m.servico.removerPlano(como('owner'), entrada(m.planoId), ator)).ok);
    const de_novo = await m.servico.removerPlano(como('owner'), entrada(m.planoId), ator);
    assert.equal(!de_novo.ok && de_novo.error.code, 'not_found');
  });

  it('o worker não reserva nem descobre execução de plano removido', async () => {
    const m = montar({ produtos: [] });
    const criado = await m.servico.pedirPlano(como('operator'), pedido({ tipo: 'marca' }), ator);
    assert.ok(criado.ok);
    assert.equal((await m.repositorio.descobrirExecucoesPendentes(10)).length, 1);
    m.repositorio.estado.execucoes[0]!.status = 'cancelada';
    await m.servico.removerPlano(como('owner'), entrada(criado.value.plano.id), ator);
    m.repositorio.estado.execucoes[0]!.status = 'pendente';
    assert.equal((await m.repositorio.descobrirExecucoesPendentes(10)).length, 0);
    assert.equal(await m.repositorio.reservarProximaExecucao(ORGANIZACAO_ID, { leaseMs: 1000, agora: new Date() }), null);
    assert.equal(await m.repositorio.reservarExecucao(ORGANIZACAO_ID, m.repositorio.estado.execucoes[0]!.id, { leaseMs: 1000, agora: new Date() }), null);
  });
});
