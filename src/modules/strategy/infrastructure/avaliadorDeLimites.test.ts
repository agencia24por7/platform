import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { Decisao, DefinicaoDeLimite } from '../../clients/domain/regras/index.ts';
import { ORGANIZACAO_ID, CLIENTE_ID, planoCompleto } from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { criarAvaliadorDeLimites, dividirParaCima, medidasComLimiteVigente, mesesDoHorizonte } = await import('./avaliadorDeLimites.ts');
const { ok, err } = await import('../../../shared/result/result.ts');
const { failure } = await import('../../../shared/result/failure.ts');

const AGORA = new Date('2026-11-25T12:00:00Z');

const definicao = (key: string, medida: string, periodo: string): DefinicaoDeLimite =>
  ({
    key,
    version: 1,
    nome: key,
    descricao: '',
    categoria: 'investimento',
    medida,
    periodo,
    sentido: 'teto',
    unidade: 'brl_centavos',
    escoposAceitos: ['cliente'],
    essencial: true,
    ativo: true,
  }) as unknown as DefinicaoDeLimite;

const decisao = (chave: string, definicaoChave: string, centavos: string): Decisao =>
  ({
    id: `d-${chave}`,
    numero: 1,
    clienteId: CLIENTE_ID,
    natureza: 'limite',
    chave,
    escopo: 'cliente',
    status: 'vigente',
    forca: 'dura',
    valor: { unidade: 'brl_centavos', centavos, moeda: 'BRL' },
    vigenciaInicio: new Date('2026-01-01T00:00:00Z'),
    vigenciaFim: null,
    definicaoChave,
    definicaoVersao: 1,
  }) as unknown as Decisao;

const regrasCom = (decisoes: Decisao[], definicoes: DefinicaoDeLimite[]) => ({
  async conjuntoParaAgente() {
    return ok({ decisoes, conflitos: [], definicoes, hash: 'h', geradoEm: AGORA } as never);
  },
});

const gasto = (centavos: string) => ({ unidade: 'brl_centavos' as const, centavos, moeda: 'BRL' as const });

describe('mesesDoHorizonte e dividirParaCima', () => {
  it('arredonda para cima em blocos de 30 dias, no mínimo 1', () => {
    assert.equal(mesesDoHorizonte('2026-12-01', '2027-02-28'), 3);
    assert.equal(mesesDoHorizonte('2026-12-01', '2026-12-01'), 1);
    assert.equal(mesesDoHorizonte('2026-12-01', '2026-12-31'), 2);
    assert.equal(mesesDoHorizonte('2026-12-01', '2027-02-27'), 3);
    assert.equal(dividirParaCima(1000n, 3), 334n);
    assert.equal(dividirParaCima(900n, 3), 300n);
  });
});

