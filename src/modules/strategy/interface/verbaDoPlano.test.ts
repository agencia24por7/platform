import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import { diasDoHorizonte, equivalentePorMesEmCentavos, lerVerbaDoFormulario, modoDaVerba, periodoDaVerba, resumoDaVerba, totalDoHorizonteEmCentavos } from './verbaDoPlano.ts';

const TRES_MESES = { inicio: '2026-12-01', fim: '2027-02-28' };

describe('dias do horizonte', () => {
  it('conta início e fim inclusivos', () => {
    assert.equal(diasDoHorizonte({ inicio: '2026-12-01', fim: '2026-12-01' }), 1);
    assert.equal(diasDoHorizonte({ inicio: '2026-12-01', fim: '2026-12-31' }), 31);
    assert.equal(diasDoHorizonte(TRES_MESES), 90);
    assert.equal(diasDoHorizonte({ inicio: '2028-02-01', fim: '2028-03-01' }), 30);
  });

  it('período só existe com datas válidas e fim não anterior ao início', () => {
    assert.deepEqual(periodoDaVerba(TRES_MESES), TRES_MESES);
    assert.equal(periodoDaVerba({ inicio: '2026-12-02', fim: '2026-12-01' }), null);
    assert.equal(periodoDaVerba({ inicio: '2026-02-31', fim: '2026-03-01' }), null);
    assert.equal(periodoDaVerba({ inicio: '', fim: '' }), null);
  });
});

describe('conversão mensal para total', () => {
  it('total = mensal × dias ÷ 30, arredondado a centavos (meio para cima)', () => {
    assert.equal(totalDoHorizonteEmCentavos(100000n, 90), 300000n);
    assert.equal(totalDoHorizonteEmCentavos(100000n, 31), 103333n);
    assert.equal(totalDoHorizonteEmCentavos(100000n, 1), 3333n);
    assert.equal(totalDoHorizonteEmCentavos(1n, 15), 1n);
    assert.equal(totalDoHorizonteEmCentavos(1n, 14), 0n);
  });

  it('equivalente por mês é o caminho inverso', () => {
    assert.equal(equivalentePorMesEmCentavos(300000n, 90), 100000n);
    assert.equal(equivalentePorMesEmCentavos(103333n, 31), 100000n);
  });
});

describe('leitura da verba', () => {
  it('modo vazio vale período; desconhecido é recusado', () => {
    assert.equal(modoDaVerba(undefined), 'periodo');
    assert.equal(modoDaVerba(' mensal '), 'mensal');
    assert.equal(modoDaVerba('anual'), null);
  });

  it('período devolve o valor digitado em centavos', () => {
    const lida = lerVerbaDoFormulario({ verba: '15.000,00' }, null);
    assert.ok(lida.ok);
    assert.equal(lida.value, '1500000');
  });

  it('mensal converte pelo período', () => {
    const lida = lerVerbaDoFormulario({ modoDaVerba: 'mensal', verba: '1.000,00' }, TRES_MESES);
    assert.ok(lida.ok);
    assert.equal(lida.value, '300000');
  });

  it('mensal sem período válido não erra em verba: devolve nulo', () => {
    const lida = lerVerbaDoFormulario({ modoDaVerba: 'mensal', verba: '1.000,00' }, null);
    assert.ok(lida.ok);
    assert.equal(lida.value, null);
  });

  it('recusa texto ilegível, zero, modo inválido e total grande demais', () => {
    assert.ok(!lerVerbaDoFormulario({ verba: 'abc' }, null).ok);
    assert.ok(!lerVerbaDoFormulario({ verba: '0' }, null).ok);
    assert.ok(!lerVerbaDoFormulario({ modoDaVerba: 'x', verba: '10' }, null).ok);
    assert.ok(!lerVerbaDoFormulario({ modoDaVerba: 'mensal', verba: '0,01' }, { inicio: '2026-12-01', fim: '2026-12-10' }).ok);
    assert.ok(!lerVerbaDoFormulario({ modoDaVerba: 'mensal', verba: '9999999999999,99' }, { inicio: '2026-01-01', fim: '2030-12-31' }).ok);
  });
});

describe('resumo da verba para a revisão', () => {
  const normalizar = (texto: string) => texto.replace(/\s/g, ' ');

  it('mensal: total convertido e valor por mês igual ao digitado', () => {
    const resumo = resumoDaVerba({ modoDaVerba: 'mensal', verba: '1.000,00', ...TRES_MESES });
    assert.ok(resumo.ok);
    assert.equal(resumo.value.dias, 90);
    assert.equal(resumo.value.convertida, true);
    assert.equal(normalizar(resumo.value.total), 'R$ 3.000,00');
    assert.equal(normalizar(resumo.value.porMes), 'R$ 1.000,00');
  });

  it('período: total digitado e equivalente por mês calculado', () => {
    const resumo = resumoDaVerba({ verba: '3.000,00', ...TRES_MESES });
    assert.ok(resumo.ok);
    assert.equal(resumo.value.convertida, false);
    assert.equal(normalizar(resumo.value.total), 'R$ 3.000,00');
    assert.equal(normalizar(resumo.value.porMes), 'R$ 1.000,00');
  });

  it('sem datas válidas ou com verba inválida devolve mensagem', () => {
    const semDatas = resumoDaVerba({ verba: '3.000,00' });
    assert.ok(!semDatas.ok && /datas/.test(semDatas.error));
    const invalida = resumoDaVerba({ verba: 'x', ...TRES_MESES });
    assert.ok(!invalida.ok && /reais/.test(invalida.error));
  });
});
