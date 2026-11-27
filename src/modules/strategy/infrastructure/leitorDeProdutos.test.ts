import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { CarregadorDeContexto, ContextoParaCatalogo, ItemDoContexto } from '../../brain/domain/contexto.ts';
import { CLIENTE_ID, ORGANIZACAO_ID, OUTRO_CLIENTE_ID } from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { criarLeitorDoBrain, produtoDoItem } = await import('./leitorDoBrain.ts');
const { lerUrn } = await import('../../brain/domain/urn.ts');

const item = (id: string, dados: Record<string, unknown>, revisao: 'confirmado' | 'sugerido' = 'confirmado'): ItemDoContexto => ({
  id,
  secao: 'produtos',
  listKey: 'produtos',
  dados,
  versao: 1,
  atualizadoEm: new Date('2026-11-20T00:00:00Z'),
  epistemico: 'fato',
  fonte: 'pessoa',
  revisao,
  compartilhavel: true,
});

function leitorCom(itens: readonly ItemDoContexto[], visoes: string[] = []) {
  const carregador: CarregadorDeContexto = {
    disponivel: true,
    async carregar(_escopo, visao) {
      visoes.push(visao);
      return { listas: { produtos: itens } } as unknown as ContextoParaCatalogo;
    },
  };
  return criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { throw new Error('não usado'); } }, carregadorDeContexto: carregador });
}

describe('produtos do Contexto como foco do plano', () => {
  it('só itens confirmados, na visão da equipe, com URN estável do tipo contexto_produto da mesma organização e cliente', async () => {
    const visoes: string[] = [];
    const leitor = leitorCom([item('b1', { nome: 'Camiseta', preco: 4990 }), item('a1', { nome: 'Tênis', descricao: 'Corrida' }), item('c1', { nome: 'Rascunho' }, 'sugerido')], visoes);
    const lidos = await leitor.produtosDoContexto!(ORGANIZACAO_ID, CLIENTE_ID);
    assert.ok(lidos.ok);
    assert.deepEqual(visoes, ['equipe']);
    assert.deepEqual(lidos.value.map((p) => p.rotulo), ['Camiseta', 'Tênis']);
    for (const produto of lidos.value) {
      const partes = lerUrn(produto.urn);
      assert.equal(partes?.tipo, 'contexto_produto');
      assert.equal(partes?.organizationId, ORGANIZACAO_ID);
      assert.equal(partes?.clienteId, CLIENTE_ID);
      assert.match(produto.hash, /^[0-9a-f]{64}$/);
      assert.equal(produto.entrada.foco, true);
      assert.equal(produto.entrada.urn, produto.urn);
    }
    assert.match(lidos.value[0]!.entrada.resumo, /Preço: R\$ 49\.90/);
    assert.match(lidos.value[1]!.entrada.resumo, /Descrição: Corrida/);
  });

  it('a URN e o hash são estáveis e o hash muda quando o conteúdo muda', () => {
    const a = produtoDoItem(ORGANIZACAO_ID, CLIENTE_ID, item('a1', { nome: 'Tênis' }));
    const b = produtoDoItem(ORGANIZACAO_ID, CLIENTE_ID, item('a1', { nome: 'Tênis' }));
    const c = produtoDoItem(ORGANIZACAO_ID, CLIENTE_ID, item('a1', { nome: 'Tênis', descricao: 'novo' }));
    const outroCliente = produtoDoItem(ORGANIZACAO_ID, OUTRO_CLIENTE_ID, item('a1', { nome: 'Tênis' }));
    assert.deepEqual(a, b);
    assert.equal(a?.urn, c?.urn);
    assert.notEqual(a?.hash, c?.hash);
    assert.notEqual(a?.urn, outroCliente?.urn);
  });

  it('item sem nome, com nome que é dado pessoal ou com id impossível é descartado; texto livre passa por textoSeguro', () => {
    assert.equal(produtoDoItem(ORGANIZACAO_ID, CLIENTE_ID, item('x', {})), null);
    assert.equal(produtoDoItem(ORGANIZACAO_ID, CLIENTE_ID, item('x', { nome: 'maria@exemplo.com' })), null);
    assert.equal(produtoDoItem(ORGANIZACAO_ID, CLIENTE_ID, item('!!!', { nome: 'Tênis' })), null);
    const comContato = produtoDoItem(ORGANIZACAO_ID, CLIENTE_ID, item('y', { nome: 'Tênis', descricao: 'Fale com joao@exemplo.com' }));
    assert.ok(comContato);
    assert.ok(!comContato.entrada.resumo.includes('joao@'));
  });

  it('sem carregador, sem Contexto ou com erro: indisponível, nunca lista parcial', async () => {
    const semCarregador = criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { throw new Error('x'); } } });
    assert.ok(!(await semCarregador.produtosDoContexto!(ORGANIZACAO_ID, CLIENTE_ID)).ok);
    const nulo = criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { throw new Error('x'); } }, carregadorDeContexto: { disponivel: true, async carregar() { return null; } } });
    assert.ok(!(await nulo.produtosDoContexto!(ORGANIZACAO_ID, CLIENTE_ID)).ok);
    const quebrado = criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { throw new Error('x'); } }, carregadorDeContexto: { disponivel: true, async carregar() { throw new Error('x'); } } });
    assert.ok(!(await quebrado.produtosDoContexto!(ORGANIZACAO_ID, CLIENTE_ID)).ok);
  });
});