describe('avaliadorDeLimites', () => {
  const plano = planoCompleto();
  const horizonteDe3Meses = { ...plano, intencao: { ...plano.intencao, horizonte: { inicio: '2026-12-01', fim: '2027-02-28' } } };

  it('gasto: a verba total dividida pelos meses do horizonte é comparada ao teto MENSAL', async () => {
    const avaliador = criarAvaliadorDeLimites({
      regras: regrasCom([decisao('investimento.teto_mensal', 'investimento.teto_mensal', '100000')], [definicao('investimento.teto_mensal', 'gasto', 'mes')]),
      relogio: { agora: () => AGORA },
    });
    const resultado = await avaliador.avaliador(ORGANIZACAO_ID, CLIENTE_ID, horizonteDe3Meses);
    assert.ok(resultado.ok);
    if (!resultado.ok) return;
    assert.equal(resultado.value('gasto', gasto('300000')), 'ok');
    assert.equal(resultado.value('gasto', gasto('300001')), 'bloqueia');
  });

  it('gasto: teto TOTAL também é avaliado, com a verba inteira', async () => {
    const avaliador = criarAvaliadorDeLimites({
      regras: regrasCom([decisao('investimento.teto_total', 'investimento.teto_total', '500000')], [definicao('investimento.teto_total', 'gasto', 'total')]),
      relogio: { agora: () => AGORA },
    });
    const resultado = await avaliador.avaliador(ORGANIZACAO_ID, CLIENTE_ID, horizonteDe3Meses);
    assert.ok(resultado.ok);
    if (!resultado.ok) return;
    assert.equal(resultado.value('gasto', gasto('500000')), 'ok');
    assert.equal(resultado.value('gasto', gasto('500001')), 'bloqueia');
  });

  const avaliadorCom = async (decisoes: Decisao[], definicoes: DefinicaoDeLimite[]) => {
    const avaliador = criarAvaliadorDeLimites({ regras: regrasCom(decisoes, definicoes), relogio: { agora: () => AGORA } });
    const resultado = await avaliador.avaliador(ORGANIZACAO_ID, CLIENTE_ID, horizonteDe3Meses);
    assert.ok(resultado.ok);
    return resultado.ok ? resultado.value : () => 'sem_regra' as const;
  };
  const cpl = [decisao('aquisicao.cpl', 'aquisicao.cpl', '100')];
  const defCpl = [definicao('aquisicao.cpl', 'custo_por_lead', 'mes')];

  it('sem nenhum limite vigente para a medida é sem_regra', async () => {
    const semRegras = await avaliadorCom([], []);
    assert.equal(semRegras('gasto', gasto('1')), 'sem_regra');
    assert.equal(semRegras('custo_por_lead', gasto('1')), 'sem_regra');
    const soGasto = await avaliadorCom([decisao('investimento.teto_mensal', 'investimento.teto_mensal', '100000')], [definicao('investimento.teto_mensal', 'gasto', 'mes')]);
    assert.equal(soGasto('custo_por_lead', gasto('99999')), 'sem_regra');
  });

  it('limite de custo por lead vigente bloqueia meta acima dele e aprova abaixo', async () => {
    const avaliar = await avaliadorCom(cpl, defCpl);
    assert.equal(avaliar('custo_por_lead', gasto('101')), 'bloqueia');
    assert.equal(avaliar('custo_por_lead', gasto('100')), 'ok');
    assert.equal(avaliar('custo_por_lead', gasto('99')), 'ok');
    assert.equal(avaliar('custo_por_aquisicao', gasto('99999')), 'sem_regra');
  });

  it('o valor é avaliado em todos os períodos e escopos que as definições declaram', async () => {
    const avaliar = await avaliadorCom(
      [decisao('aquisicao.cpl_mes', 'aquisicao.cpl_mes', '100'), decisao('aquisicao.cpl_total', 'aquisicao.cpl_total', '80')],
      [definicao('aquisicao.cpl_mes', 'custo_por_lead', 'mes'), definicao('aquisicao.cpl_total', 'custo_por_lead', 'total')],
    );
    assert.equal(avaliar('custo_por_lead', gasto('80')), 'ok');
    assert.equal(avaliar('custo_por_lead', gasto('90')), 'bloqueia');
  });

  it('gasto diário avalia a verba dividida pelos dias do horizonte', async () => {
    const avaliar = await avaliadorCom([decisao('investimento.teto_diario', 'investimento.teto_diario', '10000')], [definicao('investimento.teto_diario', 'gasto', 'dia')]);
    assert.equal(avaliar('gasto', gasto('900000')), 'ok');
    assert.equal(avaliar('gasto', gasto('900001')), 'bloqueia');
  });

  it('limite que existe e é incomparável bloqueia, com motivo claro, e nunca vira sem_regra', async () => {
    const avaliar = await avaliadorCom(cpl, defCpl);
    assert.equal(avaliar('custo_por_lead', { unidade: 'razao', decimal: '2.5' }), 'bloqueia');
    const { avaliarContraLimites } = await import('./avaliadorDeLimites.ts');
    const vigentes = { decisoes: cpl, conflitos: [], porChaveEEscopo: new Map() };
    const incomparavel = avaliarContraLimites('custo_por_lead', { unidade: 'razao', decimal: '2.5' }, cpl, defCpl, vigentes, { dias: 90, meses: 3 }, AGORA);
    assert.equal(incomparavel.veredito, 'bloqueia');
    assert.match(incomparavel.motivo, /incomparável/);
    const semDefinicao = avaliarContraLimites('custo_por_lead', gasto('1'), cpl, [], vigentes, { dias: 90, meses: 3 }, AGORA);
    assert.equal(semDefinicao.veredito, 'bloqueia');
    assert.match(semDefinicao.motivo, /sem definição/);
    assert.equal(avaliarContraLimites('custo_por_lead', gasto('1'), [], [], { decisoes: [], conflitos: [], porChaveEEscopo: new Map() }, { dias: 90, meses: 3 }, AGORA).veredito, 'sem_regra');
  });

  it('declarar a lacuna limite_ausente não salva o plano quando o limite existe', async () => {
    const { rodarGates } = await import('../domain/gate/rodarGates.ts');
    const { checarLimitesDoCliente } = await import('../domain/gate/limitesDoCliente.ts');
    const { contextoDeTeste } = await import('../domain/fixturesDeTeste.ts');
    const comLacuna = planoCompleto();
    comLacuna.lacunas.itens.push({ id: 'l_cpl', tipo: 'limite_ausente', medida: 'custo_por_lead', descricao: 'Sem limite de custo por lead.', impacto: 'Meta de custo por lead sem teto.' });
    const limiteReal = await avaliadorCom([decisao('aquisicao.cpl', 'aquisicao.cpl', '4000')], [definicao('aquisicao.cpl', 'custo_por_lead', 'mes')]);
    const ctx = contextoDeTeste({ plano: comLacuna, avaliarLimite: limiteReal });
    const resultado = checarLimitesDoCliente(ctx);
    assert.equal(resultado.resultado, 'reprovado');
    assert.ok(resultado.onde.some((local) => local.includes('m_canal') && local.includes('viola limite')));
    assert.equal(rodarGates(ctx).resultado, 'reprovado');

    comLacuna.lacunas.itens.push({ id: 'l_gasto', tipo: 'limite_ausente', medida: 'gasto', descricao: 'Sem limite de gasto.', impacto: 'Verba sem teto.' });
    const semLimite = await avaliadorCom([], []);
    assert.equal(checarLimitesDoCliente(contextoDeTeste({ plano: comLacuna, avaliarLimite: semLimite })).resultado, 'aprovado');
  });

  it('falha ao ler as regras vira limites_indisponiveis (falha fechada, sem exceção)', async () => {
    const falhou = criarAvaliadorDeLimites({ regras: { async conjuntoParaAgente() { return err(failure('unavailable', 'x')); } } });
    const a = await falhou.avaliador(ORGANIZACAO_ID, CLIENTE_ID, horizonteDe3Meses);
    assert.equal(!a.ok && a.error.codigo, 'limites_indisponiveis');
    const quebrou = criarAvaliadorDeLimites({ regras: { async conjuntoParaAgente() { throw new Error('x'); } } });
    const b = await quebrou.avaliador(ORGANIZACAO_ID, CLIENTE_ID, horizonteDe3Meses);
    assert.equal(!b.ok && b.error.codigo, 'limites_indisponiveis');
  });
});

