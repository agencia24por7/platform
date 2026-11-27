import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  apresentarChaveDoFornecedor,
  apresentarEstadoDaTarefa,
  apresentarLigada,
  apresentarSituacaoDaCredencial,
  dataCurtaDaCredencial,
  rotuloDaFerramenta,
} from './apresentacao.ts';

describe('apresentação da tela de IA', () => {
  it('traduz o id da ferramenta para um rótulo legível', () => {
    assert.equal(rotuloDaFerramenta('brain_consultar_catalogo'), 'Consultar o catálogo do Brain');
  });

  it('ferramenta sem rótulo cadastrado vira frase legível, nunca o id cru', () => {
    assert.equal(rotuloDaFerramenta('brain_listar_regras'), 'Brain listar regras');
    assert.equal(rotuloDaFerramenta('abc'), 'Abc');
    assert.equal(rotuloDaFerramenta('___'), '___');
  });

  it('vencida e revogada têm tom e ícone distintos entre si e da ativa', () => {
    const ativa = apresentarSituacaoDaCredencial('ativa');
    const vencida = apresentarSituacaoDaCredencial('vencida');
    const revogada = apresentarSituacaoDaCredencial('revogada');
    assert.deepEqual([ativa.rotulo, vencida.rotulo, revogada.rotulo], ['Ativa', 'Vencida', 'Revogada']);
    assert.equal(new Set([ativa.tom, vencida.tom, revogada.tom]).size, 3);
    assert.equal(new Set([ativa.icone, vencida.icone, revogada.icone]).size, 3);
  });

  it('todo estado de tarefa tem rótulo, ícone e, quando bloqueia, explicação do próximo passo', () => {
    assert.equal(apresentarEstadoDaTarefa('configurada').rotulo, 'Configurada');
    assert.equal(apresentarEstadoDaTarefa('sem_modelo').rotulo, 'Sem modelo');
    assert.equal(apresentarEstadoDaTarefa('modelo_indisponivel').rotulo, 'Modelo indisponível');
    assert.ok(apresentarEstadoDaTarefa('sem_modelo').explicacao);
    assert.ok(apresentarEstadoDaTarefa('modelo_indisponivel').explicacao);
  });

  it('ligada e desligada nunca dependem só da cor', () => {
    assert.deepEqual([apresentarLigada(true).rotulo, apresentarLigada(false).rotulo], ['Ligada', 'Desligada']);
    assert.notEqual(apresentarLigada(true).icone, apresentarLigada(false).icone);
  });

  it('chave guardada e ausente se distinguem por ícone e texto', () => {
    assert.notEqual(apresentarChaveDoFornecedor(true).icone, apresentarChaveDoFornecedor(false).icone);
    assert.equal(apresentarChaveDoFornecedor(false).rotulo, 'Sem chave');
  });

  it('data curta usa o fuso de São Paulo', () => {
    assert.equal(dataCurtaDaCredencial(new Date('2026-11-26T02:00:00Z')), '25/11/26');
  });
});
