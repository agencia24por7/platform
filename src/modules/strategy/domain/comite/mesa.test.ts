import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URN_BENCHMARK_B, URN_DESEMPENHO, urnDeTeste } from '../fixturesDeTeste.ts';
import { comitePorChave } from './comites.ts';
import { parecer, ponto } from './fixturesDeParecer.ts';
import {
  MAXIMO_DE_FALAS_POR_RODADA,
  conferirMesa,
  esquemaParecerDeMembro,
  lerRodadaDaMesa,
  sintetizarParecerDoComite,
  type FalaDaMesa,
  type RodadaDaMesa,
} from './mesa.ts';
import { MAXIMO_DE_PONTOS_POR_PARECER, TAMANHO_MAXIMO_DO_PARECER_BYTES, esquemaParecer, lerParecer, tamanhoDoParecer } from './parecer.ts';

const redator = comitePorChave('redator')!;
const legal = comitePorChave('risco_legal')!;

function fala(membro: string, reageA: string, mudouDeOpiniao = false): FalaDaMesa {
  return { membro, reageA, posicao: `Posição de ${membro}.`, mudouDeOpiniao };
}

function rodada(comite: string, numero: 1 | 2, debate: FalaDaMesa[], sobrescrita: Partial<RodadaDaMesa> = {}): RodadaDaMesa {
  return { comite, rodada: numero, debate, consensos: [], divergencias: [], ...sobrescrita };
}

const pareceresDoRedator = [
  parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas', [URN_BENCHMARK_B])]),
  parecer('checador_de_promessas', 'aprova', []),
];
const mesa1 = rodada('redator', 1, [fala('redator', 'checador_de_promessas'), fala('checador_de_promessas', 'redator')]);
const mesa2 = rodada('redator', 2, [fala('redator', 'comite'), fala('checador_de_promessas', 'redator')]);

describe('esquemas da mesa', () => {
  it('parecer de membro é o mesmo esquema do parecer', () => {
    assert.equal(esquemaParecerDeMembro, esquemaParecer);
  });

  it('aceita rodada válida e recusa chave extra, rodada 3, posição longa e debate vazio ou acima do teto', () => {
    assert.equal(lerRodadaDaMesa(mesa1).ok, true);
    assert.equal(lerRodadaDaMesa({ ...mesa1, extra: 1 }).ok, false);
    assert.equal(lerRodadaDaMesa({ ...mesa1, rodada: 3 }).ok, false);
    assert.equal(lerRodadaDaMesa({ ...mesa1, debate: [] }).ok, false);
    assert.equal(lerRodadaDaMesa({ ...mesa1, debate: [{ ...fala('redator', 'comite'), posicao: 'x'.repeat(401) }] }).ok, false);
    assert.equal(lerRodadaDaMesa({ ...mesa1, debate: [{ ...fala('redator', 'comite'), extra: true }] }).ok, false);
    const muitas = Array.from({ length: MAXIMO_DE_FALAS_POR_RODADA + 1 }, () => fala('redator', 'comite'));
    assert.equal(lerRodadaDaMesa({ ...mesa1, debate: muitas }).ok, false);
  });

  it('limita consensos e divergências e exige dois membros distintos na divergência', () => {
    assert.equal(lerRodadaDaMesa({ ...mesa1, consensos: Array.from({ length: 6 }, (_, i) => `c${i}`) }).ok, false);
    const divergencia = { membros: ['redator', 'checador_de_promessas'], resumo: 'Discordam do tom.' };
    assert.equal(lerRodadaDaMesa({ ...mesa1, divergencias: [divergencia] }).ok, true);
    assert.equal(lerRodadaDaMesa({ ...mesa1, divergencias: Array.from({ length: 6 }, () => divergencia) }).ok, false);
    assert.equal(lerRodadaDaMesa({ ...mesa1, divergencias: [{ ...divergencia, membros: ['redator'] }] }).ok, false);
    assert.equal(lerRodadaDaMesa({ ...mesa1, divergencias: [{ ...divergencia, membros: ['redator', 'redator'] }] }).ok, false);
    assert.equal(lerRodadaDaMesa({ ...mesa1, divergencias: [{ ...divergencia, resumo: 'x'.repeat(301) }] }).ok, false);
  });

  it('recusa rodada acima do teto de bytes', () => {
    const gorda = Array.from({ length: MAXIMO_DE_FALAS_POR_RODADA }, () => ({ ...fala('redator', 'comite'), posicao: '€'.repeat(400) }));
    const resultado = lerRodadaDaMesa({ ...mesa1, debate: gorda, consensos: Array.from({ length: 5 }, () => '€'.repeat(300)) });
    assert.equal(resultado.ok, false);
  });
});

