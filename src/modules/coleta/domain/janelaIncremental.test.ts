import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HISTORICO_VAZIO,
  JANELA_MAXIMA_DIAS,
  calcularPausa,
  diasEntre,
  esperaAposFalhasHoras,
  marcaDagua,
  ordemDeColeta,
  planejarColetaIncremental,
  podeRodar,
  proximaMeiaNoiteEm,
  type HistoricoDeColeta,
} from './janelaIncremental.ts';

const AGORA = new Date('2026-11-20T15:00:00Z');
const ONTEM_NA_ROTINA = new Date('2026-11-19T15:00:00Z');
const HOJE_CEDO = new Date('2026-11-20T09:00:00Z');

const historico = (parcial: Partial<HistoricoDeColeta>): HistoricoDeColeta => ({ ...HISTORICO_VAZIO, ...parcial });

describe('planejarColetaIncremental', () => {
  it('primeira execução: sem sucesso anterior, começa pelos últimos dias e deixa o histórico para o backfill', () => {
    const plano = planejarColetaIncremental('google', HISTORICO_VAZIO, AGORA);
    assert.deepEqual(plano.janela, { start: '2026-11-13', end: '2026-11-19' });
    assert.equal(plano.marcaDagua, null);
    assert.equal(plano.comDimensoes, true);
    assert.equal(plano.emDia, false);
  });

  it('execução normal: relê o lookback da plataforma a partir da marca d’água e termina ontem', () => {
    const plano = planejarColetaIncremental('google', historico({ ultimaJanelaSucesso: '2026-11-18', ultimaIncrementalEm: ONTEM_NA_ROTINA }), AGORA);
    assert.deepEqual(plano.janela, { start: '2026-11-12', end: '2026-11-19' });
    assert.equal(plano.comDimensoes, true);
    assert.equal(plano.emDia, false);
  });

  it('lookback curto (GA4 = 3 dias) relê só os 3 últimos dias', () => {
    const plano = planejarColetaIncremental('ga4', historico({ ultimaJanelaSucesso: '2026-11-19', ultimaIncrementalEm: ONTEM_NA_ROTINA }), AGORA);
    assert.deepEqual(plano.janela, { start: '2026-11-17', end: '2026-11-19' });
  });

  it('fonte que já concluiu a incremental de hoje fica em dia e não pede dimensões de novo', () => {
    const plano = planejarColetaIncremental('meta', historico({ ultimaJanelaSucesso: '2026-11-19', ultimaIncrementalEm: HOJE_CEDO }), AGORA);
    assert.equal(plano.emDia, true);
    assert.equal(plano.comDimensoes, false);
  });

  it('lacuna maior que 28 dias: uma janela limitada por execução, a mais antiga primeiro', () => {
    const plano = planejarColetaIncremental('google', historico({ ultimaJanelaSucesso: '2026-08-01', ultimaIncrementalEm: HOJE_CEDO }), AGORA);
    assert.deepEqual(plano.janela, { start: '2026-07-26', end: '2026-08-22' });
    assert.equal(diasEntre(plano.janela.start, plano.janela.end) + 1, JANELA_MAXIMA_DIAS);
    assert.equal(plano.emDia, false);
    assert.equal(plano.comDimensoes, false);

    const seguinte = planejarColetaIncremental('google', historico({ ultimaJanelaSucesso: plano.janela.end, ultimaIncrementalEm: HOJE_CEDO }), AGORA);
    assert.equal(seguinte.janela.start, '2026-08-16');
    assert.ok(seguinte.janela.start > plano.janela.start);
  });

  it('coleta parcial não avança a marca d’água: a janela parte do último sucesso', () => {
    const soParcial = planejarColetaIncremental('google', historico({ ultimaJanelaSucesso: '2026-11-10' }), AGORA);
    assert.deepEqual(soParcial.janela, { start: '2026-11-04', end: '2026-11-19' });
  });

  it('parcial repetida 3 vezes na mesma janela é aceita para a fonte não travar', () => {
    const h = historico({ ultimaJanelaSucesso: '2026-11-10', ultimaJanelaParcialRepetida: '2026-11-18' });
    assert.equal(marcaDagua(h), '2026-11-18');
    assert.deepEqual(planejarColetaIncremental('google', h, AGORA).janela, { start: '2026-11-12', end: '2026-11-19' });
  });

  it('atraso da plataforma: Search Console termina 3 dias antes de hoje', () => {
    const plano = planejarColetaIncremental('searchconsole', historico({ ultimaJanelaSucesso: '2026-11-17', ultimaIncrementalEm: ONTEM_NA_ROTINA }), AGORA);
    assert.deepEqual(plano.janela, { start: '2026-11-15', end: '2026-11-17' });
  });

  it('marca d’água depois do alvo (backfill sem atraso) não estica a janela para o futuro', () => {
    const plano = planejarColetaIncremental('searchconsole', historico({ ultimaJanelaSucesso: '2026-11-19' }), AGORA);
    assert.deepEqual(plano.janela, { start: '2026-11-15', end: '2026-11-17' });
  });

  it('histórico curto (pixel = 28 dias) nunca pede além do que a API guarda', () => {
    const plano = planejarColetaIncremental('pixel', historico({ ultimaJanelaSucesso: '2026-01-01' }), AGORA);
    assert.deepEqual(plano.janela, { start: '2026-10-23', end: '2026-11-19' });
  });

  it('snapshot (RD) coleta uma vez por dia', () => {
    assert.deepEqual(planejarColetaIncremental('rdstation', historico({ ultimaIncrementalEm: ONTEM_NA_ROTINA }), AGORA).janela, { start: '2026-11-19', end: '2026-11-19' });
    assert.equal(planejarColetaIncremental('rdstation', historico({ ultimaIncrementalEm: ONTEM_NA_ROTINA }), AGORA).emDia, false);
    assert.equal(planejarColetaIncremental('gtm', historico({ ultimaIncrementalEm: HOJE_CEDO }), AGORA).emDia, true);
  });

  it('o dia da rotina é o de America/Sao_Paulo, não o UTC', () => {
    const plano = planejarColetaIncremental('google', HISTORICO_VAZIO, new Date('2026-11-21T01:00:00Z'));
    assert.equal(plano.janela.end, '2026-11-19');
  });

  it('pausa estruturada: por fonte e por plataforma, só enquanto pausa_ate está no futuro', () => {
    assert.equal(planejarColetaIncremental('google', historico({ pausaAte: new Date('2026-11-21T08:00:00Z') }), AGORA).pausadaPorCota, true);
    assert.equal(planejarColetaIncremental('google', historico({ pausaDaPlataformaAte: new Date('2026-11-21T08:00:00Z') }), AGORA).pausadaPorCota, true);
    assert.equal(planejarColetaIncremental('google', historico({ pausaAte: new Date('2026-11-20T08:00:00Z') }), AGORA).pausadaPorCota, false);
  });

  it('fonte com coleta running há menos de 3 h fica ocupada; mais velha não', () => {
    const recente = planejarColetaIncremental('meta', historico({ emExecucaoDesde: new Date('2026-11-20T13:00:00Z') }), AGORA);
    assert.equal(recente.ocupada, true);
    assert.equal(podeRodar(recente), false);
    assert.equal(planejarColetaIncremental('meta', historico({ emExecucaoDesde: new Date('2026-11-20T11:00:00Z') }), AGORA).ocupada, false);
  });

  it('falhas seguidas espaçam a fonte: 1 falha não espera, 2 esperam 6 h, depois dobra até 24 h', () => {
    assert.equal(esperaAposFalhasHoras(1), 0);
    assert.equal(esperaAposFalhasHoras(2), 6);
    assert.equal(esperaAposFalhasHoras(3), 12);
    assert.equal(esperaAposFalhasHoras(9), 24);
    const tentou = new Date('2026-11-20T13:00:00Z');
    assert.equal(planejarColetaIncremental('meta', historico({ falhasConsecutivas: 3, ultimaTentativaEm: tentou }), AGORA).emEspera, true);
    assert.equal(planejarColetaIncremental('meta', historico({ falhasConsecutivas: 1, ultimaTentativaEm: tentou }), AGORA).emEspera, false);
  });

  it('marca vinda de parcial aceita é sinalizada', () => {
    assert.equal(planejarColetaIncremental('google', historico({ ultimaJanelaSucesso: '2026-11-10', ultimaJanelaParcialRepetida: '2026-11-18' }), AGORA).marcaPorParcial, true);
    assert.equal(planejarColetaIncremental('google', historico({ ultimaJanelaSucesso: '2026-11-18', ultimaJanelaParcialRepetida: '2026-11-10' }), AGORA).marcaPorParcial, false);
  });
});

