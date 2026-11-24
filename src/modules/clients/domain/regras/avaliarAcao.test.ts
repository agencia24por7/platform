import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { avaliarAcao, type AcaoProposta } from './avaliarAcao.ts';
import { DecisaoSchema } from './decisao.ts';
import { DefinicaoDeLimiteSchema } from './definicaoDeLimite.ts';
import { AGORA, AMANHA, decisao, definicao } from './fixturesDeTeste.ts';
import { derivarVigentes } from './vigentes.ts';
import type { Valor } from './valor.ts';

const reais = (centavos: string): Valor => ({ unidade: 'brl_centavos', centavos, moeda: 'BRL' });

function acao(sobrescrita: Partial<AcaoProposta> = {}): AcaoProposta {
  return { medida: 'gasto', valorProposto: reais('1000000'), periodo: 'mes', escopo: 'cliente', agora: AGORA, ...sobrescrita };
}

const avaliar = (decisoes: Parameters<typeof derivarVigentes>[0], proposta: AcaoProposta, definicoes = [definicao()]) =>
  avaliarAcao(definicoes, derivarVigentes(decisoes, AGORA), proposta);

describe('avaliarAcao: teto', () => {
  it('igual ao teto é permitida', () => {
    assert.deepEqual(avaliar([decisao()], acao()), { resultado: 'permitida' });
  });
  it('estourar o teto por um centavo bloqueia e aponta a decisão', () => {
    const teto = decisao();
    const resultado = avaliar([teto], acao({ valorProposto: reais('1000001') }));
    assert.equal(resultado.resultado, 'bloqueada');
    assert.equal(resultado.resultado === 'bloqueada' && resultado.decisaoQueBloqueia.id, teto.id);
  });
  it('abaixo do teto é permitida', () => {
    assert.equal(avaliar([decisao()], acao({ valorProposto: reais('1') })).resultado, 'permitida');
  });
});

describe('avaliarAcao: piso é o inverso', () => {
  const piso = definicao({
    key: 'eficiencia.retorno_minimo',
    medida: 'retorno',
    unidade: 'razao',
    periodo: 'total',
    sentido: 'piso',
    categoria: 'eficiencia',
    faixaMin: '0',
    faixaMax: '100',
  });
  const limite = decisao({
    categoria: 'eficiencia',
    chave: 'eficiencia.retorno_minimo',
    definicaoChave: 'eficiencia.retorno_minimo',
    valor: { unidade: 'razao', decimal: '3.00' },
  });
  const proposta = (decimal: string) =>
    acao({ medida: 'retorno', periodo: 'total', valorProposto: { unidade: 'razao', decimal } });

  it('abaixo do piso bloqueia; igual ou acima permite', () => {
    assert.equal(avaliar([limite], proposta('2.99'), [piso]).resultado, 'bloqueada');
    assert.equal(avaliar([limite], proposta('3'), [piso]).resultado, 'permitida');
    assert.equal(avaliar([limite], proposta('3.01'), [piso]).resultado, 'permitida');
  });
});

