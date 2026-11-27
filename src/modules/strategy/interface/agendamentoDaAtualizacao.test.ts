import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { execucaoSemAvanco, proximoIntervalo } from './agendamentoDaAtualizacao.ts';

describe('agendamento da atualização automática', () => {
  it('espaça 5 s, 10 s e 30 s e para depois de 10 minutos', () => {
    assert.equal(proximoIntervalo(0), 5_000);
    assert.equal(proximoIntervalo(59_999), 5_000);
    assert.equal(proximoIntervalo(60_000), 10_000);
    assert.equal(proximoIntervalo(179_999), 10_000);
    assert.equal(proximoIntervalo(180_000), 30_000);
    assert.equal(proximoIntervalo(599_999), 30_000);
    assert.equal(proximoIntervalo(600_000), null);
    assert.equal(proximoIntervalo(3_600_000), null);
  });

  it('valor inválido volta ao primeiro intervalo em vez de travar', () => {
    assert.equal(proximoIntervalo(-1), 5_000);
    assert.equal(proximoIntervalo(Number.NaN), 5_000);
  });

  it('só execução pendente ou rodando pode estar presa', () => {
    const agora = new Date('2026-11-25T14:00:00.000Z');
    const antiga = new Date('2026-11-25T13:00:00.000Z');
    assert.equal(execucaoSemAvanco({ status: 'concluida', atualizadaEm: antiga, leaseAte: null }, agora), false);
    assert.equal(execucaoSemAvanco({ status: 'pendente', atualizadaEm: antiga, leaseAte: null }, agora), true);
    assert.equal(execucaoSemAvanco({ status: 'pendente', atualizadaEm: agora, leaseAte: null }, agora), false);
    assert.equal(execucaoSemAvanco({ status: 'rodando', atualizadaEm: agora, leaseAte: new Date(agora.getTime() + 60_000) }, agora), false);
    assert.equal(execucaoSemAvanco({ status: 'rodando', atualizadaEm: agora, leaseAte: new Date(agora.getTime() - 180_000) }, agora), true);
  });
});
