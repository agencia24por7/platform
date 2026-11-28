import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SECOES_DO_PLANO } from '../plano.ts';
import {
  COMITES,
  MAXIMO_DE_MEMBROS_DO_COMITE,
  MINIMO_DE_MEMBROS_DO_COMITE,
  PADRAO_DA_TAREFA_DO_COMITE,
  PERSONAS_DOS_COMITES,
  SECOES_REVISADAS_PELOS_COMITES,
  comitePorChave,
  comitesAtivos,
  relatoraDoComite,
} from './comites.ts';
import { consolidarPareceres } from './consolidacao.ts';
import { parecer, ponto } from './fixturesDeParecer.ts';
import { REAGE_AO_COMITE } from './mesa.ts';
import { PADRAO_DA_CHAVE_DA_PERSONA, PERSONAS } from './personas.ts';

const CHAVES_ATUAIS = PERSONAS.map((p) => p.chave);
const NOVOS = ['cultura', 'marca', 'sparring_criativo', 'producao', 'memoria_e_decisoes'];
const EXTRAS = ['mercado_e_concorrencia', 'orcamento_e_eficiencia', 'jornada_e_retencao'];
const MANDA_USAR_FORA_DO_PACOTE =
  /\b(use|usar|consulte|consultar|busque|buscar|pesquise|pesquisar|recorra|traga|considere)\b[^.]*\b(conhecimento externo|internet|web|google|fora do pacote|sua experiência|seu conhecimento|conhecimento geral|mercado em geral)/i;

