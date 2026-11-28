import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import { lerEdicaoPorCampos, lerFocoDoFormulario, lerIntencaoDoFormulario, lerPedidoDeMudanca, trocarSecao } from './formulariosDaEstrategia.ts';
import { centavosDeReais, dataBr, periodoBr, reais } from './formatosDoPlano.ts';

const { PedirPlanoSchema } = await import('../application/estrategiaEntradas.ts');

const ID = '44444444-4444-4444-8444-444444444444';
const VERSAO = '55555555-5555-4555-8555-555555555555';
const CLIENTE = '22222222-2222-4222-8222-222222222222';

const VALIDO = {
  tipoDePlano: 'aquisicao',
  plataformas: 'meta',
  landingPageId: CLIENTE,
  focoMarca: '1',
  objetivo: 'Gerar leads qualificados',
  inicio: '2026-12-01',
  fim: '2027-02-28',
  ousadia: 'moderado',
  retorno: '300 leads por mês',
  verba: '15.000,00',
};

describe('intenção do formulário', () => {
  it('converte reais em centavos e passa pelo esquema do serviço', () => {
    const lida = lerIntencaoDoFormulario(VALIDO);
    assert.ok(lida.ok);
    assert.equal(lida.value.intencao.verba.centavos, '1500000');
    const servico = PedirPlanoSchema.safeParse({ clienteId: CLIENTE, tipoDePlano: lida.value.tipoDePlano, plataformas: lida.value.plataformas, landingPageId: lida.value.landingPageId, foco: lida.value.foco, intencao: lida.value.intencao });
    assert.ok(servico.success);
  });

  it('aponta cada campo inválido em linguagem clara', () => {
    const lida = lerIntencaoDoFormulario({ tipoDePlano: 'x', objetivo: 'a', inicio: '2026-12-31', fim: '2026-12-01', ousadia: '', retorno: '', verba: 'abc' });
    assert.ok(!lida.ok);
    assert.deepEqual(Object.keys(lida.error).sort(), ['fim', 'foco', 'landingPageId', 'objetivo', 'ousadia', 'plataformas', 'retorno', 'tipoDePlano', 'verba']);
    assert.equal(lida.error['fim'], 'O fim não pode ser antes do início.');
  });

  it('recusa verba zero e data inexistente', () => {
    const zero = lerIntencaoDoFormulario({ ...VALIDO, verba: '0,00' });
    assert.ok(!zero.ok && zero.error['verba']);
    const data = lerIntencaoDoFormulario({ ...VALIDO, inicio: '2026-02-31' });
    assert.ok(!data.ok && data.error['inicio']);
  });
});

describe('foco do formulário', () => {
  const PRODUTO = `orla:${CLIENTE}:${CLIENTE}:contexto_produto:p1`;
  it('marca ou produtos, nunca os dois nem nenhum', () => {
    assert.deepEqual(lerFocoDoFormulario({ focoMarca: '1' }), { ok: true, value: { tipo: 'marca' } });
    assert.deepEqual(lerFocoDoFormulario({ produtos: `${PRODUTO},${PRODUTO}` }), { ok: true, value: { tipo: 'produtos', produtos: [PRODUTO] } });
    const nenhum = lerFocoDoFormulario({});
    assert.ok(!nenhum.ok && nenhum.error['foco']);
    const ambos = lerFocoDoFormulario({ focoMarca: '1', produtos: PRODUTO });
    assert.ok(!ambos.ok && ambos.error['foco']);
    const demais = lerFocoDoFormulario({ produtos: Array.from({ length: 21 }, (_, i) => `u${i}`).join(',') });
    assert.ok(!demais.ok && demais.error['foco']);
  });

  it('a intenção do formulário sem foco é recusada com erro no campo foco', () => {
    const { focoMarca: _m, ...semFoco } = VALIDO;
    const lida = lerIntencaoDoFormulario(semFoco);
    assert.ok(!lida.ok && lida.error['foco']);
    const comProdutos = lerIntencaoDoFormulario({ ...semFoco, produtos: PRODUTO });
    assert.ok(comProdutos.ok && comProdutos.value.foco.tipo === 'produtos');
  });
});

describe('verba em reais', () => {
  const casos: [string, string | null][] = [
    ['15.000,00', '1500000'],
    ['R$ 1.500,5', '150050'],
    ['1500', '150000'],
    ['1.500', '150000'],
    ['1500,99', '150099'],
    ['15.5', '1550'],
    ['', null],
    ['1,234', null],
    ['-5', null],
    ['9999999999999999', null],
  ];
  for (const [entrada, saida] of casos) {
    it(`lê "${entrada}"`, () => assert.equal(centavosDeReais(entrada), saida));
  }
});

