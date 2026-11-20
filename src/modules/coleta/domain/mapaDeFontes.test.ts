import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ModoColeta, fonteDe, fontesAtivasNoV1, janelaAteOntem, janelaDias, plataformasColetaveis } from './mapaDeFontes.ts';

describe('fontesAtivasNoV1', () => {
  it('traz só as 10 fontes com série temporal ou snapshot prontos', () => {
    const platforms = fontesAtivasNoV1()
      .map((fonte) => fonte.platform)
      .sort();
    assert.deepEqual(platforms, ['gbp', 'google', 'gtm', 'ga4', 'leadads', 'meta', 'pixel', 'rdstation', 'searchconsole', 'youtube'].sort());
  });

  it('cada fonte ativa tem motivo nulo e cada fonte inativa tem motivo', () => {
    for (const fonte of fontesAtivasNoV1()) {
      assert.equal(fonte.motivoForaDoV1, null);
    }
  });

  it('apify, zapi e whatsapp ficam fora, com motivo', () => {
    for (const platform of ['apify', 'zapi', 'whatsapp'] as const) {
      const fonte = fonteDe(platform);
      assert.equal(fonte.ativaNoV1, false);
      assert.ok(fonte.motivoForaDoV1 && fonte.motivoForaDoV1.length > 0);
    }
  });
});

describe('plataformasColetaveis', () => {
  it('o orquestrador só recebe fontes de plataforma com coletor: apify e zapi ficam de fora', () => {
    const coletaveis = plataformasColetaveis();
    assert.deepEqual([...coletaveis].sort(), ['gbp', 'google', 'gtm', 'ga4', 'leadads', 'meta', 'pixel', 'rdstation', 'searchconsole', 'youtube'].sort());
    for (const platform of ['apify', 'zapi'] as const) assert.ok(!coletaveis.includes(platform));
  });

  it('rdstation entra como snapshot diário no fato de negociações, sem janela', () => {
    const fonte = fonteDe('rdstation');
    assert.equal(fonte.grao, 'snapshot');
    assert.equal(fonte.tabelaFato, 'fato_rd_negociacoes');
    assert.equal(janelaDias('rdstation', ModoColeta.Completa), 0);
    assert.ok(fonte.rotulosEsperados.includes('deal_stage.name'));
    for (const campo of [...fonte.dimensoes, ...fonte.metricas]) {
      assert.ok(!/contact|email|phone|organization|user|custom|notes|^name$/.test(campo), `campo pessoal no mapa: ${campo}`);
    }
  });

  it('pixel entra como série diária por evento no fato de eventos do conjunto de dados, com histórico curto', () => {
    const fonte = fonteDe('pixel');
    assert.equal(fonte.grao, 'dataset_dia_evento');
    assert.equal(fonte.tabelaFato, 'fato_meta_eventos_dataset');
    assert.equal(janelaDias('pixel', ModoColeta.Amostra), 7);
    assert.equal(janelaDias('pixel', ModoColeta.Completa), 28);
  });

  it('leadads entra como snapshot diário de formulários, sem janela e sem ler leads', () => {
    const fonte = fonteDe('leadads');
    assert.equal(fonte.grao, 'snapshot');
    assert.equal(fonte.tabelaFato, 'fato_meta_formularios');
    assert.equal(janelaDias('leadads', ModoColeta.Completa), 0);
    for (const campo of [...fonte.dimensoes, ...fonte.metricas]) {
      assert.ok(!/field_data|^leads$|email|phone|full_name|questions/.test(campo), `campo pessoal no mapa: ${campo}`);
    }
    assert.ok(!fonte.endpoint.includes('/leads'));
  });
});

describe('janelaDias', () => {
  it('amostra é sempre 7 dias nas fontes com série temporal', () => {
    assert.equal(janelaDias('google', ModoColeta.Amostra), 7);
    assert.equal(janelaDias('meta', ModoColeta.Amostra), 7);
  });

  it('completa é 28 dias nas fontes com série temporal', () => {
    assert.equal(janelaDias('google', ModoColeta.Completa), 28);
  });

  it('gtm não tem janela — é snapshot', () => {
    assert.equal(janelaDias('gtm', ModoColeta.Amostra), 0);
    assert.equal(janelaDias('gtm', ModoColeta.Completa), 0);
  });
});

describe('janelaAteOntem', () => {
  it('termina ontem e cobre N dias (amostra = 7)', () => {
    const hoje = new Date(Date.UTC(2026, 10, 15, 15));
    assert.deepEqual(janelaAteOntem('google', ModoColeta.Amostra, hoje), { start: '2026-11-08', end: '2026-11-14' });
  });

  it('completa cobre 28 dias', () => {
    const hoje = new Date(Date.UTC(2026, 10, 15, 15));
    assert.deepEqual(janelaAteOntem('google', ModoColeta.Completa, hoje), { start: '2026-10-18', end: '2026-11-14' });
  });

  it('usa o dia de America/Sao_Paulo: às 22h BRT o dia corrente não entra', () => {
    const noiteEmSaoPaulo = new Date('2026-11-16T01:00:00Z');
    assert.deepEqual(janelaAteOntem('google', ModoColeta.Completa, noiteEmSaoPaulo).end, '2026-11-14');
  });

  it('atravessa virada de mês/ano corretamente', () => {
    const hoje = new Date(Date.UTC(2026, 0, 3, 15));
    assert.deepEqual(janelaAteOntem('google', ModoColeta.Amostra, hoje), { start: '2025-12-27', end: '2026-01-02' });
  });
});

describe('coleta incremental no mapa', () => {
  it('lookback por plataforma: 7 dias para mídia paga, 3 para as demais séries', () => {
    assert.equal(fonteDe('meta').lookbackDias, 7);
    assert.equal(fonteDe('google').lookbackDias, 7);
    for (const platform of ['ga4', 'searchconsole', 'youtube', 'gbp', 'pixel', 'leadads'] as const) assert.equal(fonteDe(platform).lookbackDias, 3);
  });

  it('atraso: Search Console e GBP terminam 3 dias antes de hoje, o resto ontem', () => {
    assert.equal(fonteDe('searchconsole').atrasoDias, 3);
    assert.equal(fonteDe('gbp').atrasoDias, 3);
    assert.equal(fonteDe('google').atrasoDias, 1);
  });

  it('incremental usa o mesmo teto de 28 dias da completa', () => {
    assert.equal(janelaDias('google', ModoColeta.Incremental), 28);
    assert.equal(janelaDias('rdstation', ModoColeta.Incremental), 0);
  });

  it('o mapa não tem mais teto de linhas', () => {
    for (const fonte of fontesAtivasNoV1()) assert.ok(!('limiteLinhasAmostra' in fonte));
  });
});
