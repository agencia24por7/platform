import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clientesVisiveis, hrefDaLista, lerFiltroDaLista, visaoDaListaDeClientes, type ClienteDaLista } from './listaDeClientes.ts';

const cliente = (id: string, status: ClienteDaLista['status'], extra: Partial<ClienteDaLista> = {}): ClienteDaLista => ({
  id,
  name: `Cliente ${id}`,
  segment: null,
  businessModel: 'leads',
  accountCount: 0,
  status,
  parentClientId: null,
  ...extra,
});

const TODOS = [cliente('a', 'active'), cliente('b', 'paused'), cliente('c', 'archived'), cliente('d', 'archived')];

describe('lista de clientes', () => {
  it('lê só filtros conhecidos e nunca aceita arquivado como situação', () => {
    assert.deepEqual(lerFiltroDaLista({ situacao: 'archived', busca: '  ab ', lista: 'x' }), { situacao: null, busca: 'ab', arquivados: false });
    assert.deepEqual(lerFiltroDaLista({ situacao: ['paused'], lista: 'arquivados' }), { situacao: 'paused', busca: '', arquivados: true });
    assert.equal(lerFiltroDaLista({ busca: 'x'.repeat(500) }).busca.length, 120);
  });

  it('a lista principal esconde os arquivados e a lista à parte só mostra eles', () => {
    assert.deepEqual(clientesVisiveis(TODOS, lerFiltroDaLista({})).map((c) => c.id), ['a', 'b']);
    assert.deepEqual(clientesVisiveis(TODOS, lerFiltroDaLista({ lista: 'arquivados' })).map((c) => c.id), ['c', 'd']);
  });

  it('o atalho de arquivados alterna entre as duas listas e conta só os arquivados', () => {
    const principal = visaoDaListaDeClientes(TODOS, lerFiltroDaLista({}), new Map(), 'cliente');
    assert.deepEqual(principal.arquivados, { total: 2, href: '/clientes?lista=arquivados', ativo: false, rotulo: 'Ver clientes arquivados (2)' });
    assert.equal(principal.chips.find((c) => c.chave === 'todas')?.total, 2);
    const arquivados = visaoDaListaDeClientes(TODOS, lerFiltroDaLista({ lista: 'arquivados' }), new Map(), 'cliente');
    assert.deepEqual(arquivados.arquivados, { total: 2, href: '/clientes', ativo: true, rotulo: 'Voltar aos clientes em operação' });
    assert.equal(visaoDaListaDeClientes(TODOS, lerFiltroDaLista({}), new Map(), 'negócio', 'Negócios').arquivados.rotulo, 'Ver negócios arquivados (2)');
    assert.ok(arquivados.chips.every((c) => !c.ativo));
  });

  it('linha traz rótulo e tom, sem decidir estilo', () => {
    const visao = visaoDaListaDeClientes([cliente('a', 'active', { businessModel: 'ecommerce' })], lerFiltroDaLista({}), new Map([['a', 'parcial' as const]]), 'cliente');
    assert.deepEqual(visao.linhas[0]?.situacao, { rotulo: 'Ativo', tom: 'ok' });
    assert.deepEqual(visao.linhas[0]?.prontidao, { rotulo: 'Parcial', icone: 'parcial', tom: 'atencao' });
    assert.equal(visao.linhas[0]?.modelo, 'E-commerce');
    assert.equal(visaoDaListaDeClientes([cliente('b', 'active')], lerFiltroDaLista({}), new Map(), 'cliente').linhas[0]?.modelo, 'Geração de leads');
  });

  it('estado vazio distingue sem cadastro, sem resultado e sem arquivados', () => {
    assert.equal(visaoDaListaDeClientes([], lerFiltroDaLista({}), new Map(), 'cliente').vazio, 'Nenhum cadastro ainda. Comece criando o primeiro cliente.');
    assert.equal(visaoDaListaDeClientes([cliente('a', 'active')], lerFiltroDaLista({ busca: 'zzz' }), new Map(), 'cliente').vazio, 'Nenhum cliente encontrado com esse filtro.');
    assert.equal(visaoDaListaDeClientes([cliente('a', 'active')], lerFiltroDaLista({ lista: 'arquivados' }), new Map(), 'cliente').vazio, 'Nenhum cliente arquivado.');
  });

  it('href preserva a busca e codifica', () => {
    assert.equal(hrefDaLista({ situacao: 'active', busca: 'a&b', arquivados: false }), '/clientes?situacao=active&busca=a%26b');
  });
});
