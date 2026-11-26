import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import '../../../../shared/testing/registrarAlias.mjs';
import type { ExecutorDeIA, PedidoDeIA } from '@/modules/strategy/application/portas';

const { ok, err } = await import('../../../../shared/result/result.ts');
const { comValidacao } = await import('./comValidacao.ts');
const { criarIaFalsa } = await import('./iaFalsa.ts');
const { criarIaNaoConfigurada } = await import('./iaNaoConfigurada.ts');

const esquema = z.strictObject({ resposta: z.string() });

const pedido = (sobrescrita: Partial<PedidoDeIA<{ resposta: string }>> = {}): PedidoDeIA<{ resposta: string }> => ({
  tarefa: 'strategy_plan',
  instrucoes: 'faça',
  dados: { a: 1 },
  esquema,
  orcamento: { tokensMaximos: 1000, tempoMaximoMs: 200 },
  organizacaoId: 'org',
  clienteId: 'cli',
  execucaoId: 'run-1',
  chaveDeIdempotencia: 'k1',
  ...sobrescrita,
});

describe('iaNaoConfigurada', () => {
  it('sempre devolve nao_configurada', async () => {
    const resultado = await criarIaNaoConfigurada().executar(pedido());
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.error.codigo, 'nao_configurada');
  });
});

describe('iaFalsa', () => {
  it('devolve a saída do roteiro validada e registra os pedidos', async () => {
    const ia = criarIaFalsa(() => ({ resposta: 'oi' }));
    const resultado = await ia.executar(pedido());
    assert.ok(resultado.ok);
    if (resultado.ok) assert.deepEqual(resultado.value.saida, { resposta: 'oi' });
    assert.equal(ia.pedidos.length, 1);
    assert.equal(ia.pedidos[0]?.execucaoId, 'run-1');
    ia.limpar();
    assert.equal(ia.pedidos.length, 0);
  });

  it('saída fora do esquema vira saida_invalida', async () => {
    const resultado = await criarIaFalsa(() => ({ resposta: 1 })).executar(pedido());
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.error.codigo, 'saida_invalida');
  });

  it('o roteiro pode devolver um erro tipado', async () => {
    const resultado = await criarIaFalsa(() => ({ codigo: 'limite_atingido', mensagem: 'x' })).executar(pedido());
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.error.codigo, 'limite_atingido');
  });

  it('é determinística: mesmo pedido, mesma saída', async () => {
    const ia = criarIaFalsa((p) => ({ resposta: p.tarefa }));
    const a = await ia.executar(pedido());
    const b = await ia.executar(pedido());
    assert.deepEqual(a, b);
  });
});

describe('comValidacao', () => {
  it('revalida a saída e não confia no adaptador', async () => {
    const adaptadorMentiroso: ExecutorDeIA = {
      async executar<T>() {
        return ok({ saida: { resposta: 42 } as unknown as T, uso: { tokensDeEntrada: 1, tokensDeSaida: 1 } });
      },
    };
    const resultado = await comValidacao(adaptadorMentiroso).executar(pedido());
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.error.codigo, 'saida_invalida');
  });

  it('passa a saída válida e o uso', async () => {
    const resultado = await comValidacao(criarIaFalsa(() => ({ resposta: 'ok' }))).executar(pedido());
    assert.ok(resultado.ok);
    if (resultado.ok) assert.equal(resultado.value.saida.resposta, 'ok');
  });

  it('exceção do adaptador vira falha_do_fornecedor', async () => {
    const quebrado: ExecutorDeIA = {
      async executar() {
        throw new Error('segredo-do-fornecedor');
      },
    };
    const resultado = await comValidacao(quebrado).executar(pedido());
    assert.equal(resultado.ok, false);
    if (!resultado.ok) {
      assert.equal(resultado.error.codigo, 'falha_do_fornecedor');
      assert.ok(!resultado.error.mensagem.includes('segredo'));
    }
  });

  it('adaptador que devolve lixo não escapa como exceção', async () => {
    const lixo = { async executar() { return null; } } as unknown as ExecutorDeIA;
    const resultado = await comValidacao(lixo).executar(pedido());
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.error.codigo, 'falha_do_fornecedor');
  });

  it('aplica o tempo máximo', async () => {
    const lento: ExecutorDeIA = {
      executar: () => new Promise((resolver) => setTimeout(() => resolver(ok({ saida: { resposta: 'tarde' } as never, uso: { tokensDeEntrada: 0, tokensDeSaida: 0 } })), 300)),
    };
    const resultado = await comValidacao(lento).executar(pedido({ orcamento: { tokensMaximos: 1, tempoMaximoMs: 20 } }));
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.error.codigo, 'tempo_esgotado');
  });

  it('propaga o erro tipado do adaptador', async () => {
    const limitado: ExecutorDeIA = { async executar() { return err({ codigo: 'limite_atingido', mensagem: 'x' }); } };
    const resultado = await comValidacao(limitado).executar(pedido());
    assert.equal(resultado.ok, false);
    if (!resultado.ok) assert.equal(resultado.error.codigo, 'limite_atingido');
  });
});

