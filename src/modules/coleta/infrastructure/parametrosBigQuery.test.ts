import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BigQuery } from '@google-cloud/bigquery';
import { linhaParaBigQuery, paraParametroBigQuery } from './parametrosBigQuery.ts';

const TIPOS = { data_dia: 'DATE', inserido_em: 'TIMESTAMP', nome: 'STRING', valor: 'NUMERIC' } as const;

function valoresEnviados(linhas: readonly Record<string, unknown>[]) {
  const parametro = BigQuery.valueToQueryParameter_(linhas, [TIPOS]);
  return parametro.parameterValue!.arrayValues![0]!.structValues!;
}

describe('parâmetros do BigQuery', () => {
  it('string crua em DATE/TIMESTAMP chega nula na biblioteca (motivo deste helper)', () => {
    const enviados = valoresEnviados([{ data_dia: '2026-10-01', inserido_em: '2026-11-17T05:00:00.000Z', nome: 'x', valor: 1 }]);
    assert.equal(enviados.data_dia!.value, undefined);
    assert.equal(enviados.inserido_em!.value, undefined);
  });

  it('linha convertida envia DATE e TIMESTAMP com valor', () => {
    const linha = linhaParaBigQuery({ data_dia: '2026-10-01', inserido_em: '2026-11-17T05:00:00.000Z', nome: 'x', valor: 1 }, TIPOS);
    const enviados = valoresEnviados([linha]);
    assert.equal(enviados.data_dia!.value, '2026-10-01');
    assert.match(String(enviados.inserido_em!.value), /^2026-11-17T05:00:00/);
    assert.equal(enviados.nome!.value, 'x');
  });

  it('coluna ausente vira null em vez de sumir do struct', () => {
    const linha = linhaParaBigQuery({ nome: 'x' }, TIPOS);
    assert.deepEqual(Object.keys(linha).sort(), ['data_dia', 'inserido_em', 'nome', 'valor']);
    assert.equal(linha.data_dia, null);
    assert.equal(linha.valor, null);
  });

  it('escalar TIMESTAMP aceita Date e string', () => {
    const deDate = BigQuery.valueToQueryParameter_(paraParametroBigQuery(new Date('2026-11-17T05:00:00Z'), 'TIMESTAMP'), 'TIMESTAMP');
    const deString = BigQuery.valueToQueryParameter_(paraParametroBigQuery('2026-11-17T05:00:00.000Z', 'TIMESTAMP'), 'TIMESTAMP');
    assert.match(String(deDate.parameterValue!.value), /^2026-11-17T05:00:00/);
    assert.match(String(deString.parameterValue!.value), /^2026-11-17T05:00:00/);
  });
});
