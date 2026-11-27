import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextoDeTeste, hashDeTeste, urnDeTeste } from '../fixturesDeTeste.ts';
import type { FocoDoPlano } from '../plano.ts';
import { checarAlinhamentoAoFoco, checarVerbaPorProduto } from './focoDoPlano.ts';

const BRL = (centavos: string) => ({ centavos, moeda: 'BRL' as const });
const urnDoProduto = (id: string) => urnDeTeste('contexto_produto', id);
const A = urnDoProduto('tenis');
const B = urnDoProduto('camiseta');
const FORA = urnDoProduto('outro');
const doisProdutos: FocoDoPlano = {
  tipo: 'produtos',
  produtos: [
    { urn: A, rotulo: 'Tênis', hash: hashDeTeste(10) },
    { urn: B, rotulo: 'Camiseta', hash: hashDeTeste(11) },
  ],
};
const umProduto: FocoDoPlano = { tipo: 'produtos', produtos: [{ urn: A, rotulo: 'Tênis', hash: hashDeTeste(10) }] };

function contexto(foco: FocoDoPlano | undefined, porProduto?: { produto: string; valor: string; justificativa?: string }[]) {
  const c = contextoDeTeste();
  if (foco !== undefined) c.plano.intencao.foco = foco;
  if (porProduto !== undefined) {
    c.plano.orcamento.por_produto = porProduto.map((item) => ({
      produto: item.produto,
      valor: BRL(item.valor),
      ...(item.justificativa === undefined ? {} : { justificativa: item.justificativa }),
      evidencias: [],
    }));
  }
  return c;
}

describe('gate: foco_verba_por_produto', () => {
  it('plano sem foco (legado) aprova', () => {
    assert.equal(checarVerbaPorProduto(contexto(undefined)).resultado, 'aprovado');
  });

  it('aprova a divisão que soma o total e só usa produtos do foco', () => {
    const r = checarVerbaPorProduto(contexto(doisProdutos, [{ produto: A, valor: '600000' }, { produto: B, valor: '400000' }]));
    assert.equal(r.resultado, 'aprovado');
  });

  it('reprova soma diferente do total', () => {
    const r = checarVerbaPorProduto(contexto(doisProdutos, [{ produto: A, valor: '600000' }, { produto: B, valor: '300000' }]));
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes('soma por produto')));
  });

  it('reprova produto fora do foco', () => {
    const r = checarVerbaPorProduto(contexto(doisProdutos, [{ produto: A, valor: '500000' }, { produto: FORA, valor: '500000' }]));
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes('fora do foco')));
  });

  it('reprova produto do foco sem verba e divisão ausente com mais de um produto', () => {
    const faltando = checarVerbaPorProduto(contexto(doisProdutos, [{ produto: A, valor: '1000000' }]));
    assert.equal(faltando.resultado, 'reprovado');
    assert.ok(faltando.onde.some((o) => o.includes('produto sem verba: Camiseta')));
    const ausente = checarVerbaPorProduto(contexto(doisProdutos));
    assert.equal(ausente.resultado, 'reprovado');
  });

  it('reprova produto repetido', () => {
    const r = checarVerbaPorProduto(contexto(doisProdutos, [{ produto: A, valor: '500000' }, { produto: A, valor: '500000' }]));
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes('repetido')));
  });

  it('valor zero só com justificativa', () => {
    const sem = checarVerbaPorProduto(contexto(doisProdutos, [{ produto: A, valor: '1000000' }, { produto: B, valor: '0' }]));
    assert.equal(sem.resultado, 'reprovado');
    assert.ok(sem.onde.some((o) => o.includes('valor zero sem justificativa')));
    const com = checarVerbaPorProduto(contexto(doisProdutos, [{ produto: A, valor: '1000000' }, { produto: B, valor: '0', justificativa: 'Sem estoque no período.' }]));
    assert.equal(com.resultado, 'aprovado');
  });

  it('com um produto, por_produto ausente ou um item com o total', () => {
    assert.equal(checarVerbaPorProduto(contexto(umProduto)).resultado, 'aprovado');
    assert.equal(checarVerbaPorProduto(contexto(umProduto, [{ produto: A, valor: '1000000' }])).resultado, 'aprovado');
    assert.equal(checarVerbaPorProduto(contexto(umProduto, [{ produto: A, valor: '900000' }])).resultado, 'reprovado');
  });

  it('foco marca não divide a verba por produto', () => {
    assert.equal(checarVerbaPorProduto(contexto({ tipo: 'marca' })).resultado, 'aprovado');
    assert.equal(checarVerbaPorProduto(contexto({ tipo: 'marca' }, [{ produto: A, valor: '1000000' }])).resultado, 'reprovado');
  });
});

describe('gate: foco_alinhamento', () => {
  it('plano sem foco aprova', () => {
    assert.equal(checarAlinhamentoAoFoco(contexto(undefined)).resultado, 'aprovado');
  });

  it('com mais de um produto, toda campanha cita um produto do foco', () => {
    const c = contexto(doisProdutos);
    const sem = checarAlinhamentoAoFoco(c);
    assert.equal(sem.resultado, 'reprovado');
    assert.ok(sem.onde.some((o) => o.includes('sem produto do foco')));
    for (const campanha of c.plano.campanhas.campanhas) campanha.produto = B;
    assert.equal(checarAlinhamentoAoFoco(c).resultado, 'aprovado');
  });

  it('reprova campanha com produto fora do foco', () => {
    const c = contexto(doisProdutos);
    c.plano.campanhas.campanhas[0]!.produto = FORA;
    const r = checarAlinhamentoAoFoco(c);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes('produto fora do foco')));
  });

  it('com um produto, o produto da campanha é opcional mas, se vier, é do foco', () => {
    const c = contexto(umProduto);
    assert.equal(checarAlinhamentoAoFoco(c).resultado, 'aprovado');
    c.plano.campanhas.campanhas[0]!.produto = B;
    assert.equal(checarAlinhamentoAoFoco(c).resultado, 'reprovado');
  });

  it('foco marca não aceita campanha com produto', () => {
    const c = contexto({ tipo: 'marca' });
    assert.equal(checarAlinhamentoAoFoco(c).resultado, 'aprovado');
    c.plano.campanhas.campanhas[0]!.produto = A;
    assert.equal(checarAlinhamentoAoFoco(c).resultado, 'reprovado');
  });
});
