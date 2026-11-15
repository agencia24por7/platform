import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CausaFaltante, consolidarQualidade, taxaDeSucesso } from './qualidade.ts';

const volumetriaVazia = { linhas: 0, bytes: 0, requests: 0, duracaoMs: 0 };

describe('consolidarQualidade', () => {
  it('conta fontes coletadas e não gera faltante quando tudo deu certo', () => {
    const relatorio = consolidarQualidade(
      ['google', 'meta'],
      [
        { fonte: 'google', ok: true },
        { fonte: 'meta', ok: true },
      ],
      [],
      volumetriaVazia,
    );
    assert.equal(relatorio.fontesEsperadas, 2);
    assert.equal(relatorio.fontesColetadas, 2);
    assert.deepEqual(relatorio.faltantes, []);
  });

  it('reporta a causa declarada quando uma fonte falha', () => {
    const relatorio = consolidarQualidade(
      ['google', 'ga4'],
      [
        { fonte: 'google', ok: true },
        { fonte: 'ga4', ok: false, causa: CausaFaltante.ReauthPending, detalhe: '401 no token' },
      ],
      [],
      volumetriaVazia,
    );
    assert.equal(relatorio.fontesColetadas, 1);
    assert.deepEqual(relatorio.faltantes, [{ fonte: 'ga4', causa: CausaFaltante.ReauthPending, detalhe: '401 no token' }]);
  });

  it('fonte esperada sem nenhum resultado vira faltante com causa api_recusou por padrão', () => {
    const relatorio = consolidarQualidade(['youtube'], [], [], volumetriaVazia);
    assert.deepEqual(relatorio.faltantes, [{ fonte: 'youtube', causa: CausaFaltante.ApiRecusou, detalhe: null }]);
  });
});

describe('taxaDeSucesso', () => {
  it('é 1 quando não havia fonte esperada', () => {
    const relatorio = consolidarQualidade([], [], [], volumetriaVazia);
    assert.equal(taxaDeSucesso(relatorio), 1);
  });

  it('é a razão entre coletadas e esperadas', () => {
    const relatorio = consolidarQualidade(
      ['a', 'b', 'c', 'd'],
      [
        { fonte: 'a', ok: true },
        { fonte: 'b', ok: true },
        { fonte: 'c', ok: true },
      ],
      [],
      volumetriaVazia,
    );
    assert.equal(taxaDeSucesso(relatorio), 0.75);
  });
});
