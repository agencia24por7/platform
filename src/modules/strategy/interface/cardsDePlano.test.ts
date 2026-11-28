import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Execucao, PlanoDoCliente, VersaoResumo } from '../application/portas.ts';
import { cardDoPlano, cardsNaTela, tituloDoPlano, TAMANHO_MAXIMO_DO_TITULO } from './cardsDePlano.ts';

const AGORA = new Date('2026-11-25T12:00:00Z');

const execucao = (sobrescrita: Partial<Execucao>): Execucao => ({
  id: 'run-1',
  planoId: 'p1',
  organizationId: 'o',
  clientId: 'c',
  tipo: 'criar',
  pedido: {},
  versaoBaseId: null,
  status: 'pendente',
  etapa: 'ler_brain',
  rodada: 0,
  tentativas: 0,
  falhas: 0,
  erroCodigo: null,
  agentRunId: 'a',
  solicitadoPor: null,
  solicitadoTipo: 'usuario',
  leaseAte: null,
  criadaEm: AGORA,
  atualizadaEm: AGORA,
  ...sobrescrita,
});

const versao = (status: VersaoResumo['status']): VersaoResumo => ({
  id: 'v1',
  planoId: 'p1',
  organizationId: 'o',
  clientId: 'c',
  status,
  schemaVersion: 1,
  supersedesId: null,
  autorTipo: 'agente',
  autorUsuarioId: null,
  agentId: null,
  agentRunId: null,
  redigidaEm: null,
  criadaEm: AGORA,
});

const estado = (sobrescrita: Partial<PlanoDoCliente> = {}): PlanoDoCliente => ({
  plano: { id: 'p1', organizationId: 'o', clientId: 'c', tipo: 'aquisicao', plataformas: ['meta'], whatsapp: '+5511912345678', landingPageId: 'l', foco: null, criadoEm: AGORA },
  maisRecente: null,
  vigente: null,
  aberta: null,
  objetivo: 'Gerar leads',
  ultimaExecucao: null,
  atualizadoEm: AGORA,
  ...sobrescrita,
});

describe('card do plano', () => {
  it('execução ativa vira "gerando" com progresso pela etapa', () => {
    const card = cardDoPlano(estado({ ultimaExecucao: execucao({ status: 'rodando', etapa: 'comite' }) }));
    assert.equal(card.estado, 'gerando');
    assert.equal(card.rotulo, 'Em geração');
    assert.equal(card.progresso?.percentual, 65);
    assert.equal(card.execucaoAtivaId, 'run-1');
    assert.deepEqual(card.plataformas, [{ plataforma: 'meta', rotulo: 'Meta' }]);
    assert.equal(card.tipoRotulo, 'Aquisição');
  });

  it('plano com versão mostra o status da versão e some o progresso', () => {
    const card = cardDoPlano(estado({ aberta: versao('rascunho'), maisRecente: versao('rascunho'), ultimaExecucao: execucao({ status: 'concluida', etapa: 'fim' }) }));
    assert.equal(card.estado, 'rascunho');
    assert.equal(card.progresso, null);
    assert.equal(cardDoPlano(estado({ vigente: versao('vigente') })).estado, 'vigente');
  });

  it('falha sem versão aparece como falhou; com versão, guarda o aviso', () => {
    assert.equal(cardDoPlano(estado({ ultimaExecucao: execucao({ status: 'falhou', erroCodigo: 'ia_falha' }) })).estado, 'falhou');
    const comVersao = cardDoPlano(estado({ vigente: versao('vigente'), ultimaExecucao: execucao({ status: 'falhou', erroCodigo: 'ia_falha' }) }));
    assert.equal(comVersao.estado, 'vigente');
    assert.equal(comVersao.ultimaExecucaoFalhou, true);
    assert.equal(cardDoPlano(estado()).estado, 'sem_versao');
  });

  it('plano antigo sem plataformas não quebra o card', () => {
    const base = estado();
    const card = cardDoPlano({ ...base, plano: { ...base.plano, plataformas: null, whatsapp: null, landingPageId: null } });
    assert.deepEqual(card.plataformas, []);
  });

  it('título: objetivo compactado e cortado; sem objetivo usa o tipo', () => {
    assert.equal(tituloDoPlano('  Gerar\n leads  ', 'marca'), 'Gerar leads');
    assert.equal(tituloDoPlano('a'.repeat(300), 'marca').length, TAMANHO_MAXIMO_DO_TITULO);
    assert.equal(tituloDoPlano(null, 'retencao'), 'Plano de Retenção');
  });
});

describe('foco e apagar no card', () => {
  const urn = (n: number) => `orla:o:c:contexto_produto:p${n}`;
  const hash = 'a'.repeat(64);

  it('card mostra o foco: marca, ou os rótulos com resumo acima de três', () => {
    const base = estado();
    assert.equal(cardDoPlano(base).foco, null);
    assert.equal(cardDoPlano({ ...base, plano: { ...base.plano, foco: { tipo: 'marca' } } }).foco, 'Campanha de marca');
    const produtos = [1, 2, 3, 4, 5].map((n) => ({ urn: urn(n), rotulo: `P${n}`, hash }));
    assert.equal(cardDoPlano({ ...base, plano: { ...base.plano, foco: { tipo: 'produtos', produtos: produtos.slice(0, 2) } } }).foco, 'P1, P2');
    assert.equal(cardDoPlano({ ...base, plano: { ...base.plano, foco: { tipo: 'produtos', produtos } } }).foco, 'P1, P2, P3 e mais 2');
  });

  it('só owner e admin veem Apagar; com execução ativa fica desabilitado com o motivo', () => {
    const livre = cardDoPlano(estado());
    const ativa = cardDoPlano(estado({ ultimaExecucao: execucao({ status: 'rodando' }) }));
    for (const papel of ['owner', 'admin'] as const) {
      assert.deepEqual(cardsNaTela([livre], 'c', papel)[0]?.apagar, { habilitado: true, motivo: null });
      assert.deepEqual(cardsNaTela([ativa], 'c', papel)[0]?.apagar, { habilitado: false, motivo: 'Cancele a execução antes de apagar o plano.' });
    }
    for (const papel of ['operator', 'viewer'] as const) assert.equal(cardsNaTela([livre], 'c', papel)[0]?.apagar, null);
    assert.equal(cardsNaTela([livre], 'c')[0]?.apagar, null);
  });
});