describe('conferirMesa', () => {
  it('aceita as duas rodadas em ordem e também só a primeira', () => {
    assert.equal(conferirMesa(redator, pareceresDoRedator, [mesa1, mesa2]).ok, true);
    assert.equal(conferirMesa(redator, pareceresDoRedator, [mesa1]).ok, true);
  });

  const codigos = (resultado: ReturnType<typeof conferirMesa>) => (resultado.ok ? [] : resultado.error.problemas.map((p) => p.codigo));

  it('acusa parecer de quem não é membro, parecer repetido e membro sem parecer', () => {
    assert.deepEqual(codigos(conferirMesa(redator, [...pareceresDoRedator, parecer('sdr', 'aprova')], [])), ['membro_desconhecido']);
    assert.deepEqual(codigos(conferirMesa(redator, [...pareceresDoRedator, pareceresDoRedator[0]!], [])), ['parecer_repetido']);
    assert.deepEqual(codigos(conferirMesa(redator, [pareceresDoRedator[0]!], [])), ['membro_ausente']);
  });

  it('acusa rodada fora de ordem, terceira rodada e rodada de outro comitê', () => {
    assert.ok(codigos(conferirMesa(redator, pareceresDoRedator, [mesa2])).includes('rodada_fora_de_ordem'));
    assert.ok(codigos(conferirMesa(redator, pareceresDoRedator, [mesa1, mesa1])).includes('rodada_fora_de_ordem'));
    assert.ok(codigos(conferirMesa(redator, pareceresDoRedator, [mesa1, mesa2, mesa2])).includes('rodada_fora_de_ordem'));
    assert.deepEqual(codigos(conferirMesa(redator, pareceresDoRedator, [{ ...mesa1, comite: 'marca' }])), ['comite_divergente']);
  });

  it('acusa falante desconhecido, reação a desconhecido, membro calado e reação a si mesmo', () => {
    const intruso = rodada('redator', 1, [fala('redator', 'comite'), fala('checador_de_promessas', 'redator'), fala('sdr', 'redator')]);
    assert.deepEqual(codigos(conferirMesa(redator, pareceresDoRedator, [intruso])), ['membro_desconhecido']);
    const reacaoFora = rodada('redator', 1, [fala('redator', 'sdr'), fala('checador_de_promessas', 'redator')]);
    assert.deepEqual(codigos(conferirMesa(redator, pareceresDoRedator, [reacaoFora])), ['membro_desconhecido']);
    const calado = rodada('redator', 1, [fala('redator', 'comite')]);
    assert.deepEqual(codigos(conferirMesa(redator, pareceresDoRedator, [calado])), ['membro_ausente']);
    const espelho = rodada('redator', 1, [fala('redator', 'redator'), fala('checador_de_promessas', 'redator')]);
    assert.deepEqual(codigos(conferirMesa(redator, pareceresDoRedator, [espelho])), ['reage_a_si_mesmo']);
  });

  it('divergência cita ponto que existe no parecer de um dos membros dela e membros do comitê', () => {
    const valida = { ...mesa1, divergencias: [{ pontoId: 'p1', membros: ['redator', 'checador_de_promessas'], resumo: 'Tom.' }] };
    assert.equal(conferirMesa(redator, pareceresDoRedator, [valida]).ok, true);
    const pontoFantasma = { ...mesa1, divergencias: [{ pontoId: 'p9', membros: ['redator', 'checador_de_promessas'], resumo: 'Tom.' }] };
    assert.deepEqual(codigos(conferirMesa(redator, pareceresDoRedator, [pontoFantasma])), ['ponto_desconhecido']);
    const forasteiro = { ...mesa1, divergencias: [{ membros: ['redator', 'sdr'], resumo: 'Tom.' }] };
    assert.deepEqual(codigos(conferirMesa(redator, pareceresDoRedator, [forasteiro])), ['membro_desconhecido']);
  });
});