describe('medidasComLimite', () => {
  it('expõe as medidas com limite vigente, sem repetir e sem as de limite vencido ou sem definição', async () => {
    const vencido = { ...decisao('vencido', 'retorno-mes', '1'), vigenciaFim: new Date('2026-06-01T00:00:00Z') } as Decisao;
    const decisoes = [decisao('teto', 'gasto-mes', '1000000'), decisao('teto2', 'gasto-total', '2'), decisao('cpl', 'cpl-mes', '5000'), vencido];
    const definicoes = [definicao('gasto-mes', 'gasto', 'mes'), definicao('gasto-total', 'gasto', 'total'), definicao('cpl-mes', 'custo_por_lead', 'mes'), definicao('retorno-mes', 'retorno', 'mes')];
    assert.deepEqual(medidasComLimiteVigente(decisoes, definicoes, AGORA), ['custo_por_lead', 'gasto']);
    const avaliador = await criarAvaliadorDeLimites({ regras: regrasCom(decisoes, definicoes), relogio: { agora: () => AGORA } }).avaliador(ORGANIZACAO_ID, CLIENTE_ID, planoCompleto());
    assert.ok(avaliador.ok);
    assert.deepEqual(avaliador.value.medidasComLimite, ['custo_por_lead', 'gasto']);
  });

  it('sem nenhum limite vigente a lista é vazia', async () => {
    const avaliador = await criarAvaliadorDeLimites({ regras: regrasCom([], []), relogio: { agora: () => AGORA } }).avaliador(ORGANIZACAO_ID, CLIENTE_ID, planoCompleto());
    assert.ok(avaliador.ok);
    assert.deepEqual(avaliador.value.medidasComLimite, []);
  });

  it('limite vigente sem definição entra na lista como todas as medidas (não dá para saber qual é)', async () => {
    const semDefinicao = decisao('orfao', 'nao-existe', '5');
    assert.deepEqual(medidasComLimiteVigente([semDefinicao], [], AGORA), ['custo_por_aquisicao', 'custo_por_lead', 'gasto', 'retorno']);
    const avaliador = await criarAvaliadorDeLimites({ regras: regrasCom([semDefinicao], []), relogio: { agora: () => AGORA } }).avaliador(ORGANIZACAO_ID, CLIENTE_ID, planoCompleto());
    assert.ok(avaliador.ok);
    assert.equal(avaliador.value.medidasComLimite.length, 4);
  });
});