describe('sinal de aborto', () => {
  it('comValidacao aborta o pedido ao adaptador quando o tempo máximo estoura', async () => {
    let sinalRecebido: AbortSignal | undefined;
    const lento: ExecutorDeIA = {
      executar: (p) => {
        sinalRecebido = p.sinal;
        return new Promise((resolver) => setTimeout(() => resolver(ok({ saida: { resposta: 'tarde' } as never, uso: { tokensDeEntrada: 0, tokensDeSaida: 0 } })), 300));
      },
    };
    const resultado = await comValidacao(lento).executar(pedido({ orcamento: { tokensMaximos: 1, tempoMaximoMs: 20 } }));
    assert.equal(resultado.ok, false);
    assert.ok(sinalRecebido, 'o adaptador recebe um sinal');
    assert.equal(sinalRecebido?.aborted, true);
  });

  it('sem estouro o sinal não é abortado', async () => {
    let sinalRecebido: AbortSignal | undefined;
    const rapido: ExecutorDeIA = {
      async executar(p) {
        sinalRecebido = p.sinal;
        return ok({ saida: { resposta: 'oi' } as never, uso: { tokensDeEntrada: 0, tokensDeSaida: 0 } });
      },
    };
    const resultado = await comValidacao(rapido).executar(pedido());
    assert.ok(resultado.ok);
    assert.equal(sinalRecebido?.aborted, false);
  });

  it('o sinal do pedido original também aborta', async () => {
    const externo = new AbortController();
    let sinalRecebido: AbortSignal | undefined;
    const espera: ExecutorDeIA = {
      executar: (p) => {
        sinalRecebido = p.sinal;
        externo.abort();
        return new Promise(() => undefined);
      },
    };
    const corrida = comValidacao(espera).executar(pedido({ sinal: externo.signal, orcamento: { tokensMaximos: 1, tempoMaximoMs: 30 } }));
    await corrida;
    assert.equal(sinalRecebido?.aborted, true);
  });

  it('iaFalsa respeita o sinal: abortado antes ou durante, devolve tempo_esgotado', async () => {
    const antes = new AbortController();
    antes.abort();
    const ia = criarIaFalsa(() => ({ resposta: 'oi' }));
    const r1 = await ia.executar(pedido({ sinal: antes.signal }));
    assert.equal(!r1.ok && r1.error.codigo, 'tempo_esgotado');
    const durante = new AbortController();
    const iaLenta = criarIaFalsa(async () => {
      durante.abort();
      return { resposta: 'oi' };
    });
    const r2 = await iaLenta.executar(pedido({ sinal: durante.signal }));
    assert.equal(!r2.ok && r2.error.codigo, 'tempo_esgotado');
  });
});
