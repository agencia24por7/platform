import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import '../../../../shared/testing/registrarAlias.mjs';
import type { Executor, PedidoDeExecucao } from '@/modules/ia/application/execucao';
import type { PedidoDeIA } from '@/modules/strategy/application/portas';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { criarIaDaCamada, orcamentoDaCamada, codigoDeIaDaFalha, MARGEM_DA_CAMADA_MS } = await import('./iaDaCamada.ts');
const { ORCAMENTO_DA_IA } = await import('../../application/motorDoPlano.ts');
const { MENSAGEM_DO_BLOQUEIO } = await import('../../../ia/domain/modelos.ts');
const { COMITE_DA_ESTRATEGIA, GATE_DA_ESTRATEGIA, PLANO_DE_ESTRATEGIA } = await import('../../../ia/domain/tarefasInternas.ts');
const { SEM_MODELO_CONFIGURADO } = await import('../../../ia/application/execucao.ts');
const { TETO_DO_ORCAMENTO } = await import('../../../ia/domain/tarefa.ts');
const { TAREFAS_INTERNAS } = await import('../../../ia/domain/tarefasInternas.ts');
const { failure } = await import('../../../../shared/result/failure.ts');
const { ok, err } = await import('../../../../shared/result/result.ts');

const esquema = z.strictObject({ a: z.string() });
const pedido = (extra: Partial<PedidoDeIA<{ a: string }>> = {}): PedidoDeIA<{ a: string }> => ({
  tarefa: 'comite',
  instrucoes: 'faça isto',
  dados: { x: 1 },
  esquema,
  orcamento: { tokensMaximos: 5000, tempoMaximoMs: 90_000 },
  organizacaoId: 'org-1',
  clienteId: 'cli-1',
  execucaoId: 'abcdef12-0000',
  chaveDeIdempotencia: 'k',
  ...extra,
});

function falso(resposta: unknown) {
  const vistos: PedidoDeExecucao<unknown>[] = [];
  const executor = {
    async executar(p: PedidoDeExecucao<unknown>) {
      vistos.push(p);
      return resposta;
    },
  } as unknown as Executor;
  return { executor, vistos };
}

