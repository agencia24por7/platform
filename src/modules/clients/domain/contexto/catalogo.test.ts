import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CATALOGO,
  SECOES,
  campoLista,
  campoSimples,
  catalogoParaCliente,
  localizarCampo,
  type CampoLista,
} from './catalogo.ts';

const SNAKE = /^[a-z][a-z0-9_]*$/;

describe('catálogo do contexto do cliente', () => {
  it('tem as onze seções de A a K, na ordem', () => {
    assert.deepEqual(
      CATALOGO.map((s) => s.key),
      [...SECOES],
    );
    assert.equal(CATALOGO.map((s) => s.letra).join(''), 'ABCDEFGHIJK');
  });

  it('toda chave é snake_case e única no catálogo inteiro', () => {
    const chaves = CATALOGO.flatMap((s) => s.campos.map((c) => c.key));
    assert.equal(new Set(chaves).size, chaves.length);
    for (const chave of chaves) assert.match(chave, SNAKE);
  });

  it('cada seção tem ao menos um campo essencial e notas internas que o cliente não vê', () => {
    for (const secao of CATALOGO) {
      assert.ok(secao.campos.some((c) => c.nivel === 'essencial'), secao.key);
      const notas = secao.campos.find((c) => c.key === `notas_internas_${secao.key}`);
      assert.ok(notas, secao.key);
      assert.equal(notas.visivelAoCliente, false);
      assert.equal(notas.contaNaCompletude, false);
    }
  });

  it('listas têm itens com chaves únicas, título existente e arquivo de brain único', () => {
    const listas = CATALOGO.flatMap((s) => s.campos.filter((c): c is CampoLista => c.tipo === 'lista'));
    const arquivos = listas.map((l) => l.arquivoBrain);
    assert.equal(new Set(arquivos).size, arquivos.length);
    for (const lista of listas) {
      const chaves = lista.item.map((c) => c.key);
      assert.equal(new Set(chaves).size, chaves.length, lista.key);
      assert.ok(chaves.includes(lista.campoTitulo), lista.key);
      assert.ok(lista.minimo >= 1 && lista.maximo >= lista.minimo, lista.key);
      for (const chave of chaves) assert.match(chave, SNAKE);
    }
  });

  it('inclui as listas pedidas no briefing', () => {
    for (const chave of [
      'redes_sociais',
      'produtos',
      'personas',
      'concorrentes',
      'marcas_admiradas',
      'historico_campanhas',
      'depoimentos',
    ]) {
      assert.ok(campoLista(chave), chave);
    }
    const redes = campoLista('redes_sociais')!.campo;
    assert.deepEqual(
      redes.item.map((c) => c.key),
      ['rede', 'perfil', 'link', 'seguidores', 'frequencia_posts', 'quem_cuida', 'formatos', 'status'],
    );
  });

  it('persona e depoimento avisam sobre dado pessoal', () => {
    assert.ok(campoLista('personas')!.campo.avisoDeDadoPessoal);
    assert.ok(campoLista('depoimentos')!.campo.avisoDeDadoPessoal);
  });

  it('localiza campos simples e listas pelo nome', () => {
    assert.equal(localizarCampo('site')?.secao.key, 'empresa');
    assert.equal(campoSimples('produtos'), null);
    assert.equal(campoLista('site'), null);
    assert.equal(localizarCampo('nao_existe'), null);
  });

  it('a versão do cliente só traz as seções pedidas e esconde o que é interno', () => {
    const visivel = catalogoParaCliente(['marca', 'empresa']);
    assert.deepEqual(
      visivel.map((s) => s.key),
      ['empresa', 'marca'],
    );
    assert.ok(visivel.every((s) => s.campos.every((c) => c.visivelAoCliente)));
  });
});