describe('catálogo de comitês', () => {
  it('são os nove das personas atuais, os cinco novos e os três extras, nessa ordem', () => {
    assert.deepEqual(COMITES.map((c) => c.chave), [...CHAVES_ATUAIS, ...NOVOS, ...EXTRAS]);
  });

  it('cada comitê tem de 2 a 3 membros e exatamente uma relatora', () => {
    for (const comite of COMITES) {
      assert.ok(comite.membros.length >= MINIMO_DE_MEMBROS_DO_COMITE && comite.membros.length <= MAXIMO_DE_MEMBROS_DO_COMITE, comite.chave);
      assert.equal(comite.membros.filter((m) => m.relatora).length, 1, comite.chave);
      assert.ok(comite.nome.length > 0 && comite.proposito.length > 0 && comite.proposito.length <= 200, comite.chave);
    }
  });

  it('a relatora dos nove comitês atuais é a persona atual, com a mesma chave e os mesmos dados', () => {
    for (const persona of PERSONAS) {
      const comite = comitePorChave(persona.chave);
      assert.ok(comite, persona.chave);
      const { relatora, ...dados } = relatoraDoComite(comite);
      assert.equal(relatora, true);
      assert.deepEqual(dados, { ...persona, secoes: persona.secoes ?? [] });
    }
  });

  it('chaves seguem o padrão, membros não repetem no conjunto e só a relatora atual repete a chave do comitê', () => {
    const chavesDeComite = new Set(COMITES.map((c) => c.chave));
    assert.equal(chavesDeComite.size, COMITES.length);
    const membros = COMITES.flatMap((c) => c.membros.map((m) => ({ comite: c.chave, membro: m })));
    assert.equal(new Set(membros.map((m) => m.membro.chave)).size, membros.length);
    for (const { comite, membro } of membros) {
      assert.match(membro.chave, PADRAO_DA_CHAVE_DA_PERSONA);
      assert.notEqual(membro.chave, REAGE_AO_COMITE);
      if (!chavesDeComite.has(membro.chave)) continue;
      assert.equal(membro.chave, comite, `${membro.chave} usa a chave de outro comitê`);
      assert.ok(membro.relatora && CHAVES_ATUAIS.includes(membro.chave), membro.chave);
    }
    for (const comite of COMITES) {
      assert.match(comite.chave, PADRAO_DA_CHAVE_DA_PERSONA);
      assert.notEqual(comite.chave, REAGE_AO_COMITE);
    }
  });

  it('tarefa é comite_<chave> e passa no padrão de tarefa da IA', () => {
    for (const comite of COMITES) {
      assert.equal(comite.tarefa, `comite_${comite.chave}`);
      assert.match(comite.tarefa, PADRAO_DA_TAREFA_DO_COMITE);
    }
  });

  it('seções do comitê são a união das dos membros, na ordem do plano', () => {
    for (const comite of COMITES) {
      const uniao = new Set(comite.membros.flatMap((m) => m.secoes));
      assert.deepEqual(comite.secoes, SECOES_DO_PLANO.filter((s) => uniao.has(s)), comite.chave);
      for (const membro of comite.membros) assert.ok(membro.secoes.length > 0, membro.chave);
    }
  });

  it('toda seção revisável do plano é coberta por ao menos um comitê; a intenção fica de fora', () => {
    const cobertas = new Set(COMITES.flatMap((c) => c.secoes));
    for (const secao of SECOES_REVISADAS_PELOS_COMITES) assert.ok(cobertas.has(secao), secao);
    assert.equal(cobertas.has('intencao'), false);
    assert.deepEqual(SECOES_DO_PLANO.filter((s) => !SECOES_REVISADAS_PELOS_COMITES.includes(s)), ['intencao']);
  });

  it('todo membro tem nome, foco, o que olha e instrução curta', () => {
    for (const membro of COMITES.flatMap((c) => c.membros)) {
      assert.ok(membro.nome.length > 0 && membro.foco.length > 0 && membro.olha.length > 0, membro.chave);
      assert.ok(membro.instrucao.length > 0 && membro.instrucao.length <= 300, membro.chave);
    }
  });

  it('nenhuma instrução, foco ou propósito manda usar conhecimento externo', () => {
    for (const comite of COMITES) {
      assert.doesNotMatch(comite.proposito, MANDA_USAR_FORA_DO_PACOTE, comite.chave);
      for (const membro of comite.membros) {
        for (const texto of [membro.instrucao, membro.foco, ...membro.olha]) {
          assert.doesNotMatch(texto, MANDA_USAR_FORA_DO_PACOTE, membro.chave);
        }
      }
    }
    assert.match('Use seu conhecimento do mercado.', MANDA_USAR_FORA_DO_PACOTE);
  });

  it('comitê de cultura só fala de tendência com sinal culture_* vigente e declara lacuna sem ele', () => {
    const cultura = comitePorChave('cultura')!;
    for (const membro of cultura.membros) {
      assert.match(membro.instrucao, /culture_\*/);
      assert.match(membro.instrucao, /vigente/);
      assert.match(membro.instrucao, /lacuna/);
      assert.match(membro.instrucao, /não opin/);
    }
  });

  it('sparring criativo não concorda por educação e só propõe com dado do pacote', () => {
    const relatora = relatoraDoComite(comitePorChave('sparring_criativo')!);
    assert.match(relatora.instrucao, /Não concorde por educação/);
    assert.match(relatora.instrucao, /dado do pacote/);
  });

  it('só o comitê de risco e legal obriga ajuste', () => {
    assert.deepEqual(COMITES.filter((c) => c.obrigaAjuste).map((c) => c.chave), ['risco_legal']);
  });

  it('PERSONAS_DOS_COMITES dá a consolidarPareceres o parecer do comitê com a chave dele', () => {
    assert.deepEqual(PERSONAS_DOS_COMITES.map((p) => p.chave), COMITES.map((c) => c.chave));
    const legal = PERSONAS_DOS_COMITES.find((p) => p.chave === 'risco_legal')!;
    assert.equal(legal.reprovacaoObrigaAjuste, true);
    const consolidacao = consolidarPareceres(
      [parecer('risco_legal', 'reprova', [ponto('p1', 'riscos_e_regras')]), parecer('cultura', 'reprova', [ponto('p1', 'campanhas')])],
      PERSONAS_DOS_COMITES,
    );
    assert.deepEqual(consolidacao.pendenciasObrigatorias, [{ persona: 'risco_legal', pontoId: 'p1', trecho: 'riscos_e_regras' }]);
  });

  it('comitePorChave acha ou devolve undefined', () => {
    assert.equal(comitePorChave('marca')?.nome, 'Comitê de marca');
    assert.equal(comitePorChave('inexistente'), undefined);
  });
});

