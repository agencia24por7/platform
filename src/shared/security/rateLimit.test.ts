import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import {
  DOMINIOS_DE_LIMITE,
  TETO_POR_DOMINIO,
  consume,
  consumeAll,
  criarLimitadorDeTaxa,
  forget,
  type DominioDeLimite,
} from './rateLimit.ts';

function relogio(inicio = 1_000_000) {
  let instante = inicio;
  return {
    agora: () => instante,
    avancar: (ms: number) => {
      instante += ms;
    },
  };
}

describe('consume', () => {
  it('libera até o limite e bloqueia depois', () => {
    const key = `teste-${Math.random()}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.ok(consume('worker', key, 3, 60_000).allowed, `tentativa ${attempt} deveria passar`);
    }
    const blocked = consume('worker', key, 3, 60_000);
    assert.ok(!blocked.allowed);
    assert.ok(blocked.retryAfterSeconds > 0);
    forget('worker', key);
  });

  it('conta cada chave de forma independente', () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    consume('ip', a, 1, 60_000);
    assert.ok(!consume('ip', a, 1, 60_000).allowed);
    assert.ok(consume('ip', b, 1, 60_000).allowed);
    forget('ip', a);
    forget('ip', b);
  });

  it('a mesma chave em domínios diferentes são baldes diferentes', () => {
    const limitador = criarLimitadorDeTaxa();
    assert.ok(limitador.consume('webhook', 'igual', 1, 60_000).allowed);
    assert.ok(!limitador.consume('webhook', 'igual', 1, 60_000).allowed);
    assert.ok(limitador.consume('worker', 'igual', 1, 60_000).allowed);
  });

  it('reabre depois da janela', () => {
    const tempo = relogio();
    const limitador = criarLimitadorDeTaxa({ agora: tempo.agora });
    assert.ok(limitador.consume('worker', 'janela', 1, 20).allowed);
    assert.ok(!limitador.consume('worker', 'janela', 1, 20).allowed);
    tempo.avancar(21);
    assert.ok(limitador.consume('worker', 'janela', 1, 20).allowed);
  });

  it('informa quanto resta', () => {
    const limitador = criarLimitadorDeTaxa();
    assert.equal(limitador.consume('cofre', 'resta', 5, 60_000).remaining, 4);
    assert.equal(limitador.consume('cofre', 'resta', 5, 60_000).remaining, 3);
  });
});

describe('isolamento por domínio', () => {
  it('lotar o domínio anônimo não tira vaga de worker, cofre e alertas, nem depois que os baldes deles vencem', () => {
    const tempo = relogio();
    const lotados: DominioDeLimite[] = [];
    const limitador = criarLimitadorDeTaxa({ agora: tempo.agora, aoLotar: (dominio) => lotados.push(dominio) });

    assert.ok(limitador.consume('worker', 'worker:fp', 120, 60_000).allowed);
    assert.ok(limitador.consume('cofre', 'tokens:conexao:1', 30, 60_000).allowed);
    assert.ok(limitador.consume('alertas', 'alertas:novos', 60, 3_600_000).allowed);

    const inundacao = TETO_POR_DOMINIO.webhook + 500;
    for (let i = 0; i < inundacao; i += 1) {
      assert.ok(limitador.consume('webhook', `zapi:token-forjado-${i}`, 60, 600_000).allowed);
    }
    assert.equal(limitador.tamanho('webhook'), TETO_POR_DOMINIO.webhook);
    assert.deepEqual(lotados, ['webhook']);

    tempo.avancar(3_600_001);
    for (let i = 0; i < inundacao; i += 1) limitador.consume('webhook', `zapi:segunda-onda-${i}`, 60, 600_000);

    assert.ok(limitador.consume('worker', 'worker:fp', 120, 60_000).allowed, 'balde vencido do worker reabre');
    assert.ok(limitador.consume('cofre', 'tokens:conexao:1', 30, 60_000).allowed);
    assert.ok(limitador.consume('alertas', 'alertas:novos', 60, 3_600_000).allowed);
    assert.ok(limitador.consume('worker', 'worker:outro-fp', 120, 60_000).allowed, 'chave nova do worker também entra');
    assert.equal(limitador.tamanho('worker'), 2);
  });

  it('todo domínio declarado tem teto positivo', () => {
    for (const dominio of DOMINIOS_DE_LIMITE) assert.ok(TETO_POR_DOMINIO[dominio] >= 1, dominio);
  });

  it('teto inválido é recusado na criação', () => {
    assert.throws(() => criarLimitadorDeTaxa({ tetos: { publico: 0 } }), RangeError);
  });
});

describe('domínio lotado', () => {
  it('despeja o balde mais antigo do domínio e só ele', () => {
    const tempo = relogio();
    const limitador = criarLimitadorDeTaxa({ agora: tempo.agora, tetos: { publico: 3 } });

    limitador.consume('publico', 'a', 1, 60_000);
    limitador.consume('publico', 'b', 1, 60_000);
    limitador.consume('publico', 'c', 1, 60_000);
    limitador.consume('publico', 'd', 1, 60_000);

    assert.equal(limitador.tamanho('publico'), 3);
    assert.ok(limitador.consume('publico', 'a', 1, 60_000).allowed, 'a, o mais antigo, foi despejado e recomeça');
    assert.ok(!limitador.consume('publico', 'c', 1, 60_000).allowed, 'c segue contando');
    assert.ok(!limitador.consume('publico', 'd', 1, 60_000).allowed, 'd segue contando');
  });

  it('balde consultado volta para o fim da fila, inclusive quando é barrado', () => {
    const tempo = relogio();
    const limitador = criarLimitadorDeTaxa({ agora: tempo.agora, tetos: { ip: 3 } });

    assert.ok(limitador.consume('ip', 'abusador', 1, 60_000).allowed);
    limitador.consume('ip', 'x', 1, 60_000);
    limitador.consume('ip', 'y', 1, 60_000);
    assert.ok(!limitador.consume('ip', 'abusador', 1, 60_000).allowed);
    limitador.consume('ip', 'z', 1, 60_000);

    assert.ok(!limitador.consume('ip', 'abusador', 1, 60_000).allowed, 'quem segue batendo não é o mais antigo e não é despejado');
    assert.ok(limitador.consume('ip', 'x', 1, 60_000).allowed, 'x, parado, foi o despejado');
  });

  it('avisa a lotação no máximo uma vez por intervalo e por domínio, e não avisa quando o despejado já venceu', () => {
    const tempo = relogio();
    const lotados: DominioDeLimite[] = [];
    const limitador = criarLimitadorDeTaxa({
      agora: tempo.agora,
      tetos: { publico: 2, ip: 2 },
      intervaloDoAvisoMs: 60_000,
      aoLotar: (dominio) => lotados.push(dominio),
    });

    for (let i = 0; i < 10; i += 1) limitador.consume('publico', `p${i}`, 5, 600_000);
    for (let i = 0; i < 10; i += 1) limitador.consume('ip', `i${i}`, 5, 600_000);
    assert.deepEqual(lotados, ['publico', 'ip']);

    tempo.avancar(60_001);
    limitador.consume('publico', 'mais-um', 5, 600_000);
    assert.deepEqual(lotados, ['publico', 'ip', 'publico']);

    const silencioso: DominioDeLimite[] = [];
    const curto = criarLimitadorDeTaxa({ agora: tempo.agora, tetos: { relato: 1 }, aoLotar: (d) => silencioso.push(d) });
    curto.consume('relato', 'velho', 5, 10);
    tempo.avancar(11);
    curto.consume('relato', 'novo', 5, 10);
    assert.deepEqual(silencioso, []);
  });
});

test('a cobrança é tudo-ou-nada entre os baldes do mesmo pedido, inclusive entre domínios', () => {
  const limitador = criarLimitadorDeTaxa();
  const par = [
    { dominio: 'publico', key: 'par:a', limit: 10 },
    { dominio: 'ip', key: 'par:b', limit: 3 },
  ] as const;
  for (let i = 0; i < 3; i += 1) limitador.consumeAll(par, 60_000);

  const barrado = limitador.consumeAll(par, 60_000);
  assert.equal(barrado.allowed, false, 'o balde menor precisa barrar o pedido inteiro');

  const sozinho = limitador.consume('publico', 'par:a', 10, 60_000);
  assert.equal(
    sozinho.remaining,
    10 - 3 - 1,
    'o balde maior tinha de estar em 3 quando o pedido barrado passou por ele: cobrado, estaria em 4 e a sobra seria menor',
  );
});

test('pedido barrado não cria balde novo', () => {
  const limitador = criarLimitadorDeTaxa();
  limitador.consume('ip', 'ip:1', 1, 60_000);
  const barrado = limitador.consumeAll(
    [
      { dominio: 'ip', key: 'ip:1', limit: 1 },
      { dominio: 'publico', key: 'credencial:forjada', limit: 120 },
    ],
    60_000,
  );
  assert.equal(barrado.allowed, false);
  assert.equal(limitador.tamanho('publico'), 0);
});

test('o limitador do processo aceita pedidos de vários domínios', () => {
  const veredito = consumeAll(
    [
      { dominio: 'ip', key: `processo:${Math.random()}`, limit: 2 },
      { dominio: 'relato', key: `processo:${Math.random()}`, limit: 5 },
    ],
    60_000,
  );
  assert.equal(veredito.allowed, true);
  assert.equal(veredito.remaining, 1);
});

describe('existe, renovar e devolver', () => {
  it('existe não cria balde nem incrementa', () => {
    const limitador = criarLimitadorDeTaxa();
    assert.equal(limitador.existe('validadas', 'nunca-vista'), false);
    assert.equal(limitador.tamanho('validadas'), 0);
    limitador.consume('ip', 'k', 2, 60_000);
    for (let i = 0; i < 50; i += 1) assert.equal(limitador.existe('ip', 'k'), true);
    assert.ok(limitador.consume('ip', 'k', 2, 60_000).allowed, 'existe não gastou a segunda vaga');
  });

  it('renovar estende a vida e vencido deixa de existir', () => {
    const tempo = relogio();
    const limitador = criarLimitadorDeTaxa({ agora: tempo.agora });
    limitador.renovar('validadas', 'v', 1_000);
    tempo.avancar(900);
    limitador.renovar('validadas', 'v', 1_000);
    tempo.avancar(900);
    assert.equal(limitador.existe('validadas', 'v'), true);
    tempo.avancar(101);
    assert.equal(limitador.existe('validadas', 'v'), false);
    assert.equal(limitador.tamanho('validadas'), 0);
  });

  it('balde que só é tocado por existe não envelhece na fila', () => {
    const limitador = criarLimitadorDeTaxa({ tetos: { validadas: 3 } });
    limitador.renovar('validadas', 'legitima', 60_000);
    for (let i = 0; i < 100; i += 1) {
      assert.ok(limitador.existe('validadas', 'legitima'));
      limitador.renovar('validadas', `outra-${i}`, 60_000);
    }
    assert.ok(limitador.existe('validadas', 'legitima'));
    assert.equal(limitador.tamanho('validadas'), 3);
  });

  it('devolver tira a cobrança do recibo e nunca passa de zero', () => {
    const limitador = criarLimitadorDeTaxa();
    const { veredito, recibo } = limitador.cobrarComRecibo('ip', 'd', 1, 60_000);
    assert.ok(veredito.allowed && recibo);
    assert.ok(!limitador.consume('ip', 'd', 1, 60_000).allowed);
    limitador.devolver(recibo);
    assert.ok(limitador.consume('ip', 'd', 1, 60_000).allowed);
    assert.ok(!limitador.consume('ip', 'd', 1, 60_000).allowed);
    limitador.devolver(recibo);
    assert.ok(!limitador.consume('ip', 'd', 1, 60_000).allowed, 'recibo usado não credita de novo');
    limitador.devolver({ dominio: 'ip', key: 'inexistente', serie: 0 });
    assert.equal(limitador.existe('ip', 'inexistente'), false);
  });

  it('recibo de um balde despejado não credita o balde recriado com a mesma chave no mesmo instante', () => {
    const limitador = criarLimitadorDeTaxa({ agora: () => 1_000, tetos: { ip: 1 } });
    const { recibo } = limitador.cobrarComRecibo('ip', 'a', 2, 60_000);
    limitador.consume('ip', 'b', 2, 60_000);
    limitador.consume('ip', 'a', 2, 60_000);
    limitador.consume('ip', 'a', 2, 60_000);
    if (recibo) limitador.devolver(recibo);
    assert.equal(limitador.consume('ip', 'a', 2, 60_000).allowed, false);
  });

  it('cobrança barrada não dá recibo', () => {
    const limitador = criarLimitadorDeTaxa();
    limitador.consume('ip', 'cheio', 1, 60_000);
    const { veredito, recibo } = limitador.cobrarComRecibo('ip', 'cheio', 1, 60_000);
    assert.equal(veredito.allowed, false);
    assert.equal(recibo, null);
  });

  it('recibo de uma janela não credita o balde da janela seguinte', () => {
    const tempo = relogio();
    const limitador = criarLimitadorDeTaxa({ agora: tempo.agora });
    const recibos = Array.from({ length: 59 }, () => limitador.cobrarComRecibo('ip', 'virada', 60, 60_000).recibo);
    tempo.avancar(60_001);
    for (let i = 0; i < 60; i += 1) assert.ok(limitador.consume('ip', 'virada', 60, 60_000).allowed);
    for (const recibo of recibos) if (recibo) limitador.devolver(recibo);
    assert.equal(limitador.consume('ip', 'virada', 60, 60_000).allowed, false, 'a janela nova segue com 60, sem crédito da antiga');
  });
});