describe('sintetizarParecerDoComite', () => {
  it('o parecer do comitê é um Parecer normal, com a chave do comitê, e o veredito é o mais severo', () => {
    const sintese = sintetizarParecerDoComite(redator, pareceresDoRedator, mesa2);
    assert.ok(sintese.ok);
    assert.equal(sintese.value.parecer.persona, 'redator');
    assert.equal(sintese.value.parecer.veredito, 'aprova_com_ajuste');
    assert.equal(lerParecer(sintese.value.parecer).ok, true);
    assert.deepEqual(sintese.value.origens, [{ pontoId: 'p1', membro: 'redator', pontoIdDoMembro: 'p1', ecos: [] }]);
  });

  it('todos aprovam: aprova sem pontos', () => {
    const sintese = sintetizarParecerDoComite(redator, [parecer('redator', 'aprova'), parecer('checador_de_promessas', 'aprova')], mesa2);
    assert.ok(sintese.ok);
    assert.equal(sintese.value.parecer.veredito, 'aprova');
    assert.deepEqual(sintese.value.parecer.pontos, []);
  });

  it('pontos do mesmo trecho e fontes viram um só, mantendo o de quem não mudou de opinião', () => {
    const pareceres = [
      parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas', [URN_BENCHMARK_B], { problema: 'Do redator.' })]),
      parecer('checador_de_promessas', 'aprova_com_ajuste', [ponto('c1', 'campanhas', [URN_BENCHMARK_B, URN_BENCHMARK_B], { problema: 'Do checador.' })]),
    ];
    const redatorCedeu = rodada('redator', 2, [fala('redator', 'checador_de_promessas', true), fala('checador_de_promessas', 'comite')]);
    const sintese = sintetizarParecerDoComite(redator, pareceres, redatorCedeu);
    assert.ok(sintese.ok);
    assert.equal(sintese.value.parecer.pontos.length, 1);
    assert.equal(sintese.value.parecer.pontos[0]!.problema, 'Do checador.');
    assert.deepEqual(sintese.value.parecer.pontos[0]!.fontes, [URN_BENCHMARK_B]);
    assert.deepEqual(sintese.value.origens, [{ pontoId: 'c1', membro: 'checador_de_promessas', pontoIdDoMembro: 'c1', ecos: [{ membro: 'redator', pontoId: 'p1' }] }]);
  });

  it('sem fonte não é eco: pontos sem fonte de membros distintos não se fundem e ids repetidos são renomeados', () => {
    const pareceres = [
      parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas')]),
      parecer('checador_de_promessas', 'aprova_com_ajuste', [ponto('p1', 'campanhas')]),
    ];
    const sintese = sintetizarParecerDoComite(redator, pareceres, mesa2);
    assert.ok(sintese.ok);
    assert.deepEqual(sintese.value.parecer.pontos.map((p) => p.id), ['p1', 'p1_2']);
    assert.deepEqual(sintese.value.origens.map((o) => o.membro), ['redator', 'checador_de_promessas']);
  });

  it('no máximo 5 pontos, priorizando quem manteve posição e o parecer mais severo', () => {
    const pareceres = [
      parecer('risco_legal', 'reprova', [ponto('l1', 'riscos_e_regras', [URN_DESEMPENHO]), ponto('l2', 'campanhas', [URN_DESEMPENHO])]),
      parecer('politicas_de_plataforma', 'aprova_com_ajuste', Array.from({ length: 5 }, (_, i) => ponto(`a${i}`, 'plano_de_midia', [urnDeTeste('conhecimento', `a${i}`)]))),
      parecer('privacidade_e_dados', 'aprova_com_ajuste', Array.from({ length: 5 }, (_, i) => ponto(`b${i}`, 'medicao', [urnDeTeste('conhecimento', `b${i}`)]))),
    ];
    const debate = rodada('risco_legal', 2, [
      fala('risco_legal', 'comite'),
      fala('politicas_de_plataforma', 'risco_legal', true),
      fala('privacidade_e_dados', 'risco_legal'),
    ]);
    const sintese = sintetizarParecerDoComite(legal, pareceres, debate);
    assert.ok(sintese.ok);
    assert.equal(sintese.value.parecer.veredito, 'reprova');
    assert.equal(sintese.value.parecer.pontos.length, MAXIMO_DE_PONTOS_POR_PARECER);
    assert.deepEqual(sintese.value.parecer.pontos.map((p) => p.id), ['l1', 'l2', 'b0', 'b1', 'b2']);
  });

  it('motivo vem do parecer mais severo e registra a divergência que restou', () => {
    const pareceres = [parecer('redator', 'aprova'), parecer('checador_de_promessas', 'reprova', [ponto('c1', 'campanhas')])];
    const comDivergencia = { ...mesa2, divergencias: [{ pontoId: 'c1', membros: ['redator', 'checador_de_promessas'], resumo: 'Prova insuficiente.' }] };
    const sintese = sintetizarParecerDoComite(redator, pareceres, comDivergencia);
    assert.ok(sintese.ok);
    assert.equal(sintese.value.parecer.motivo, 'Motivo de checador_de_promessas. Divergência registrada: Prova insuficiente.');
  });

  it('corta pontos de menor prioridade até caber no teto de bytes do parecer', () => {
    const gordo = (membro: string, prefixo: string) =>
      parecer(membro, 'aprova_com_ajuste', Array.from({ length: 3 }, (_, i) =>
        ponto(`${prefixo}${i}`, 'campanhas', Array.from({ length: 10 }, (_, j) => urnDeTeste('conhecimento', `${'a'.repeat(150)}${prefixo}${i}${j}`)), {
          problema: 'x'.repeat(500),
          ajustePedido: 'y'.repeat(500),
        })));
    const pareceres = [gordo('redator', 'r'), gordo('checador_de_promessas', 'c')];
    assert.ok(pareceres.every((p) => lerParecer(p).ok));
    const sintese = sintetizarParecerDoComite(redator, pareceres, mesa2);
    assert.ok(sintese.ok);
    assert.ok(tamanhoDoParecer(sintese.value.parecer) <= TAMANHO_MAXIMO_DO_PARECER_BYTES);
    assert.ok(sintese.value.parecer.pontos.length >= 1 && sintese.value.parecer.pontos.length < MAXIMO_DE_PONTOS_POR_PARECER);
    assert.equal(sintese.value.origens.length, sintese.value.parecer.pontos.length);
  });

  it('recusa sintetizar com mesa inválida', () => {
    const resultado = sintetizarParecerDoComite(redator, [pareceresDoRedator[0]!], mesa1);
    assert.equal(resultado.ok, false);
    if (!resultado.ok) {
      assert.deepEqual(resultado.error.problemas.map((p) => p.codigo).sort(), ['membro_ausente', 'rodada_fora_de_ordem']);
    }
  });
});