describe('iaDaCamada', () => {
  it('manda a tarefa registrada com o esquema e a instrução do pedido, só os dados do pedido, sem clienteId', async () => {
    const { executor, vistos } = falso(ok({ saida: { a: 'x' }, uso: { tokensDeEntrada: 3, tokensDeSaida: 4, passos: 1 } }));
    const r = await criarIaDaCamada(executor).executar(pedido());
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.value.uso, { tokensDeEntrada: 3, tokensDeSaida: 4 });
    const enviado = vistos[0]!;
    assert.equal(enviado.organizationId, 'org-1');
    assert.equal(enviado.tarefa.chave, 'comite');
    assert.equal(enviado.tarefa.saida, esquema);
    assert.equal(enviado.tarefa.instrucao, 'faça isto');
    assert.deepEqual(enviado.dados, { x: 1 });
    assert.deepEqual(Object.keys(enviado).sort(), ['dados', 'organizationId', 'requestId', 'tarefa']);
    assert.ok(enviado.requestId.length <= 64);
    assert.ok(!JSON.stringify(enviado).includes('cli-1'));
  });

  it('as três tarefas estão registradas para a tela /config/ia', () => {
    const chaves = TAREFAS_INTERNAS.map((t) => t.chave);
    for (const chave of ['strategy_plan', 'comite', 'gate']) assert.ok(chaves.includes(chave as never), chave);
  });

  it('orçamento sempre dentro do teto da camada', () => {
    const o = orcamentoDaCamada({ tokensMaximos: 60_000, tempoMaximoMs: 900_000 });
    assert.deepEqual(o, { passos: 1, tokensDeSaida: TETO_DO_ORCAMENTO.tokensDeSaida, tempoMs: TETO_DO_ORCAMENTO.tempoMs });
    assert.equal(orcamentoDaCamada({ tokensMaximos: 0, tempoMaximoMs: -5 }).tokensDeSaida, 1);
  });

  for (const [falha, codigo] of [
    [SEM_MODELO_CONFIGURADO, 'nao_configurada'],
    [failure('not_found', 'sem chave'), 'nao_configurada'],
    [failure('unauthorized', 'chave recusada'), 'nao_configurada'],
    [failure('rate_limited', MENSAGEM_DO_BLOQUEIO.teto_de_chamadas), 'limite_atingido'],
    [failure('rate_limited', MENSAGEM_DO_BLOQUEIO.teto_de_tokens), 'limite_atingido'],
    [failure('rate_limited', 'O fornecedor limitou as chamadas desta chave.'), 'falha_do_fornecedor'],
    [failure('forbidden', MENSAGEM_DO_BLOQUEIO.desligada), 'limite_atingido'],
    [failure('forbidden', 'O fornecedor de modelo desta tarefa não está habilitado na plataforma.'), 'nao_configurada'],
    [failure('validation', 'fora do formato'), 'saida_invalida'],
    [failure('unavailable', 'fornecedor fora'), 'falha_do_fornecedor'],
    [failure('conflict', 'x'), 'falha_do_fornecedor'],
  ] as const) {
    it(`mapeia ${falha.code} (${falha.message.slice(0, 20)}) para ${codigo}`, async () => {
      assert.equal(codigoDeIaDaFalha(falha), codigo);
      const r = await criarIaDaCamada(falso(err(falha)).executor).executar(pedido());
      assert.equal(!r.ok && r.error.codigo, codigo);
    });
  }

  it('mensagem do fornecedor não vaza em falha_do_fornecedor', async () => {
    const r = await criarIaDaCamada(falso(err(failure('unavailable', 'segredo-xyz'))).executor).executar(pedido());
    assert.ok(!r.ok && !r.error.mensagem.includes('segredo-xyz'));
  });

  it('o tempo enviado à camada deixa margem para o timeout do SDK disparar antes do prazo do nosso comValidacao', () => {
    assert.equal(orcamentoDaCamada({ tokensMaximos: 5000, tempoMaximoMs: 90_000 }).tempoMs, 90_000 - MARGEM_DA_CAMADA_MS);
    assert.equal(orcamentoDaCamada({ tokensMaximos: 5000, tempoMaximoMs: 5_000 }).tempoMs, 1000);
  });

  it('o orçamento enviado é o menor entre o do pedido e o da tarefa registrada', () => {
    const registrado = { passos: 1, tokensDeSaida: 2000, tempoMs: 20_000 };
    assert.deepEqual(orcamentoDaCamada({ tokensMaximos: 5000, tempoMaximoMs: 90_000 }, registrado), { passos: 1, tokensDeSaida: 2000, tempoMs: 20_000 });
    assert.deepEqual(orcamentoDaCamada({ tokensMaximos: 1000, tempoMaximoMs: 15_000 }, registrado), { passos: 1, tokensDeSaida: 1000, tempoMs: 5_000 });
  });

  it('os orçamentos do motor e os das tarefas registradas na camada não divergem', () => {
    const registradas = { strategy_plan: PLANO_DE_ESTRATEGIA, comite: COMITE_DA_ESTRATEGIA, gate: GATE_DA_ESTRATEGIA } as const;
    for (const [chave, tarefa] of Object.entries(registradas)) {
      const doMotor = ORCAMENTO_DA_IA[chave as keyof typeof ORCAMENTO_DA_IA];
      assert.equal(tarefa.orcamento.tokensDeSaida, doMotor.tokensMaximos, chave);
      assert.equal(tarefa.orcamento.tempoMs, doMotor.tempoMaximoMs, chave);
      assert.equal(tarefa.orcamento.passos, 1, chave);
    }
  });
});
