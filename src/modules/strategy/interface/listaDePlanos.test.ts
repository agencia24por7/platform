import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CardDoPlano } from './cardsDePlano.ts';
import { cardsNaTela } from './cardsDePlano.ts';
import { visaoDaLista } from './listaDePlanos.ts';

const CLIENTE = '22222222-2222-4222-8222-222222222222';

const card = (planoId: string, minutos: number, sobrescrita: Partial<CardDoPlano> = {}): CardDoPlano => ({
  planoId,
  titulo: `Plano ${planoId}`,
  tipo: 'aquisicao',
  tipoRotulo: 'Aquisição',
  plataformas: [{ plataforma: 'meta', rotulo: 'Meta' }],
  foco: null,
  estado: 'vigente',
  rotulo: 'Autorizado',
  progresso: null,
  execucaoAtivaId: null,
  ultimaExecucaoFalhou: false,
  criadoEm: new Date('2026-11-01T00:00:00Z'),
  atualizadoEm: new Date(new Date('2026-11-25T12:00:00Z').getTime() + minutos * 60_000),
  ...sobrescrita,
});

describe('cards na tela', () => {
  it('ordena do mais recente para o mais antigo e aponta para a página do plano', () => {
    const cards = cardsNaTela([card('a', 0), card('b', 10), card('c', 5)], CLIENTE);
    assert.deepEqual(cards.map((c) => c.planoId), ['b', 'c', 'a']);
    assert.equal(cards[0]?.href, `/clientes/${CLIENTE}/estrategia/b`);
  });

  it('mostra status em português com ícone e classe, e progresso só de plano em geração', () => {
    const [gerando, falhou] = cardsNaTela([
      card('g', 2, { estado: 'gerando', rotulo: 'Em geração', progresso: { percentual: 35, etapa: 'Redigindo o plano' } }),
      card('f', 1, { estado: 'falhou', rotulo: 'Falhou' }),
    ], CLIENTE);
    assert.equal(gerando?.rotulo, 'Em geração');
    assert.equal(gerando?.progresso?.percentual, 35);
    assert.equal(falhou?.icone, 'erro');
    assert.equal(falhou?.classe, 'pill--danger');
    assert.equal(falhou?.progresso, null);
  });

  it('nenhum rótulo expõe Comitê ou Gates', () => {
    const cards = cardsNaTela([card('g', 0, { estado: 'gerando', rotulo: 'Em geração', progresso: { percentual: 65, etapa: 'Revisando o plano' } })], CLIENTE);
    assert.doesNotMatch(JSON.stringify(cards), /Comitê|Gate/);
  });
});

describe('visão da lista de planos', () => {
  it('operador pode criar e abre o formulário pelo parâmetro', () => {
    const visao = visaoDaLista({ cards: [], papel: 'operator', clienteId: CLIENTE, pediuFormulario: true });
    assert.equal(visao.novoPlano.habilitado, true);
    assert.equal(visao.novoPlano.href, `/clientes/${CLIENTE}/estrategia?novo=1`);
    assert.equal(visao.formularioAberto, true);
  });

  it('viewer não cria nem abre o formulário, mesmo pedindo', () => {
    const visao = visaoDaLista({ cards: [], papel: 'viewer', clienteId: CLIENTE, pediuFormulario: true });
    assert.equal(visao.novoPlano.habilitado, false);
    assert.equal(visao.formularioAberto, false);
    assert.match(visao.vazio.texto, /Quem opera ou administra/);
  });

  it('sinaliza atualização automática só quando há plano em geração', () => {
    assert.equal(visaoDaLista({ cards: [card('a', 0)], papel: 'admin', clienteId: CLIENTE, pediuFormulario: false }).emAndamento, false);
    const gerando = card('b', 0, { estado: 'gerando', progresso: { percentual: 10, etapa: 'Lendo o contexto do cliente' } });
    assert.equal(visaoDaLista({ cards: [gerando], papel: 'admin', clienteId: CLIENTE, pediuFormulario: false }).emAndamento, true);
  });
});