describe('calcularPausa', () => {
  it('cota diária vai até a meia-noite do Pacífico e, no Google Ads, vale para a plataforma inteira', () => {
    const pausa = calcularPausa('google', { motivo: 'cota_diaria', minutos: null }, AGORA)!;
    assert.equal(pausa.ate.toISOString(), '2026-11-21T08:00:00.000Z');
    assert.equal(pausa.escopo, 'plataforma');
    assert.equal(calcularPausa('ga4', { motivo: 'cota_diaria', minutos: null }, AGORA)!.escopo, 'fonte');
  });

  it('no horário de verão do Pacífico a meia-noite é 07:00 UTC', () => {
    assert.equal(proximaMeiaNoiteEm(new Date('2026-07-10T15:00:00Z'), 'America/Los_Angeles').toISOString(), '2026-07-11T07:00:00.000Z');
  });

  it('limite temporário usa os minutos pedidos, com teto, e zero minutos não pausa', () => {
    assert.equal(calcularPausa('meta', { motivo: 'limite_temporario', minutos: 30 }, AGORA)!.ate.toISOString(), '2026-11-20T15:30:00.000Z');
    assert.equal(calcularPausa('meta', { motivo: 'limite_temporario', minutos: null }, AGORA), null);
    assert.equal(calcularPausa('meta', null, AGORA), null);
  });
});

describe('ordemDeColeta', () => {
  it('mais atrasada primeiro; empate vai para quem tentou há mais tempo', () => {
    const plano = (diasAtrasada: number) => ({ ...planejarColetaIncremental('google', HISTORICO_VAZIO, AGORA), diasAtrasada });
    const itens = [
      { nome: 'a', plano: plano(1), ultimaTentativaEm: new Date('2026-11-20T10:00:00Z') },
      { nome: 'b', plano: plano(5), ultimaTentativaEm: null },
      { nome: 'c', plano: plano(1), ultimaTentativaEm: new Date('2026-11-19T10:00:00Z') },
    ];
    assert.deepEqual([...itens].sort(ordemDeColeta).map((item) => item.nome), ['b', 'c', 'a']);
  });
});
