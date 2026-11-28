import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PASSOS_DO_NOVO_PLANO, SEM_CORRECOES, campoDeErroDaEntrada, corrigirCampo, errosAposCorrecoes, errosVigentes, indicadorDePassos, limitarPasso, navegacaoDoPasso, passosComErro, primeiroPassoComErro } from './passosDoNovoPlano.ts';

const CAMPOS_DO_SERVIDOR = ['tipoDePlano', 'plataformas', 'landingPageId', 'foco', 'objetivo', 'inicio', 'fim', 'ousadia', 'verba', 'retorno'];

describe('mapa de passos do novo plano', () => {
  it('são cinco passos na ordem pedida, o último é a revisão sem campos', () => {
    assert.deepEqual(PASSOS_DO_NOVO_PLANO.map((p) => p.chave), ['tipo', 'destino', 'horizonte', 'verba', 'revisao']);
    assert.deepEqual(PASSOS_DO_NOVO_PLANO[4]?.campos, []);
  });

  it('todo campo validado no servidor pertence a exatamente um passo', () => {
    for (const campo of CAMPOS_DO_SERVIDOR) {
      const passos = PASSOS_DO_NOVO_PLANO.filter((p) => p.campos.includes(campo));
      assert.equal(passos.length, 1, campo);
    }
    const total = PASSOS_DO_NOVO_PLANO.reduce((soma, p) => soma + p.campos.length, 0);
    assert.equal(total, CAMPOS_DO_SERVIDOR.length);
  });

  it('o primeiro passo com erro é o de menor índice, mesmo com erros em vários', () => {
    assert.equal(primeiroPassoComErro({ verba: 'x', objetivo: 'y' }), 2);
    assert.equal(primeiroPassoComErro({ retorno: 'x' }), 3);
    assert.equal(primeiroPassoComErro({ plataformas: 'x', verba: 'y' }), 0);
    assert.equal(primeiroPassoComErro({ foco: 'x' }), 1);
    assert.equal(primeiroPassoComErro({ inicio: 'x' }), 2);
    assert.equal(primeiroPassoComErro({ fim: 'x' }), 2);
  });

  it('sem erro ou com campo desconhecido não há passo a abrir', () => {
    assert.equal(primeiroPassoComErro(undefined), null);
    assert.equal(primeiroPassoComErro({}), null);
    assert.equal(primeiroPassoComErro({ qualquer: 'x' }), null);
    assert.deepEqual([...passosComErro({ verba: 'x', objetivo: 'y' })].sort(), [2, 3]);
  });
});

describe('navegação e indicador', () => {
  it('limita o passo ao intervalo válido', () => {
    assert.equal(limitarPasso(-3), 0);
    assert.equal(limitarPasso(99), 4);
    assert.equal(limitarPasso(Number.NaN), 0);
    assert.equal(limitarPasso(2), 2);
  });

  it('no primeiro passo não há Voltar; no último não há Continuar', () => {
    assert.deepEqual(navegacaoDoPasso(0), { indice: 0, anterior: null, proximo: 1, ultimo: false, progresso: 'Passo 1 de 5' });
    assert.deepEqual(navegacaoDoPasso(2), { indice: 2, anterior: 1, proximo: 3, ultimo: false, progresso: 'Passo 3 de 5' });
    assert.deepEqual(navegacaoDoPasso(4), { indice: 4, anterior: 3, proximo: null, ultimo: true, progresso: 'Passo 5 de 5' });
    assert.equal(navegacaoDoPasso(40).indice, 4);
  });

  it('marca concluídos, atual e pendentes, sempre com texto', () => {
    const itens = indicadorDePassos(2);
    assert.deepEqual(itens.map((i) => i.estado), ['concluido', 'concluido', 'atual', 'pendente', 'pendente']);
    assert.deepEqual(itens.map((i) => i.numero), [1, 2, 3, 4, 5]);
    assert.deepEqual(itens.map((i) => i.textoDoEstado), ['concluído', 'concluído', 'passo atual', 'a fazer', 'a fazer']);
    assert.ok(itens.every((i) => !i.comErro));
  });

  it('passo com erro de campo fica sinalizado com texto próprio', () => {
    const itens = indicadorDePassos(4, { verba: 'x' });
    const verba = itens.find((i) => i.chave === 'verba');
    assert.equal(verba?.comErro, true);
    assert.equal(verba?.textoDoEstado, 'com erro');
    assert.equal(itens.filter((i) => i.comErro).length, 1);
  });

  it('erro de campo já corrigido deixa de valer e o passo sai do estado de erro', () => {
    const erros = { landingPageId: 'Escolha a landing page.', objetivo: 'Descreva o objetivo.' };
    const vigentes = errosVigentes(erros, new Set(['landingPageId']));
    assert.deepEqual(vigentes, { objetivo: 'Descreva o objetivo.' });
    assert.deepEqual([...passosComErro(vigentes)], [...passosComErro({ objetivo: 'x' })]);
    assert.deepEqual(errosVigentes(undefined, new Set()), {});
    assert.deepEqual(errosVigentes(erros, new Set()), erros);
  });

  it('corrigir um campo esconde só o erro dele, e erros novos do servidor zeram as correções', () => {
    const erros = { foco: 'Escolha o foco.', landingPageId: 'Escolha a landing page.' };
    const semErro = corrigirCampo(SEM_CORRECOES, erros, 'objetivo');
    assert.equal(semErro, SEM_CORRECOES);
    const umaCorrecao = corrigirCampo(SEM_CORRECOES, erros, 'landingPageId');
    assert.deepEqual(errosAposCorrecoes(erros, umaCorrecao), { foco: 'Escolha o foco.' });
    const duasCorrecoes = corrigirCampo(umaCorrecao, erros, 'produtos');
    assert.deepEqual(errosAposCorrecoes(erros, duasCorrecoes), {});
    const novosErros = { landingPageId: 'Escolha a landing page.' };
    assert.deepEqual(errosAposCorrecoes(novosErros, duasCorrecoes), novosErros);
    assert.deepEqual(errosAposCorrecoes(undefined, duasCorrecoes), {});
  });

  it('entrada do foco e do modo da verba apontam para o campo de erro certo', () => {
    assert.equal(campoDeErroDaEntrada('focoMarca'), 'foco');
    assert.equal(campoDeErroDaEntrada('produtos'), 'foco');
    assert.equal(campoDeErroDaEntrada('modoDaVerba'), 'verba');
    assert.equal(campoDeErroDaEntrada('landingPageId'), 'landingPageId');
  });
});
