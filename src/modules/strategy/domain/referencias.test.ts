import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLIENTE_ID,
  OUTRO_CLIENTE_ID,
  ORGANIZACAO_ID,
  URN_BENCHMARK_B,
  URN_DESEMPENHO,
  URN_LIMITE,
  URN_REGRA_LEGAL,
  afirmacao,
  evidencia,
  planoCompleto,
  planoMinimo,
} from './fixturesDeTeste.ts';
import { PAPEL_NO_BANCO, citacoesDoPlano, listarReferencias, referenciasDoPlano, secoesQueCitam } from './referencias.ts';
import { criarUrn } from '../../brain/domain/urn.ts';

const escopo = { organizacaoId: ORGANIZACAO_ID, clienteId: CLIENTE_ID };

describe('referenciasDoPlano', () => {
  it('devolve a lista deduplicada e ordenada', () => {
    const plano = planoCompleto();
    const resultado = referenciasDoPlano(plano, escopo);
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    const chaves = resultado.value.map((r) => `${r.urn}|${r.papel}`);
    assert.equal(new Set(chaves).size, chaves.length);
    const urns = resultado.value.map((r) => r.urn);
    assert.deepEqual(urns, [...urns].sort((a, b) => a.localeCompare(b)));
    assert.ok(resultado.value.some((r) => r.urn === URN_DESEMPENHO && r.papel === 'premissa'));
    assert.ok(resultado.value.some((r) => r.urn === URN_DESEMPENHO && r.papel === 'contra'));
    assert.ok(resultado.value.some((r) => r.urn === URN_LIMITE && r.papel === 'favor'));
  });

  it('recusa URN de outro cliente e de outra organização', () => {
    const plano = planoMinimo();
    const alheia = criarUrn(ORGANIZACAO_ID, OUTRO_CLIENTE_ID, 'conhecimento', 'x');
    plano.diagnostico.o_que_os_dados_mostram.push(afirmacao('x', evidencia(alheia)));
    const outraOrg = criarUrn('44444444-4444-4444-8444-444444444444', CLIENTE_ID, 'conhecimento', 'y');
    plano.diagnostico.o_que_os_dados_mostram.push(afirmacao('y', evidencia(outraOrg)));
    const resultado = referenciasDoPlano(plano, escopo);
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.deepEqual(resultado.error.map((e) => e.codigo).sort(), ['cliente_diferente', 'organizacao_diferente']);
  });

  it('recusa URN fora do formato', () => {
    const plano = planoMinimo();
    plano.diagnostico.o_que_os_dados_mostram.push(afirmacao('x', evidencia('orla:quebrada')));
    const resultado = referenciasDoPlano(plano, escopo);
    assert.equal(!resultado.ok && resultado.error[0]?.codigo, 'urn_invalida');
  });

  it('mapeia o papel para o valor do banco', () => {
    assert.deepEqual(PAPEL_NO_BANCO, { favor: 'evidencia_favor', contra: 'evidencia_contra', premissa: 'premissa' });
  });
});

describe('citações', () => {
  it('apontam seção e item do plano', () => {
    const citacoes = citacoesDoPlano(planoCompleto());
    assert.ok(citacoes.some((c) => c.trecho === 'metas_e_metricas/m_neg' && c.urn === URN_BENCHMARK_B));
    assert.ok(citacoes.some((c) => c.trecho === 'resumo_executivo'));
    assert.ok(citacoes.some((c) => c.trecho === 'riscos_e_regras/rg1' && c.urn === URN_REGRA_LEGAL));
    assert.equal(listarReferencias(planoMinimo()).length > 0, true);
  });

  it('secoesQueCitam lista as seções na ordem do plano, sem repetir', () => {
    const secoes = secoesQueCitam(planoCompleto(), URN_BENCHMARK_B);
    assert.deepEqual(secoes, ['resumo_executivo', 'estrategia', 'metas_e_metricas']);
    assert.deepEqual(secoesQueCitam(planoCompleto(), criarUrn(ORGANIZACAO_ID, CLIENTE_ID, 'x_y', 'nada')), []);
  });
});

describe('referências implícitas do pacote', () => {
  it('toda entrada de limite, regra e decisão vira premissa com o hash do pacote, e só elas', async () => {
    const { referenciasImplicitasDoPacote, combinarReferencias, TIPOS_DE_REGRA_NO_PACOTE } = await import('./referencias.ts');
    const { pacoteDeTeste } = await import('./fixturesDeTeste.ts');
    assert.deepEqual([...TIPOS_DE_REGRA_NO_PACOTE], ['limite', 'regra', 'decisao']);
    const pacote = pacoteDeTeste();
    const implicitas = referenciasImplicitasDoPacote(pacote);
    assert.ok(implicitas.length > 0);
    assert.ok(implicitas.every((r) => r.papel === 'premissa'));
    const esperadas = pacote.entradas.filter((e) => TIPOS_DE_REGRA_NO_PACOTE.includes(e.tipo));
    assert.deepEqual(implicitas.map((r) => r.urn).sort(), esperadas.map((e) => e.urn).sort());
    for (const ref of implicitas) assert.equal(ref.hash, pacote.entradas.find((e) => e.urn === ref.urn)!.hash);
  });

  it('combinar deduplica por urn e papel, e as implícitas não entram nas citações do conteúdo', async () => {
    const { combinarReferencias, referenciasDoPlano, referenciasImplicitasDoPacote } = await import('./referencias.ts');
    const { pacoteDeTeste, planoCompleto, ORGANIZACAO_ID, CLIENTE_ID, URN_LIMITE } = await import('./fixturesDeTeste.ts');
    const implicitas = referenciasImplicitasDoPacote(pacoteDeTeste());
    const citada = { urn: URN_LIMITE, hash: 'f'.repeat(64), papel: 'premissa' as const };
    const combinadas = combinarReferencias([citada], implicitas);
    assert.equal(combinadas.filter((r) => r.urn === URN_LIMITE && r.papel === 'premissa').length, 1);
    assert.equal(combinadas.find((r) => r.urn === URN_LIMITE)!.hash, citada.hash);
    const doConteudo = referenciasDoPlano(planoCompleto(), { organizacaoId: ORGANIZACAO_ID, clienteId: CLIENTE_ID });
    assert.ok(doConteudo.ok);
    const urnsDoConteudo = doConteudo.ok ? doConteudo.value.map((r) => r.urn) : [];
    assert.ok(!urnsDoConteudo.some((urn) => implicitas.some((i) => i.urn === urn && !JSON.stringify(planoCompleto()).includes(urn))));
  });
});
