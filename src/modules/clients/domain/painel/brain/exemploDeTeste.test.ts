import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { frescorPelaColeta } from './frescor.ts';
import { montarBrainDeExemplo, type EntradaDoExemplo } from './exemploDeTeste.ts';
import { ALTURA_DO_MAPA, LARGURA_DO_MAPA, MAX_NOS_POR_GRUPO, montarMapa } from './mapa.ts';

const agora = new Date('2026-11-20T12:00:00Z');
const base: EntradaDoExemplo = {
  clienteId: '95ec64b4-c5b9-43ff-909d-d258d91e8b7c',
  clienteNome: 'Café Orla',
  agora,
  contas: [],
  fontes: [],
  completudeGeral: 20,
  secoes: [
    { secao: 'empresa', letra: 'A', titulo: 'Empresa', percentual: 80 },
    { secao: 'publico', letra: 'C', titulo: 'Público e personas', percentual: 0 },
  ],
  arquivos: [],
};

describe('brain de exemplo', () => {
  it('é determinístico para a mesma entrada', () => {
    const a = montarBrainDeExemplo(base);
    const b = montarBrainDeExemplo(base);
    assert.equal(a.hash, b.hash);
    assert.deepEqual(a.pulso, b.pulso);
    assert.equal(a.origem, 'exemplo');
  });

  it('sem conexões usa contas de exemplo marcadas', () => {
    const brain = montarBrainDeExemplo(base);
    const conexoes = brain.entradas.filter((e) => e.tipo === 'conexao');
    assert.equal(conexoes.length, 2);
    assert.ok(conexoes.every((c) => c.tags.includes('exemplo')));
    assert.ok(brain.entradas.some((e) => e.urn.startsWith('urn:orla:tabela:fato_ads_diario')));
  });

  it('usa contas reais e marca coleta pausada como parada', () => {
    const brain = montarBrainDeExemplo({
      ...base,
      contas: [{ platform: 'google', nome: 'Café Google', externalId: '123-456-7890', ultimaColeta: new Date(agora.getTime() - 3_600_000), coletaLigada: false }],
    });
    const conexao = brain.entradas.find((e) => e.tipo === 'conexao');
    assert.equal(conexao?.titulo, 'Café Google');
    assert.equal(conexao?.frescor.status, 'parado');
    assert.ok(brain.acoes.some((a) => a.href.endsWith('/conexoes')));
  });

  it('séries de 90 dias, receita de acesso filtrada pelo cliente e lacunas', () => {
    const brain = montarBrainDeExemplo(base);
    const tabela = brain.entradas.find((e) => e.tipo === 'tabela_de_dados');
    assert.equal(tabela?.cobertura.ultimos90Dias?.length, 90);
    assert.match(tabela?.acesso.receita ?? '', /cliente_atual_id = '95ec64b4/);
    assert.ok(brain.lacunas.some((l) => l.rotulo === 'GA4'));
    assert.ok(brain.lacunas.some((l) => l.agrupamento === 'contexto' && l.href.includes('secao=publico')));
    assert.ok(brain.acoes[0]!.impacto >= brain.acoes[brain.acoes.length - 1]!.impacto);
  });

  it('o catalogo.md lista entradas e capacidades', () => {
    const brain = montarBrainDeExemplo(base);
    assert.match(brain.catalogoMd, /^# Catálogo do Brain · Café Orla/);
    assert.match(brain.catalogoMd, /## O que dá para responder/);
    assert.match(brain.catalogoMd, /urn:orla:contexto:empresa/);
    assert.match(brain.catalogoMd, new RegExp(`hash ${brain.hash}`));
  });

  it('o mapa põe os nós dentro do quadro e conta os ocultos', () => {
    const mapa = montarMapa(montarBrainDeExemplo(base));
    assert.equal(mapa.grupos.length, 4);
    for (const grupo of mapa.grupos) {
      assert.ok(grupo.nos.length <= MAX_NOS_POR_GRUPO);
      assert.equal(grupo.total - grupo.nos.length, grupo.ocultos);
      for (const no of [...grupo.nos, ...grupo.lacunas]) {
        assert.ok(no.x > 0 && no.x < LARGURA_DO_MAPA && no.y > 0 && no.y < ALTURA_DO_MAPA, `${no.x},${no.y}`);
      }
    }
  });

  it('frescor pela coleta', () => {
    const h = (n: number) => new Date(agora.getTime() - n * 3_600_000);
    assert.equal(frescorPelaColeta(h(10), agora), 'fresco');
    assert.equal(frescorPelaColeta(h(72), agora), 'atrasado');
    assert.equal(frescorPelaColeta(h(24 * 30), agora), 'parado');
    assert.equal(frescorPelaColeta(null, agora), 'desconhecido');
  });
});
