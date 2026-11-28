import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AvaliadorDeLimites, Execucao, LeitorDoBrain, PedidoDeIA, ProdutoDoContexto } from '@/modules/strategy/application/portas';
import { parecer } from '../domain/comite/fixturesDeParecer.ts';
import { CATALOGOS_DE_TESTE, CLIENTE_ID, ORGANIZACAO_ID, hashDeTeste, pacoteDeTeste, planoCompleto, secoesDoGrupoDaChave, urnDeTeste } from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createMotorDoPlano } = await import('./motorDoPlano.ts');
const { criarRepositorioEmMemoria } = await import('../infrastructure/repositorioEmMemoria.ts');
const { criarIaFalsa, aceitaTodos } = await import('../infrastructure/ia/iaFalsa.ts');
const { ok, err } = await import('../../../shared/result/result.ts');

const URN_TENIS = urnDeTeste('contexto_produto', 'tenis');
const PRODUTO: ProdutoDoContexto = {
  urn: URN_TENIS,
  rotulo: 'Tênis',
  hash: hashDeTeste(40),
  entrada: { foco: true, urn: URN_TENIS, hash: hashDeTeste(40), tipo: 'contexto_produto', titulo: 'Tênis', resumo: 'Categoria: calçados; Preço: R$ 299.00', somenteMetadados: false },
};
const FOCO = { tipo: 'produtos' as const, produtos: [{ urn: URN_TENIS, rotulo: 'Tênis', hash: hashDeTeste(40) }] };
const semMedidas = <T extends (...argumentos: never[]) => unknown>(f: T) => Object.assign(f, { medidasComLimite: [] as const });
const aprovaTudo: AvaliadorDeLimites = { async avaliador() { return ok(semMedidas(() => 'ok' as const)); } };

function roteiro(pedido: PedidoDeIA<unknown>): unknown {
  if (pedido.tarefa === 'strategy_plan') return secoesDoGrupoDaChave(pedido.chaveDeIdempotencia);
  if (pedido.tarefa === 'comite') return parecer((pedido.dados as { persona: { chave: string } }).persona.chave, 'aprova');
  if (pedido.tarefa === 'juiz') return aceitaTodos(pedido.dados);
  return { resultado: 'aprovado', problemas: [] };
}

async function rodar(brain: LeitorDoBrain, intencao: Record<string, unknown>) {
  const repositorio = criarRepositorioEmMemoria();
  const ia = criarIaFalsa(roteiro);
  const motor = createMotorDoPlano({
    catalogos: CATALOGOS_DE_TESTE,
    repositorio,
    executorDeIA: ia,
    leitorDoBrain: brain,
    avaliadorDeLimites: aprovaTudo,
    audit: { async record() {}, async list() { return []; }, async search() { return []; } },
  });
  const plano = await repositorio.criarPlano({ organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID }, 'aquisicao');
  assert.ok(plano.ok);
  const execucao = await repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
    planoId: plano.value.id,
    pedido: { tipo: 'criar', intencao: intencao as never },
    versaoBaseId: null,
    agentRunId: 'run-foco-1',
    solicitadoPor: 'pessoa-1',
    requestId: 'r',
  });
  assert.ok(execucao.ok);
  let final: Execucao | null = null;
  for (let i = 0; i < 30 && final === null; i += 1) {
    const reservada = await repositorio.reservarExecucao(ORGANIZACAO_ID, execucao.value.id, { leaseMs: 60_000, agora: new Date('2026-11-25T12:00:00Z') });
    const resumo = await motor.avancarExecucao(ORGANIZACAO_ID, execucao.value.id, { orcamentoMs: 10_000_000, ficha: reservada?.tentativas ?? 0 });
    if (resumo.execucao && ['concluida', 'falhou', 'cancelada'].includes(resumo.execucao.status)) final = resumo.execucao;
  }
  assert.ok(final);
  return { repositorio, ia, final };
}

describe('motor do plano: foco', () => {
  it('as entradas dos produtos do foco entram primeiro em toda chamada de redação, marcadas como foco, e a intenção original fica no plano', async () => {
    const lerProdutos: string[] = [];
    const brain: LeitorDoBrain = {
      async lerPacote() { return ok(pacoteDeTeste()); },
      async produtosDoContexto() { lerProdutos.push('lido'); return ok([PRODUTO]); },
    };
    const { repositorio, ia, final } = await rodar(brain, { ...planoCompleto().intencao, foco: FOCO });
    assert.equal(final.status, 'concluida', String(final.erroCodigo));
    const redacoes = ia.pedidos.filter((p) => p.tarefa === 'strategy_plan');
    assert.ok(redacoes.length > 0);
    for (const pedido of redacoes) {
      const entradas = (pedido.dados as { pacote: { entradas: { urn: string; foco?: boolean }[] } }).pacote.entradas;
      assert.equal(entradas[0]?.urn, URN_TENIS);
      assert.equal(entradas[0]?.foco, true);
      assert.equal(entradas.filter((e) => e.urn === URN_TENIS).length, 1);
    }
    const intencaoNoModelo = (redacoes[0]!.dados as { intencao: { foco: { produtos: { urn: string; rotulo: string }[] } } }).intencao.foco;
    assert.equal(intencaoNoModelo.produtos[0]?.rotulo, 'Tênis');
    assert.match(intencaoNoModelo.produtos[0]!.urn, /^e[1-9][0-9]*$/);
    const conteudo = repositorio.estado.versoes[0]!.conteudo as { intencao: { foco: unknown } };
    assert.deepEqual(conteudo.intencao.foco, FOCO);
    assert.ok(lerProdutos.length >= 1);
  });

  it('foco de marca não consulta produtos e o pacote segue sem entradas de foco', async () => {
    let consultou = false;
    const brain: LeitorDoBrain = {
      async lerPacote() { return ok(pacoteDeTeste()); },
      async produtosDoContexto() { consultou = true; return ok([PRODUTO]); },
    };
    const { ia, final } = await rodar(brain, { ...planoCompleto().intencao, foco: { tipo: 'marca' } });
    assert.equal(final.status, 'concluida');
    assert.equal(consultou, false);
    for (const pedido of ia.pedidos.filter((p) => p.tarefa === 'strategy_plan')) {
      assert.ok((pedido.dados as { pacote: { entradas: { foco?: boolean }[] } }).pacote.entradas.every((e) => e.foco === undefined));
    }
  });

  it('produtos do foco sem leitura disponível: falha transitória do Brain, sem chamar o modelo', async () => {
    const brain: LeitorDoBrain = {
      async lerPacote() { return ok(pacoteDeTeste()); },
      async produtosDoContexto() { return err({ codigo: 'brain_indisponivel', mensagem: 'fora' }); },
    };
    const { ia, final } = await rodar(brain, { ...planoCompleto().intencao, foco: FOCO });
    assert.equal(final.status, 'falhou');
    assert.equal(final.erroCodigo, 'brain_indisponivel');
    assert.equal(ia.pedidos.length, 0);
  });
});
