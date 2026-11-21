import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { destinoDaRotaLegada } from './enderecos.ts';
import { atrasoDaColeta, ordenarPorProblema, situacaoDaFonte } from './fontes.ts';

const AGORA = new Date('2026-11-21T12:00:00Z');
const HORAS = (n: number) => new Date(AGORA.getTime() - n * 3_600_000);
const base = { precisaReautorizar: false, coletaLigada: true, comErro: false, ultimaColeta: HORAS(2) };

describe('situação da fonte', () => {
  it('cinco estados com rótulo de uma palavra', () => {
    assert.equal(situacaoDaFonte(base, AGORA).estado, 'ok');
    assert.equal(situacaoDaFonte({ ...base, ultimaColeta: HORAS(100) }, AGORA).estado, 'atencao');
    assert.equal(situacaoDaFonte({ ...base, precisaReautorizar: true }, AGORA).estado, 'reautorizar');
    assert.equal(situacaoDaFonte({ ...base, ultimaColeta: null }, AGORA).estado, 'vazio');
    assert.equal(situacaoDaFonte({ ...base, coletaLigada: false }, AGORA).estado, 'pausado');
    assert.equal(situacaoDaFonte({ ...base, comErro: true }, AGORA).estado, 'pausado');
    for (const dados of [base, { ...base, comErro: true }, { ...base, coletaLigada: false }, { ...base, ultimaColeta: null }]) {
      assert.ok(!situacaoDaFonte(dados, AGORA).rotulo.includes(' '));
    }
  });
  it('reautorizar vence qualquer outro estado', () => {
    assert.equal(situacaoDaFonte({ ...base, precisaReautorizar: true, coletaLigada: false, comErro: true }, AGORA).rotulo, 'Reautorizar');
  });
  it('lista com problema primeiro e ok por último', () => {
    const linhas = [
      { nome: 'B', situacao: situacaoDaFonte(base, AGORA) },
      { nome: 'A', situacao: situacaoDaFonte({ ...base, coletaLigada: false }, AGORA) },
      { nome: 'C', situacao: situacaoDaFonte({ ...base, precisaReautorizar: true }, AGORA) },
      { nome: 'D', situacao: situacaoDaFonte({ ...base, ultimaColeta: HORAS(100) }, AGORA) },
    ];
    assert.deepEqual(ordenarPorProblema(linhas).map((l) => l.nome), ['C', 'D', 'A', 'B']);
  });
  it('atraso só aparece depois de 36 horas', () => {
    assert.equal(atrasoDaColeta(HORAS(10), AGORA), null);
    assert.equal(atrasoDaColeta(null, AGORA), null);
    assert.equal(atrasoDaColeta(HORAS(24 * 5), AGORA), '5 dias de atraso');
  });
});

describe('rotas antigas do cliente', () => {
  const ID = '95ec64b4-c5b9-43ff-909d-d258d91e8b7c';
  it('cada tela antiga tem destino na tabela do ADR 0036', () => {
    assert.equal(destinoDaRotaLegada(ID, 'visao'), `/clientes/${ID}/conexoes`);
    assert.equal(destinoDaRotaLegada(ID, 'dados'), `/clientes/${ID}/conexoes?secao=fontes`);
    assert.equal(destinoDaRotaLegada(ID, 'acessos'), `/clientes/${ID}/conexoes?secao=pedir`);
    assert.equal(destinoDaRotaLegada(ID, 'brain'), `/clientes/${ID}/contexto?secao=brain`);
    assert.equal(destinoDaRotaLegada(ID, 'configuracoes'), `/clientes/${ID}/conexoes`);
  });
  it('preserva a busca, inclusive enviar=contexto e os avisos', () => {
    assert.equal(destinoDaRotaLegada(ID, 'acessos', { enviar: 'contexto' }), `/clientes/${ID}/conexoes?enviar=contexto&secao=pedir`);
    assert.equal(destinoDaRotaLegada(ID, 'dados', { feito: 'Conta movida.', vazio: '' }), `/clientes/${ID}/conexoes?feito=Conta+movida.&secao=fontes`);
  });
});
