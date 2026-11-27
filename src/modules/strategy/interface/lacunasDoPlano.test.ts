import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URN_BENCHMARK_B, planoCompleto } from '../domain/fixturesDeTeste.ts';
import { lerPlano } from '../domain/plano.ts';
import { TEXTO_DO_BOTAO_APROVAR_SUGESTOES, lacunasDoPlano } from './lacunasDoPlano.ts';

const plano = () => {
  const base = planoCompleto();
  const lido = lerPlano({
    ...base,
    lacunas: {
      itens: [
        { id: 'lim_cpl', tipo: 'limite_ausente', medida: 'custo_por_lead', descricao: 'Sem teto de CPL.', impacto: 'Meta sem teto.', regra: { natureza: 'limite', escopo: 'cliente' }, sugestao: { valor: { unidade: 'brl_centavos', centavos: '5000', moeda: 'BRL' }, origem: 'evidencia', evidencias: [{ urn: URN_BENCHMARK_B, papel: 'favor' }], justificativa: 'Benchmark B.' } },
        { id: 'lim_gasto', tipo: 'limite_ausente', medida: 'gasto', descricao: 'Sem teto de gasto.', impacto: 'Verba sem teto.', regra: { natureza: 'limite', escopo: 'cliente' }, sugestao: { valor: null, origem: 'hipotese', evidencias: [], justificativa: 'Sem dado no Brain.' } },
        { id: 'dado', tipo: 'dado_ausente', descricao: 'Sem margem.', impacto: 'Meta é hipótese.' },
      ],
    },
  });
  assert.ok(lido.ok, JSON.stringify(lido));
  return lido.ok ? lido.value : base;
};

describe('lacunas do plano para a tela', () => {
  it('o texto do botão vem de uma constante exportada', () => {
    assert.equal(TEXTO_DO_BOTAO_APROVAR_SUGESTOES, 'Aprovar sugestões do plano');
  });

  it('com evidência traz valor e origem; sem evidência é só "sem sugestão" e fica editável', () => {
    const lista = lacunasDoPlano({ plano: plano(), regrasVigentes: [], papel: 'admin', podeGravarRegras: true });
    assert.deepEqual(lista.map((l) => [l.id, l.origem, l.valorLegivel, l.editavel, l.podeAprovar]), [
      ['lim_cpl', 'evidencia', 'R$ 50,00', true, true],
      ['lim_gasto', 'hipotese', null, true, false],
      ['dado', 'sem_sugestao', null, false, false],
    ]);
    assert.deepEqual(lista[0]?.evidencias, [URN_BENCHMARK_B]);
    assert.equal(lista[0]?.justificativa, 'Benchmark B.');
  });

  it('operator e viewer não aprovam, e sem o cadastro de regras ninguém aprova', () => {
    for (const papel of ['operator', 'viewer'] as const) {
      assert.ok(lacunasDoPlano({ plano: plano(), regrasVigentes: [], papel, podeGravarRegras: true }).every((l) => !l.podeAprovar && !l.editavel));
    }
    assert.ok(lacunasDoPlano({ plano: plano(), regrasVigentes: [], papel: 'owner', podeGravarRegras: false }).every((l) => !l.podeAprovar));
  });

  it('lacuna atendida por regra vigente some da lista', () => {
    const lista = lacunasDoPlano({
      plano: plano(),
      regrasVigentes: [{ natureza: 'limite', chave: 'eficiencia.cpl', escopo: 'cliente', medida: 'custo_por_lead' }],
      papel: 'admin',
      podeGravarRegras: true,
    });
    assert.deepEqual(lista.map((l) => l.id), ['lim_gasto', 'dado']);
  });

  it('regra de outro escopo ou outra medida não atende a lacuna; plano nulo dá lista vazia', () => {
    const lista = lacunasDoPlano({
      plano: plano(),
      regrasVigentes: [
        { natureza: 'limite', chave: 'eficiencia.cpl', escopo: 'plataforma:meta', medida: 'custo_por_lead' },
        { natureza: 'limite', chave: 'investimento.gasto', escopo: 'cliente', medida: 'retorno' },
      ],
      papel: 'admin',
      podeGravarRegras: true,
    });
    assert.equal(lista.length, 3);
    assert.deepEqual(lacunasDoPlano({ plano: null, regrasVigentes: [], papel: 'admin', podeGravarRegras: true }), []);
  });
});
