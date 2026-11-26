import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import { CHECAGENS_EM_CODIGO } from './registro.ts';
import { MAXIMO_DE_LOCAIS, MAXIMO_DO_MOTIVO, aprovar, montarResultado, type Checagem } from './resultado.ts';
import { payloadDoGate, rodarGates } from './rodarGates.ts';

const verdadeira: Checagem = { chave: 'ok', executar: () => aprovar('ok', 'passou') };

describe('rodarGates', () => {
  it('registra as onze checagens (nove do ADR 0062 §7, o Comitê completo e o não faremos preservado), com chaves únicas', () => {
    const chaves = CHECAGENS_EM_CODIGO.map((c) => c.chave);
    assert.equal(chaves.length, 11);
    assert.equal(new Set(chaves).size, 11);
  });

  it('aprova o plano completo quando todas aprovam', () => {
    const v = rodarGates(contextoDeTeste());
    assert.equal(v.resultado, 'aprovado');
    assert.deepEqual(v.pendencias, []);
    assert.equal(v.checagens.length, 11);
    assert.ok(v.checagens.every((c) => c.resultado === 'aprovado'));
  });

  it('reprova se uma checagem reprova', () => {
    const contexto = contextoDeTeste({ avaliarLimite: () => 'bloqueia' });
    const v = rodarGates(contexto);
    assert.equal(v.resultado, 'reprovado');
    assert.equal(v.pendencias.length, 1);
    assert.ok(v.pendencias[0]?.startsWith('limites_do_cliente'));
  });

  it('falha fechada: exceção vira nao_rodou e o veredito reprova', () => {
    const quebrada: Checagem = {
      chave: 'quebrada',
      executar: () => {
        throw new TypeError('boom');
      },
    };
    const v = rodarGates(contextoDeTeste(), [verdadeira, quebrada]);
    assert.equal(v.resultado, 'reprovado');
    assert.equal(v.checagens[1]?.resultado, 'nao_rodou');
    assert.equal(v.checagens[1]?.chave, 'quebrada');
    assert.ok(v.checagens[1]?.motivo.includes('TypeError'));
  });

  it('avaliador de limite que lança deixa a checagem em nao_rodou e as outras rodam', () => {
    const v = rodarGates(
      contextoDeTeste({
        avaliarLimite: () => {
          throw new Error('indisponível');
        },
      }),
    );
    assert.equal(v.resultado, 'reprovado');
    assert.equal(v.checagens.find((c) => c.chave === 'limites_do_cliente')?.resultado, 'nao_rodou');
    assert.equal(v.checagens.filter((c) => c.resultado === 'aprovado').length, 10);
  });

  it('checagem que devolve resultado fora do contrato é nao_rodou', () => {
    const torta = { chave: 'torta', executar: () => ({ chave: 'torta', resultado: 'talvez', motivo: '', onde: [] }) } as unknown as Checagem;
    assert.equal(rodarGates(contextoDeTeste(), [torta]).checagens[0]?.resultado, 'nao_rodou');
  });

  it('sem nenhuma checagem não aprova', () => {
    assert.equal(rodarGates(contextoDeTeste(), []).resultado, 'reprovado');
  });

  it('acrescentar checagem é um item no registro', () => {
    const extra: Checagem = { chave: 'extra', executar: () => montarResultado('extra', 'reprovado', 'não', ['x']) };
    const v = rodarGates(contextoDeTeste(), [...CHECAGENS_EM_CODIGO, extra]);
    assert.equal(v.resultado, 'reprovado');
    assert.equal(v.checagens.length, 12);
  });

  it('sem pareceres no contexto o veredito geral reprova', () => {
    const v = rodarGates({ ...contextoDeTeste(), pareceres: undefined });
    assert.equal(v.resultado, 'reprovado');
    assert.ok(v.pendencias.some((p) => p.startsWith('comite_completo')));
  });

  it('motivo e locais são limitados para caber no payload de 16 KB', () => {
    const r = montarResultado('x', 'reprovado', 'm'.repeat(5000), Array.from({ length: 500 }, (_, i) => `local_${i}`));
    assert.ok(r.motivo.length <= MAXIMO_DO_MOTIVO);
    assert.equal(r.onde.length, MAXIMO_DE_LOCAIS);
    assert.ok(r.onde.at(-1)?.startsWith('+'));
    const v = rodarGates(contextoDeTeste(), Array.from({ length: 9 }, (_, i) => ({ chave: `c${i}`, executar: () => r })));
    assert.ok(new TextEncoder().encode(JSON.stringify(payloadDoGate(v))).length < 16384);
  });

  it('payload do gate traz só aprovado ou reprovado, como o banco exige', () => {
    assert.ok(['aprovado', 'reprovado'].includes(payloadDoGate(rodarGates(contextoDeTeste())).resultado));
  });
});
