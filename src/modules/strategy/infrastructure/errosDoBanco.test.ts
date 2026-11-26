import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';

const { traduzirErroDoBanco } = await import('./errosDoBanco.ts');

const erro = (code: string, message = '', constraint_name?: string) => ({ code, message, constraint_name });

describe('traduzirErroDoBanco', () => {
  it('42501 vira sem_permissao', () => {
    assert.equal(traduzirErroDoBanco(erro('42501'))?.codigo, 'sem_permissao');
  });

  it('42501 de escrita de agente sem execução ativa vira execucao_perdida', () => {
    const traduzido = traduzirErroDoBanco(erro('42501', 'escrita de agente exige execução ativa deste plano (rodando e com lease vigente) com o mesmo agent_run_id'));
    assert.equal(traduzido?.codigo, 'execucao_perdida');
  });

  it('23505 do gatilho de teto (persona repetida, segundo ajuste) vira ja_feito pelo nome da restrição na mensagem', () => {
    assert.equal(traduzirErroDoBanco(erro('23505', 'esta persona já opinou nesta versão (strategy_plan_events_parecer_persona)'))?.codigo, 'ja_feito');
    assert.equal(traduzirErroDoBanco(erro('23505', 'a versão já tem ajuste (strategy_plan_events_um_ajuste)'))?.codigo, 'ja_feito');
  });

  it('ORT01 e ORT02 viram teto_do_agente com o teto', () => {
    assert.deepEqual(
      [traduzirErroDoBanco(erro('ORT01'))?.teto, traduzirErroDoBanco(erro('ORT02'))?.teto],
      ['execucao', 'dia'],
    );
    assert.equal(traduzirErroDoBanco(erro('ORT01'))?.codigo, 'teto_do_agente');
  });

  it('23514 da trava de aplicar vira falta_para_aplicar e guarda o que falta', () => {
    const traduzido = traduzirErroDoBanco(erro('23514', 'versão não pode ser proposta: falta gate'));
    assert.equal(traduzido?.codigo, 'falta_para_aplicar');
    assert.match(traduzido?.mensagem ?? '', /falta gate/);
  });

  it('23514 de transição inválida e de estado final viram transicao_invalida', () => {
    assert.equal(traduzirErroDoBanco(erro('23514', 'transição inválida: cancelado não pode ser proposta'))?.codigo, 'transicao_invalida');
    assert.equal(traduzirErroDoBanco(erro('23514', 'execução em estado final (concluida) não muda'))?.codigo, 'transicao_invalida');
  });

  it('23514 de versão vigente vira conflito', () => {
    assert.equal(traduzirErroDoBanco(erro('23514', 'o plano já tem versão vigente: a nova versão precisa superá-la'))?.codigo, 'conflito');
  });

  it('23514 genérico vira invalido sem vazar o texto do banco', () => {
    const traduzido = traduzirErroDoBanco(erro('23514', 'new row violates check constraint "x" Failing row contains (segredo)'));
    assert.equal(traduzido?.codigo, 'invalido');
    assert.ok(!(traduzido?.mensagem ?? '').includes('segredo'));
  });

  it('23505 de idempotência vira ja_feito', () => {
    assert.equal(traduzirErroDoBanco(erro('23505', '', 'strategy_plan_versions_idempotencia'))?.codigo, 'ja_feito');
    assert.equal(traduzirErroDoBanco(erro('23505', 'chave de idempotência já usada neste plano (strategy_plan_versions_idempotencia)'))?.codigo, 'ja_feito');
  });

  it('23505 da execução ativa vira execucao_ativa', () => {
    assert.equal(traduzirErroDoBanco(erro('23505', '', 'strategy_plan_runs_uma_ativa'))?.codigo, 'execucao_ativa');
  });

  it('23505 de versão aberta vira conflito', () => {
    assert.equal(traduzirErroDoBanco(erro('23505', '', 'strategy_plan_versions_uma_aberta'))?.codigo, 'conflito');
  });

  it('FK vira nao_encontrado e erro desconhecido não é traduzido', () => {
    assert.equal(traduzirErroDoBanco(erro('23503'))?.codigo, 'nao_encontrado');
    assert.equal(traduzirErroDoBanco(erro('57014')), null);
    assert.equal(traduzirErroDoBanco(new Error('x')), null);
    assert.equal(traduzirErroDoBanco(null), null);
  });
});
