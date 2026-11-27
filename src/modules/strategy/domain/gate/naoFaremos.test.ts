import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import { checarNaoFaremos } from './naoFaremos.ts';

describe('gate: nao_faremos', () => {
  it('aprova e lista item só texto para avaliar por modelo', () => {
    const r = checarNaoFaremos(contextoDeTeste());
    assert.equal(r.resultado, 'aprovado');
    assert.deepEqual(r.onde, ['estrategia/nf_tom (avaliar por modelo)']);
  });

  it('reprova plataforma proibida usada por campanha e por canal', () => {
    const contexto = contextoDeTeste();
    contexto.plano.campanhas.campanhas[1]!.plataforma = 'tiktok';
    contexto.plano.canais_e_plataformas.canais[1]!.plataforma = 'tiktok';
    const r = checarNaoFaremos(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.includes('campanhas/cp_social viola estrategia/nf_tiktok'));
    assert.ok(r.onde.includes('canais_e_plataformas/cn_social viola estrategia/nf_tiktok'));
  });

  it('avalia canal, formato e público proibidos', () => {
    const contexto = contextoDeTeste();
    contexto.plano.estrategia.nao_faremos = [
      { id: 'nf_canal', texto: 'x', teste: { tipo: 'canal_proibido', valor: 'social' } },
      { id: 'nf_formato', texto: 'x', teste: { tipo: 'formato_proibido', valor: 'carrossel' } },
      { id: 'nf_publico', texto: 'x', teste: { tipo: 'publico_proibido', valor: 'seg_empresas' } },
    ];
    const r = checarNaoFaremos(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.includes('campanhas/cp_social viola estrategia/nf_canal'));
    assert.ok(r.onde.includes('campanhas/cp_social viola estrategia/nf_formato'));
    assert.ok(r.onde.includes('campanhas/cp_social viola estrategia/nf_publico'));
    assert.equal(r.onde.some((o) => o.startsWith('campanhas/cp_busca')), false);
  });

  it('sem nenhum "não faremos" aprova', () => {
    const contexto = contextoDeTeste();
    contexto.plano.estrategia.nao_faremos = [];
    assert.equal(checarNaoFaremos(contexto).resultado, 'aprovado');
  });
});
