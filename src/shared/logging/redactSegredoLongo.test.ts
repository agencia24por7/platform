import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redact, redactText } from './redact.ts';

const SEGREDO = 'S3cr3tValorQueNaoPodeVazar0123456789abcdef';
const BORDA = 4096;
const LIMITE_MS = 250;

const preenchimento = (tamanho: number) => 'x '.repeat(Math.ceil(tamanho / 2)).slice(0, tamanho);

function semNenhumPedaco(saida: string, segredo: string): void {
  for (let inicio = 0; inicio + 6 <= segredo.length; inicio += 3) {
    assert.ok(!saida.includes(segredo.slice(inicio, inicio + 6)), `vazou: ${segredo.slice(inicio, inicio + 6)}`);
  }
}

describe('segredos longos saem inteiros redigidos', () => {
  it('Bearer de 3000 caracteres', () => {
    const segredo = 'A1b2'.repeat(750);
    assert.equal(redactText(`Bearer ${segredo}`), '[redigido]');
  });

  it('ya29 de 600 caracteres', () => {
    const segredo = 'Qw3r'.repeat(150);
    assert.equal(redactText(`ya29.${segredo}`), '[redigido]');
  });

  it('GOCSPX longo', () => {
    assert.equal(redactText(`GOCSPX-${'Zy9k'.repeat(150)}`), '[redigido]');
  });

  it('JWT com segmento de 3000 caracteres', () => {
    const jwt = `eyJ${'a1B2'.repeat(750)}.${'b'.repeat(20)}.${'c'.repeat(20)}`;
    assert.equal(redactText(jwt), '[redigido]');
  });

  it('Bearer com 20 espaços antes do token', () => {
    assert.equal(redactText(`Bearer${' '.repeat(20)}${SEGREDO}`), '[redigido]');
  });
});

describe('segredo que cruza a fronteira de corte', () => {
  const casos: Record<string, string> = {
    'client_secret em JSON sem aspa de fechamento': `${preenchimento(BORDA - 20)} "client_secret":"${SEGREDO}"`,
    'developer_token em JSON': `${preenchimento(BORDA - 25)} "developer_token":"${SEGREDO}"`,
    'Bearer': `${preenchimento(BORDA - 12)} Bearer ${SEGREDO}`,
    'ya29 curto': `${preenchimento(BORDA - 13)} ya29${SEGREDO}`,
    'GOCSPX curto': `${preenchimento(BORDA - 15)} GOCSPX-${SEGREDO}`,
    'JWT com terceiro segmento curto': `${preenchimento(BORDA - 40)} eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0.${SEGREDO}`,
  };

  for (const [nome, texto] of Object.entries(casos)) {
    it(nome, () => semNenhumPedaco(redactText(texto), SEGREDO));
  }

  it('e-mail cortado no meio', () => {
    const saida = redactText(`${preenchimento(BORDA - 8)} joao.silva@empresa.com.br`);
    assert.ok(!saida.includes('joao.silva'));
    assert.ok(!saida.includes('empresa'));
  });

  it('a saída respeita o teto de tamanho', () => {
    assert.ok(redactText('x'.repeat(100_000)).length <= BORDA);
  });
});

describe('referências compartilhadas', () => {
  function dag(ramos: number, niveis: number): unknown {
    let no: unknown = { folha: 'x' };
    for (let nivel = 0; nivel < niveis; nivel += 1) {
      const pai: Record<string, unknown> = {};
      for (let ramo = 0; ramo < ramos; ramo += 1) pai[`f${ramo}`] = no;
      no = pai;
    }
    return no;
  }

  for (const ramos of [3, 4, 10]) {
    it(`DAG com ${ramos} ramos em 9 níveis termina rápido e marca truncado`, () => {
      const inicio = process.hrtime.bigint();
      const saida = JSON.stringify(redact(dag(ramos, 9)));
      assert.ok(Number(process.hrtime.bigint() - inicio) / 1_000_000 < LIMITE_MS);
      if (ramos >= 4) assert.ok(saida.includes('[truncado]'));
    });
  }

  it('ciclo e profundidade continuam marcados', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    assert.deepEqual(redact(circular), { self: '[circular]' });
  });
});

describe('campos de Error', () => {
  it('só name, message e stack saem; detail e code do banco ficam de fora', () => {
    const erro = Object.assign(new Error('falha'), { code: '23505', detail: 'Key (email)=(ana@b.com) already exists.', where: 'coluna=valor' });
    const saida = redact(erro) as Record<string, string>;
    assert.deepEqual(Object.keys(saida).sort(), ['message', 'name', 'stack']);
    assert.ok(!JSON.stringify(saida).includes('already exists'));
  });
});
