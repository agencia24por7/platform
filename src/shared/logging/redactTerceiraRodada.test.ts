import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactText } from './redact.ts';

const BORDA_DA_REDACAO = 8192;
const LIMITE_MS = 50;
const LIMITE_DE_CRESCIMENTO = 9;
const TAMANHO_BASE = 2048;
const REPETICOES_POR_AMOSTRA = 40;

const MEDICOES = 5;

function medirUmaVezMs(trabalho: () => unknown): number {
  const inicio = process.hrtime.bigint();
  trabalho();
  return Number(process.hrtime.bigint() - inicio) / 1_000_000;
}

function medirMs(trabalho: () => unknown): number {
  return Math.min(...Array.from({ length: MEDICOES }, () => medirUmaVezMs(trabalho)));
}

function custoPorChamadaMs(texto: string): number {
  const amostra = () => {
    for (let repeticao = 0; repeticao < REPETICOES_POR_AMOSTRA; repeticao++) redactText(texto);
  };
  return medirMs(amostra) / REPETICOES_POR_AMOSTRA;
}

function crescimentoAteABorda(unidade: string): number {
  const comTamanho = (caracteres: number) => unidade.repeat(Math.ceil(caracteres / unidade.length));
  return custoPorChamadaMs(comTamanho(BORDA_DA_REDACAO)) / custoPorChamadaMs(comTamanho(TAMANHO_BASE));
}

describe('encolhimento pela redação não expõe o que passou da borda', () => {
  const grande = `Bearer ${'A'.repeat(4500)} `;
  const casos: Record<string, string> = {
    'ya29 curto na borda': `ya29SEGREDO1234567890`,
    'e-mail na borda': ` joao.silva@empresa.com.br`,
    'Bearer curto na borda': `Bearer SEGREDO1234567890`,
    'GOCSPX na borda': `GOCSPX-SEGREDO1234567890`,
  };

  for (const [nome, final] of Object.entries(casos)) {
    it(nome, () => {
      const texto = grande + 'x'.repeat(BORDA_DA_REDACAO - 16 - grande.length) + ` ${final}`;
      const saida = redactText(texto);
      assert.ok(!/SEGREDO|joao|empresa/.test(saida), saida.slice(-60));
    });
  }

  it('sem encolhimento a saída continua com o teto de 4096', () => {
    assert.equal(redactText('x'.repeat(10_000)).length, 4096);
  });
});

describe('e-mail fora do formato curto', () => {
  it('parte local com mais de 64 caracteres é redigida', () => {
    const saida = redactText(`${'a'.repeat(70)}@exemplo.com`);
    assert.ok(!saida.includes('aaaaa'), saida);
  });

  it('TLD com mais de 24 caracteres é redigido', () => {
    const saida = redactText(`joao@exemplo.${'a'.repeat(30)}`);
    assert.ok(!saida.includes('joao'), saida);
  });

  it('e-mail normal continua igual', () => {
    assert.equal(redactText('fulano@exemplo.com.br'), 'f***@exemplo.com.br');
  });

  it('não é quadrático', () => {
    assert.ok(medirMs(() => redactText('a.'.repeat(4000))) < LIMITE_MS);
    assert.ok(medirMs(() => redactText(`${'a'.repeat(8000)}@`)) < LIMITE_MS);
  });
});

describe('JWT', () => {
  it('eyJa- repetido não é quadrático', () => {
    const crescimento = crescimentoAteABorda('eyJa-');
    assert.ok(crescimento < LIMITE_DE_CRESCIMENTO, `custo cresceu ${crescimento.toFixed(1)}x ao quadruplicar a entrada`);
  });

  it('JWT real continua redigido', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV';
    assert.equal(redactText(`token ${jwt} fim`), 'token [redigido] fim');
  });
});

describe('quarta rodada', () => {
  it('não apaga o contexto legítimo antes de um segredo gigante', () => {
    const saida = redactText(`ERRO importante id=42 Bearer ${'A'.repeat(5000)} ${'x'.repeat(4000)}`);
    assert.ok(saida.startsWith('ERRO importante id=42 [redigido]'), saida.slice(0, 80));
    assert.ok(!saida.includes('AAAA'));
  });

  it('segredo que cruza a posição 4096 é redigido e nada depois dele sai', () => {
    const saida = redactText(`${'x '.repeat(2040)}Bearer ${'B'.repeat(3000)} DEPOIS-DO-SEGREDO ${'y'.repeat(6000)}`);
    assert.ok(!saida.includes('BBBB'));
    assert.ok(!saida.includes('DEPOIS'));
  });

  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV';
  const prefixos = ['-', '_', 'Bearer%20', '%22', '%3D', '"', '='];
  for (const prefixo of prefixos) {
    it(`JWT precedido de ${prefixo}`, () => {
      const saida = redactText(`${prefixo}${jwt}`);
      assert.ok(!saida.includes('eyJzdWI'), saida);
      assert.ok(!saida.includes('SflKxw'), saida);
    });
  }

  for (const [nome, unidade] of [['eyJa-', 'eyJa-'], ['eyJ.', 'eyJ.'], ['eyJeyJ', 'eyJeyJ']] as const) {
    it(`desempenho linear com ${nome}`, () => {
      const crescimento = crescimentoAteABorda(unidade);
      assert.ok(crescimento < LIMITE_DE_CRESCIMENTO, `custo cresceu ${crescimento.toFixed(1)}x ao quadruplicar a entrada`);
    });
  }
});