describe('comitesAtivos', () => {
  it('rodada 1: todos os ligados, na ordem do catálogo', () => {
    assert.deepEqual(comitesAtivos(COMITES), COMITES);
    assert.deepEqual(
      comitesAtivos(COMITES, { desligados: ['cultura', 'sdr'] }).map((c) => c.chave),
      COMITES.map((c) => c.chave).filter((c) => c !== 'cultura' && c !== 'sdr'),
    );
  });

  it('o comitê que obriga ajuste não se desliga', () => {
    assert.ok(comitesAtivos(COMITES, { desligados: ['risco_legal'] }).some((c) => c.chave === 'risco_legal'));
  });

  it('rodada de ajuste: só os comitês cujas seções foram tocadas', () => {
    const tocouLacunas = comitesAtivos(COMITES, { secoesTocadas: ['lacunas'] }).map((c) => c.chave);
    assert.deepEqual(tocouLacunas, ['memoria_e_decisoes']);
    const tocouComunidades = comitesAtivos(COMITES, { secoesTocadas: ['comunidades_alvo'], desligados: ['sparring_criativo'] }).map((c) => c.chave);
    assert.deepEqual(tocouComunidades, ['buzz_social', 'cultura']);
  });

  it('nenhuma seção tocada não convoca ninguém; intenção sozinha também não', () => {
    assert.deepEqual(comitesAtivos(COMITES, { secoesTocadas: [] }), []);
    assert.deepEqual(comitesAtivos(COMITES, { secoesTocadas: ['intencao'] }), []);
  });

  it('não altera a lista recebida', () => {
    const copia = [...COMITES];
    comitesAtivos(copia, { desligados: ['marca'], secoesTocadas: ['campanhas'] });
    assert.deepEqual(copia, COMITES);
  });
});

describe('convocação dos comitês na fase 2b (24K-134)', async () => {
  const { comitesConvocados, comitesDesligados, podeDesligarComite, secoesAlteradas, chamadasPorRodadaDoComite } = await import('./comites.ts');

  it('risco e legal é convocado mesmo quando a rodada não tocou nenhuma seção dele', () => {
    assert.deepEqual(comitesConvocados(COMITES, { secoesTocadas: [] }).map((c) => c.chave), ['risco_legal']);
    const tocouLacunas = comitesConvocados(COMITES, { secoesTocadas: ['lacunas'] }).map((c) => c.chave);
    assert.ok(tocouLacunas.includes('risco_legal'));
    assert.ok(tocouLacunas.includes('memoria_e_decisoes'));
    assert.ok(!tocouLacunas.includes('redator'));
  });

  it('desligados vêm da configuração, nunca incluem risco e legal', () => {
    const configuracoes = [
      { comite: 'cultura', ligado: false },
      { comite: 'risco_legal', ligado: false },
      { comite: 'marca', ligado: true },
    ];
    assert.deepEqual(comitesDesligados(configuracoes), ['cultura']);
    assert.equal(podeDesligarComite('risco_legal'), false);
    assert.equal(podeDesligarComite('cultura'), true);
    assert.equal(podeDesligarComite('inexistente'), false);
  });

  it('seções alteradas comparam seção a seção e o custo por rodada é membros mais duas mesas', () => {
    assert.deepEqual(secoesAlteradas({ estrategia: { a: 1 }, campanhas: [] }, { estrategia: { a: 2 }, campanhas: [] }), ['estrategia']);
    assert.deepEqual(secoesAlteradas({ estrategia: { a: 1 } }, { estrategia: { a: 1 } }), []);
    const legal = COMITES.find((c) => c.chave === 'risco_legal')!;
    assert.equal(chamadasPorRodadaDoComite(legal), 5);
  });
});
