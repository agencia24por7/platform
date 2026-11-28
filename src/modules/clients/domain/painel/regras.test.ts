import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agruparPorCategoria,
  buscaDaLinha,
  centavosParaCampo,
  chaveDaRegra,
  decimalDoCampo,
  estadoDoBlocoDeRegras,
  faixaLegivel,
  lerFiltrosDaLinha,
  podeRegistrarOuMexer,
  reaisParaCentavos,
  rotuloDoEscopo,
  valorDoCampo,
  valorParaCampo,
  retornoDaAcaoDeRegras,
} from './regras.ts';
import { formatarValor } from '../regras/index.ts';
import { decisao } from '../regras/fixturesDeTeste.ts';

describe('reaisParaCentavos', () => {
  const casos: readonly (readonly [string, string | null])[] = [
    ['10000', '1000000'],
    ['10.000', '1000000'],
    ['10.000,00', '1000000'],
    ['R$ 1.234,56', '123456'],
    ['1234,5', '123450'],
    ['1234.56', '123456'],
    ['0,07', '7'],
    ['0', '0'],
    ['0,00', '0'],
    ['19,99', '1999'],
    ['0,29', '29'],
    ['1.005,01', '100501'],
    ['', null],
    ['abc', null],
    ['-5', null],
    ['1,234', null],
    ['1.2.3', null],
    ['10.00,5', null],
    ['99999999999999,99', null],
  ];
  for (const [entrada, esperado] of casos) {
    it(`"${entrada}" vira ${esperado === null ? 'recusa' : esperado}`, () => {
      assert.equal(reaisParaCentavos(entrada), esperado);
    });
  }

  it('não passa por ponto flutuante: valores que o float erraria saem exatos', () => {
    assert.equal(reaisParaCentavos('0,29'), '29');
    assert.equal(reaisParaCentavos('1.234.567.890.123,45'), '123456789012345');
  });
});

describe('centavosParaCampo e valorParaCampo', () => {
  it('ida e volta sem perda', () => {
    for (const centavos of ['0', '7', '29', '123456', '1000000']) {
      assert.equal(reaisParaCentavos(centavosParaCampo(centavos)), centavos);
    }
  });
  it('formata o campo de edição', () => {
    assert.equal(centavosParaCampo('1000000'), '10000,00');
    assert.equal(centavosParaCampo('5'), '0,05');
    assert.equal(valorParaCampo({ unidade: 'percentual', decimal: '25.5' }), '25,5');
  });
});

describe('valorDoCampo', () => {
  it('reais viram centavos inteiros em texto', () => {
    assert.deepEqual(valorDoCampo('brl_centavos', 'R$ 10.000,00'), { unidade: 'brl_centavos', centavos: '1000000', moeda: 'BRL' });
  });
  it('razão e percentual aceitam vírgula', () => {
    assert.deepEqual(valorDoCampo('razao', '3,5'), { unidade: 'razao', decimal: '3.5' });
    assert.deepEqual(valorDoCampo('percentual', '25'), { unidade: 'percentual', decimal: '25' });
  });
  it('recusa lixo', () => {
    assert.equal(valorDoCampo('brl_centavos', 'dez mil'), null);
    assert.equal(valorDoCampo('razao', '3,5,1'), null);
    assert.equal(decimalDoCampo('-1'), null);
  });
  it('o valor de tela vem do formatador do domínio', () => {
    const valor = valorDoCampo('brl_centavos', '1.234,56');
    assert.equal(valor && formatarValor(valor), 'R$ 1.234,56');
  });
});

describe('faixaLegivel', () => {
  it('formata mínimo e máximo na unidade', () => {
    assert.equal(faixaLegivel({ unidade: 'brl_centavos', faixaMin: '10000', faixaMax: '100000000' }, formatarValor), 'R$ 100,00 a R$ 1.000.000,00');
    assert.equal(faixaLegivel({ unidade: 'razao', faixaMin: '0.5', faixaMax: '20' }, formatarValor), '0,5x a 20x');
  });
});

