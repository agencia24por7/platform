import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextoDeTeste, planoCompleto } from '../fixturesDeTeste.ts';
import { checarNaoFaremosPreservado } from './naoFaremosPreservado.ts';

describe('gate: nao_faremos_preservado', () => {
  it('sem base e sem exigência não há o que preservar', () => {
    assert.equal(checarNaoFaremosPreservado(contextoDeTeste()).resultado, 'aprovado');
  });

  it('versão de agente com base exigida e plano base ausente é nao_rodou (falha fechada)', () => {
    assert.equal(checarNaoFaremosPreservado(contextoDeTeste({ exigePlanoBase: true })).resultado, 'nao_rodou');
  });

  it('aprova quando todos continuam com o mesmo teste, e aceita item novo ou teste adicionado', () => {
    const base = planoCompleto();
    const atual = planoCompleto();
    atual.estrategia.nao_faremos.push({ id: 'nf_novo', texto: 'Não usaremos display.', teste: { tipo: 'canal_proibido', valor: 'display' } });
    atual.estrategia.nao_faremos.find((i) => i.id === 'nf_tom')!.teste = { tipo: 'formato_proibido', valor: 'imagem' };
    assert.equal(checarNaoFaremosPreservado(contextoDeTeste({ plano: atual, planosBase: [base], exigePlanoBase: true })).resultado, 'aprovado');
  });

  it('reprova item removido', () => {
    const atual = planoCompleto();
    atual.estrategia.nao_faremos = atual.estrategia.nao_faremos.filter((i) => i.id !== 'nf_tiktok');
    const r = checarNaoFaremosPreservado(contextoDeTeste({ plano: atual, planosBase: [planoCompleto()], exigePlanoBase: true }));
    assert.equal(r.resultado, 'reprovado');
    assert.deepEqual(r.onde, ['estrategia/nf_tiktok (removido em relação à versão base)']);
  });

  it('reprova teste estruturado removido ou trocado', () => {
    const semTeste = planoCompleto();
    delete semTeste.estrategia.nao_faremos.find((i) => i.id === 'nf_tiktok')!.teste;
    assert.equal(checarNaoFaremosPreservado(contextoDeTeste({ plano: semTeste, planosBase: [planoCompleto()], exigePlanoBase: true })).resultado, 'reprovado');
    const trocado = planoCompleto();
    trocado.estrategia.nao_faremos.find((i) => i.id === 'nf_tiktok')!.teste = { tipo: 'plataforma_proibida', valor: 'meta' };
    assert.equal(checarNaoFaremosPreservado(contextoDeTeste({ plano: trocado, planosBase: [planoCompleto()], exigePlanoBase: true })).resultado, 'reprovado');
  });

  it('a pessoa remove por edição manual: a base passa a ser a versão editada e a checagem aprova', () => {
    const editada = planoCompleto();
    editada.estrategia.nao_faremos = [];
    const atual = planoCompleto();
    atual.estrategia.nao_faremos = [];
    assert.equal(checarNaoFaremosPreservado(contextoDeTeste({ plano: atual, planosBase: [editada], exigePlanoBase: true })).resultado, 'aprovado');
  });

  it('item só de texto reescrito mantendo o id reprova; só espaços diferentes não', () => {
    const reescrito = planoCompleto();
    reescrito.estrategia.nao_faremos.find((i) => i.id === 'nf_tom')!.texto = 'Podemos usar humor com o produto.';
    const r = checarNaoFaremosPreservado(contextoDeTeste({ plano: reescrito, planosBase: [planoCompleto()], exigePlanoBase: true }));
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.includes('nf_tom') && r.onde[0]?.includes('texto reescrito'));
    const espacos = planoCompleto();
    espacos.estrategia.nao_faremos.find((i) => i.id === 'nf_tom')!.texto = '  Não   usaremos humor\ncom o produto. ';
    assert.equal(checarNaoFaremosPreservado(contextoDeTeste({ plano: espacos, planosBase: [planoCompleto()], exigePlanoBase: true })).resultado, 'aprovado');
  });

  it('item com teste estruturado pode mudar o texto desde que o teste seja igual', () => {
    const atual = planoCompleto();
    atual.estrategia.nao_faremos.find((i) => i.id === 'nf_tiktok')!.texto = 'Nada de TikTok neste plano.';
    assert.equal(checarNaoFaremosPreservado(contextoDeTeste({ plano: atual, planosBase: [planoCompleto()], exigePlanoBase: true })).resultado, 'aprovado');
  });

  it('com várias bases, perder o item de qualquer uma reprova', () => {
    const semItem = planoCompleto();
    semItem.estrategia.nao_faremos = semItem.estrategia.nao_faremos.filter((i) => i.id !== 'nf_tiktok');
    const atual = planoCompleto();
    atual.estrategia.nao_faremos = atual.estrategia.nao_faremos.filter((i) => i.id !== 'nf_tiktok');
    assert.equal(checarNaoFaremosPreservado(contextoDeTeste({ plano: atual, planosBase: [semItem, planoCompleto()], exigePlanoBase: true })).resultado, 'reprovado');
    assert.equal(checarNaoFaremosPreservado(contextoDeTeste({ plano: atual, planosBase: [semItem], exigePlanoBase: true })).resultado, 'aprovado');
  });
});
