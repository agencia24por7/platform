import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import { lerEdicaoDeSecao, lerIntencaoDoFormulario, lerPedidoDeMudanca, trocarSecao } from './formulariosDaEstrategia.ts';
import { centavosDeReais, dataBr, periodoBr, reais } from './formatosDoPlano.ts';

const { PedirPlanoSchema } = await import('../application/estrategiaEntradas.ts');

const ID = '44444444-4444-4444-8444-444444444444';
const VERSAO = '55555555-5555-4555-8555-555555555555';
const CLIENTE = '22222222-2222-4222-8222-222222222222';

const VALIDO = {
  tipoDePlano: 'aquisicao',
  plataformas: 'meta',
  landingPageId: CLIENTE,
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
    const servico = PedirPlanoSchema.safeParse({ clienteId: CLIENTE, tipoDePlano: lida.value.tipoDePlano, plataformas: lida.value.plataformas, landingPageId: lida.value.landingPageId, intencao: lida.value.intencao });
    assert.ok(servico.success);
  });

  it('aponta cada campo inválido em linguagem clara', () => {
    const lida = lerIntencaoDoFormulario({ tipoDePlano: 'x', objetivo: 'a', inicio: '2026-12-31', fim: '2026-12-01', ousadia: '', retorno: '', verba: 'abc' });
    assert.ok(!lida.ok);
    assert.deepEqual(Object.keys(lida.error).sort(), ['fim', 'landingPageId', 'objetivo', 'ousadia', 'plataformas', 'retorno', 'tipoDePlano', 'verba']);
    assert.equal(lida.error['fim'], 'O fim não pode ser antes do início.');
  });

  it('recusa verba zero e data inexistente', () => {
    const zero = lerIntencaoDoFormulario({ ...VALIDO, verba: '0,00' });
    assert.ok(!zero.ok && zero.error['verba']);
    const data = lerIntencaoDoFormulario({ ...VALIDO, inicio: '2026-02-31' });
    assert.ok(!data.ok && data.error['inicio']);
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
    const edicao = lerEdicaoDeSecao({ planoId: ID, secao: 'lacunas', json: '{}' });
    assert.ok(!edicao.ok && edicao.error['versaoId']);
  });

  it('recusa plano que não é identificador', () => {
    const lida = lerPedidoDeMudanca({ planoId: 'nao-e-uuid', instrucao: 'Mudar algo' });
    assert.ok(!lida.ok && lida.error['planoId']);
  });
});

describe('edição manual de uma seção', () => {
  it('lê o JSON da seção', () => {
    const lida = lerEdicaoDeSecao({ planoId: ID, versaoId: VERSAO, secao: 'lacunas', json: '{"itens":[]}' });
    assert.ok(lida.ok);
    assert.deepEqual(lida.value.valor, { itens: [] });
  });

  it('JSON inválido volta mensagem sem repetir o texto digitado', () => {
    const lida = lerEdicaoDeSecao({ planoId: ID, versaoId: VERSAO, secao: 'lacunas', json: '{segredo: 1' });
    assert.ok(!lida.ok);
    assert.ok(!JSON.stringify(lida.error).includes('segredo'));
    assert.match(lida.error['json'] ?? '', /JSON válido/);
  });

  it('recusa seção desconhecida, vazio e plano inválido', () => {
    assert.ok(!lerEdicaoDeSecao({ planoId: ID, versaoId: VERSAO, secao: 'outra', json: '{}' }).ok);
    assert.ok(!lerEdicaoDeSecao({ planoId: ID, versaoId: VERSAO, secao: 'lacunas', json: '  ' }).ok);
    assert.ok(!lerEdicaoDeSecao({ planoId: 'x', secao: 'lacunas', json: '{}' }).ok);
  });

  it('troca só a seção escolhida e preserva o resto', () => {
    const novo = trocarSecao({ schema_version: 1, lacunas: { itens: [1] }, medicao: { itens: [] } }, 'lacunas', { itens: [] });
    assert.deepEqual(novo, { schema_version: 1, lacunas: { itens: [] }, medicao: { itens: [] } });
    assert.equal(trocarSecao(null, 'lacunas', {}), null);
    assert.equal(trocarSecao([], 'lacunas', {}), null);
  });
});