describe('chaveDaRegra', () => {
  it('normaliza título em chave válida', () => {
    assert.equal(chaveDaRegra('etica_marca', 'Não citar concorrentes!'), 'etica_marca.nao_citar_concorrentes');
  });
  it('título que começa com número ganha prefixo', () => {
    assert.equal(chaveDaRegra('segmento', '18+ apenas'), 'segmento.r_18_apenas');
  });
  it('título sem letra nem número não gera chave', () => {
    assert.equal(chaveDaRegra('segmento', '!!!'), null);
  });
  it('respeita o padrão grupo.nome', () => {
    const chave = chaveDaRegra('governanca', 'a'.repeat(200));
    assert.match(chave ?? '', /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    assert.ok((chave ?? '').length <= 80);
  });
});

describe('agrupamento, filtros e papéis', () => {
  it('agrupa na ordem das categorias e omite as vazias', () => {
    const grupos = agruparPorCategoria([
      decisao({ categoria: 'etica_marca', natureza: 'regra' }),
      decisao({ categoria: 'investimento' }),
      decisao({ categoria: 'investimento' }),
    ]);
    assert.deepEqual(grupos.map((g) => [g.rotulo, g.decisoes.length]), [
      ['Limites de investimento', 2],
      ['Ética e marca', 1],
    ]);
  });
  it('lê filtros da querystring ignorando valor inválido', () => {
    assert.deepEqual(lerFiltrosDaLinha({ categoria: 'publico', origem: 'x', status: 'vigente', cursor: '40' }), {
      categoria: 'publico',
      origem: null,
      status: 'vigente',
      cursor: 40,
    });
    assert.equal(lerFiltrosDaLinha({ cursor: '-3' }).cursor, null);
    assert.equal(lerFiltrosDaLinha({ cursor: '0' }).cursor, null);
  });
  it('monta a busca da paginação preservando filtros', () => {
    assert.deepEqual(buscaDaLinha({ categoria: 'publico', origem: null, status: null }, 12), { categoria: 'publico', cursor: '12' });
  });
  it('limite é só de admin; regra e decisão, de operador', () => {
    assert.equal(podeRegistrarOuMexer('operator', 'limite'), false);
    assert.equal(podeRegistrarOuMexer('admin', 'limite'), true);
    assert.equal(podeRegistrarOuMexer('owner', 'limite'), true);
    assert.equal(podeRegistrarOuMexer('operator', 'regra'), true);
    assert.equal(podeRegistrarOuMexer('viewer', 'decisao'), false);
  });
  it('rotula escopo', () => {
    assert.equal(rotuloDoEscopo('cliente'), 'Cliente inteiro');
    assert.equal(rotuloDoEscopo('plataforma:meta'), 'Meta Ads');
  });
});

describe('estadoDoBlocoDeRegras', () => {
  const base = { essenciaisFaltando: [], vigentes: 3, propostasPendentes: 0, aRevisar: 0 };
  it('vazio sem nenhuma vigente', () => {
    assert.equal(estadoDoBlocoDeRegras({ ...base, vigentes: 0 }).tom, 'vazio');
  });
  it('lacuna essencial deixa parcial e aponta o próximo passo', () => {
    const estado = estadoDoBlocoDeRegras({ ...base, essenciaisFaltando: [{ chave: 'investimento.teto_mensal', nome: 'Teto mensal' }] });
    assert.deepEqual(estado, { tom: 'atencao', rotulo: 'Parcial', proximoPasso: 'Definir teto mensal' });
  });
  it('proposta pendente e revisão chamam atenção', () => {
    assert.equal(estadoDoBlocoDeRegras({ ...base, propostasPendentes: 2 }).proximoPasso, 'Decidir 2 propostas');
    assert.equal(estadoDoBlocoDeRegras({ ...base, aRevisar: 1 }).rotulo, 'Revisar');
  });
  it('completo quando nada falta', () => {
    assert.equal(estadoDoBlocoDeRegras(base).tom, 'ok');
  });
});

describe('retorno das ações de Regras', () => {
  const ID = '95ec64b4-c5b9-43ff-909d-d258d91e8b7c';
  it('volta para Atividade só com o valor fechado; qualquer outro valor volta para Regras', () => {
    assert.equal(retornoDaAcaoDeRegras(ID, 'atividade'), `/clientes/${ID}/atividade`);
    for (const outro of [undefined, '', 'https://evil.example', '/clientes/outro/atividade']) assert.equal(retornoDaAcaoDeRegras(ID, outro), `/clientes/${ID}/regras?secao=hoje`);
  });
});