describe('formatos pt-BR', () => {
  it('formata dinheiro e datas', () => {
    assert.equal(reais({ centavos: '1500000', moeda: 'BRL' }), 'R$ 15.000,00');
    assert.equal(dataBr('2026-12-01'), '01/12/2026');
    assert.equal(periodoBr({ inicio: '2026-12-01', fim: '2027-02-28' }), '01/12/2026 a 28/02/2027');
  });
});

describe('pedido de mudança', () => {
  it('aceita até 2000 caracteres e recusa vazio ou grande demais', () => {
    assert.ok(lerPedidoDeMudanca({ planoId: ID, versaoId: VERSAO, instrucao: 'Reduzir a verba de social' }).ok);
    const curta = lerPedidoDeMudanca({ planoId: ID, versaoId: VERSAO, instrucao: ' a ' });
    assert.ok(!curta.ok && curta.error['instrucao']);
    assert.ok(lerPedidoDeMudanca({ planoId: ID, versaoId: VERSAO, instrucao: 'x'.repeat(2000) }).ok);
    const grande = lerPedidoDeMudanca({ planoId: ID, versaoId: VERSAO, instrucao: 'x'.repeat(2001) });
    assert.ok(!grande.ok && grande.error['instrucao']);
  });

  it('recusa pedido sem a versão que a pessoa estava vendo', () => {
    const lida = lerPedidoDeMudanca({ planoId: ID, instrucao: 'Mudar algo' });
    assert.ok(!lida.ok && lida.error['versaoId']);
    const edicao = lerEdicaoPorCampos({ planoId: ID, secao: 'resumo_executivo', 'campo:objetivo': 'x' });
    assert.ok(!edicao.ok && edicao.error['versaoId']);
  });

  it('recusa plano que não é identificador', () => {
    const lida = lerPedidoDeMudanca({ planoId: 'nao-e-uuid', instrucao: 'Mudar algo' });
    assert.ok(!lida.ok && lida.error['planoId']);
  });
});

describe('edição manual de uma seção por campos', () => {
  it('lê só os pares campo:<caminho> e ignora o resto do formulário', () => {
    const lida = lerEdicaoPorCampos({ planoId: ID, versaoId: VERSAO, secao: 'resumo_executivo', clienteId: CLIENTE, 'campo:objetivo': 'Novo objetivo', 'campo:verba': '1.000,00', qualquer: 'x' });
    assert.ok(lida.ok);
    assert.deepEqual(lida.value.pares, { objetivo: 'Novo objetivo', verba: '1.000,00' });
    assert.equal(lida.value.secao, 'resumo_executivo');
  });

  it('não aceita conteúdo bruto (json), mesmo junto de campos', () => {
    const lida = lerEdicaoPorCampos({ planoId: ID, versaoId: VERSAO, secao: 'resumo_executivo', json: '{"objetivo":"x"}', 'campo:objetivo': 'ok' });
    assert.ok(!lida.ok && lida.error['edicao']);
    const soJson = lerEdicaoPorCampos({ planoId: ID, versaoId: VERSAO, secao: 'plano_de_midia', json: '{"plataformas":[]}' });
    assert.ok(!soJson.ok);
  });

  it('só as seções editáveis; sem campos, caminho vazio, valor grande ou campos demais são recusados', () => {
    assert.ok(!lerEdicaoPorCampos({ planoId: ID, versaoId: VERSAO, secao: 'lacunas', 'campo:x': 'a' }).ok);
    assert.ok(!lerEdicaoPorCampos({ planoId: ID, versaoId: VERSAO, secao: 'intencao', 'campo:x': 'a' }).ok);
    assert.ok(!lerEdicaoPorCampos({ planoId: ID, versaoId: VERSAO, secao: 'resumo_executivo' }).ok);
    assert.ok(!lerEdicaoPorCampos({ planoId: ID, versaoId: VERSAO, secao: 'resumo_executivo', 'campo:': 'a' }).ok);
    assert.ok(!lerEdicaoPorCampos({ planoId: ID, versaoId: VERSAO, secao: 'resumo_executivo', 'campo:objetivo': 'x'.repeat(12_001) }).ok);
    const demais = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`campo:c${i}`, 'a']));
    assert.ok(!lerEdicaoPorCampos({ planoId: ID, versaoId: VERSAO, secao: 'resumo_executivo', ...demais }).ok);
    assert.ok(!lerEdicaoPorCampos({ planoId: 'x', versaoId: VERSAO, secao: 'resumo_executivo', 'campo:objetivo': 'a' }).ok);
  });

  it('troca só a seção escolhida e preserva o resto', () => {
    const novo = trocarSecao({ schema_version: 1, lacunas: { itens: [1] }, medicao: { itens: [] } }, 'lacunas', { itens: [] });
    assert.deepEqual(novo, { schema_version: 1, lacunas: { itens: [] }, medicao: { itens: [] } });
    assert.equal(trocarSecao(null, 'lacunas', {}), null);
    assert.equal(trocarSecao([], 'lacunas', {}), null);
  });
});