describe('avaliarAcao: aplicabilidade', () => {
  it('sem limite para a medida ou o período: sem_regra', () => {
    assert.deepEqual(avaliar([decisao()], acao({ medida: 'custo_por_lead' })), { resultado: 'sem_regra' });
    assert.deepEqual(avaliar([decisao()], acao({ periodo: 'dia' })), { resultado: 'sem_regra' });
    assert.deepEqual(avaliar([], acao()), { resultado: 'sem_regra' });
  });
  it('limite de plataforma só vale para a ação naquela plataforma; o do cliente vale para todas', () => {
    const noGoogle = decisao({ escopo: 'plataforma:google_ads', valor: reais('500') });
    const proposta = acao({ valorProposto: reais('501') });
    assert.equal(avaliar([noGoogle], proposta).resultado, 'sem_regra');
    assert.equal(avaliar([noGoogle], { ...proposta, escopo: 'plataforma:meta' }).resultado, 'sem_regra');
    assert.equal(avaliar([noGoogle], { ...proposta, escopo: 'plataforma:google_ads' }).resultado, 'bloqueada');
    assert.equal(avaliar([decisao({ valor: reais('500') })], { ...proposta, escopo: 'plataforma:meta' }).resultado, 'bloqueada');
  });
  it('proposta e vigência futura não impõem nada', () => {
    const proposta = decisao({ status: 'proposta', valor: reais('1') });
    const futura = decisao({ vigenciaInicio: AMANHA, valor: reais('1') });
    assert.equal(avaliar([proposta, futura], acao()).resultado, 'sem_regra');
  });
  it('a decisão usa a versão da definição em que foi registrada', () => {
    const v1 = definicao({ version: 1, sentido: 'teto' });
    const v2 = definicao({ version: 2, sentido: 'piso' });
    const limite = decisao({ definicaoVersao: 2, valor: reais('2000000') });
    assert.equal(avaliar([limite], acao({ valorProposto: reais('1000000') }), [v1, v2]).resultado, 'bloqueada');
  });
  it('definição ausente para a versão da decisão vigente falha fechado: bloqueia com a decisão', () => {
    const orfa = decisao({ definicaoVersao: 9, forca: 'orientacao' });
    const resultado = avaliar([orfa], acao({ medida: 'custo_por_lead', valorProposto: reais('1') }));
    assert.equal(resultado.resultado, 'bloqueada');
    assert.equal(resultado.resultado === 'bloqueada' && resultado.decisaoQueBloqueia.id, orfa.id);
    assert.equal(resultado.resultado === 'bloqueada' && resultado.motivo, 'definicao_ausente');
    assert.equal(avaliar([decisao()], acao(), []).resultado, 'bloqueada');
  });
  it('unidades incompatíveis bloqueiam força dura em vez de passar', () => {
    const proposta = acao({ valorProposto: { unidade: 'razao', decimal: '1' } });
    assert.equal(avaliar([decisao()], proposta).resultado, 'bloqueada');
  });
});

describe('avaliarAcao: força', () => {
  it('orientação violada devolve permitida com avisos', () => {
    const orientacao = decisao({ forca: 'orientacao' });
    const resultado = avaliar([orientacao], acao({ valorProposto: reais('9999999') }));
    assert.equal(resultado.resultado, 'permitida');
    assert.deepEqual(resultado.resultado === 'permitida' && resultado.avisos?.map((a) => a.decisaoId), [orientacao.id]);
  });
  it('dura bloqueia mesmo com orientação também violada', () => {
    const orientacao = decisao({ forca: 'orientacao', escopo: 'plataforma:google_ads', valor: reais('1') });
    const dura = decisao({ valor: reais('2') });
    const resultado = avaliar([orientacao, dura], acao({ valorProposto: reais('3'), escopo: 'plataforma:google_ads' }));
    assert.equal(resultado.resultado === 'bloqueada' && resultado.decisaoQueBloqueia.id, dura.id);
  });
});

describe('avaliarAcao: o limite é dado, não código', () => {
  it('definição inventada só no teste é validada pelo zod e imposta pela função', () => {
    const chaveInventada = 'zzz_inventada.custo_maximo_por_visita_ao_pe_de_sol';
    const bruta = {
      key: chaveInventada,
      version: 7,
      nome: 'Custo máximo por visita',
      descricao: 'Tipo criado apenas neste teste.',
      categoria: 'eficiencia',
      medida: 'custo_por_aquisicao',
      unidade: 'brl_centavos',
      periodo: 'dia',
      sentido: 'teto',
      faixaMin: '1',
      faixaMax: '50000',
      escoposAceitos: ['cliente', 'plataforma:tiktok'],
      essencial: false,
      ativo: true,
    };
    const parsedDefinicao = DefinicaoDeLimiteSchema.safeParse(bruta);
    assert.ok(parsedDefinicao.success);

    const bruta2 = {
      ...decisao({
        categoria: 'eficiencia',
        chave: chaveInventada,
        definicaoChave: chaveInventada,
        definicaoVersao: 7,
        escopo: 'plataforma:tiktok',
        valor: reais('2500'),
      }),
    };
    const parsedDecisao = DecisaoSchema.safeParse(bruta2);
    assert.ok(parsedDecisao.success);

    const conjunto = derivarVigentes([parsedDecisao.data], AGORA);
    const base = { medida: 'custo_por_aquisicao', periodo: 'dia', escopo: 'plataforma:tiktok', agora: AGORA } as const;
    const definicoes = [parsedDefinicao.data];
    assert.equal(avaliarAcao(definicoes, conjunto, { ...base, valorProposto: reais('2500') }).resultado, 'permitida');
    assert.equal(avaliarAcao(definicoes, conjunto, { ...base, valorProposto: reais('2501') }).resultado, 'bloqueada');
    assert.equal(avaliarAcao(definicoes, conjunto, { ...base, valorProposto: reais('2501'), escopo: 'plataforma:meta' }).resultado, 'sem_regra');
  });
});
