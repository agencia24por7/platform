import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import { planoCompleto } from '../domain/fixturesDeTeste.ts';

const { EditarManualSchema, PedirMudancaSchema, PedirPlanoSchema, VersaoAlvoSchema } = await import('./estrategiaEntradas.ts');

const CLIENTE = '22222222-2222-4222-8222-222222222222';

describe('entradas do módulo de estratégia', () => {
  it('PedirPlano aceita a intenção do domínio e tipo de lista fechada', () => {
    const entrada = { clienteId: CLIENTE, tipoDePlano: 'aquisicao', intencao: planoCompleto().intencao };
    assert.ok(PedirPlanoSchema.safeParse(entrada).success);
    assert.equal(PedirPlanoSchema.safeParse({ ...entrada, tipoDePlano: 'outro' }).success, false);
    assert.equal(PedirPlanoSchema.safeParse({ ...entrada, extra: 1 }).success, false);
    assert.equal(PedirPlanoSchema.safeParse({ ...entrada, clienteId: 'x' }).success, false);
  });

  it('PedirPlano recusa intenção fora do esquema', () => {
    const entrada = { clienteId: CLIENTE, tipoDePlano: 'marca', intencao: { objetivo: 'x' } };
    assert.equal(PedirPlanoSchema.safeParse(entrada).success, false);
  });

  it('PedirMudanca apara, exige 3 caracteres e limita a 2000', () => {
    const base = { planoId: CLIENTE };
    const aparada = PedirMudancaSchema.parse({ ...base, instrucao: '  mais verba em busca  ' });
    assert.equal(aparada.instrucao, 'mais verba em busca');
    assert.equal(PedirMudancaSchema.safeParse({ ...base, instrucao: 'ab' }).success, false);
    assert.equal(PedirMudancaSchema.safeParse({ ...base, instrucao: 'a'.repeat(2001) }).success, false);
    assert.ok(PedirMudancaSchema.safeParse({ ...base, instrucao: 'a'.repeat(2000) }).success);
  });

  it('EditarManual e VersaoAlvo exigem uuid e não aceitam campo extra', () => {
    assert.ok(EditarManualSchema.safeParse({ planoId: CLIENTE, conteudo: {} }).success);
    assert.equal(EditarManualSchema.safeParse({ planoId: 'x', conteudo: {} }).success, false);
    assert.ok(VersaoAlvoSchema.safeParse({ versaoId: CLIENTE }).success);
    assert.equal(VersaoAlvoSchema.safeParse({ versaoId: CLIENTE, outro: 1 }).success, false);
  });
});
