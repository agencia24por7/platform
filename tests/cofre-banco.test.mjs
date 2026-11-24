import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { env } from './helpers.mjs';
import { psqlDonoPrimeiraLinha as dono } from './apoio/psql.mjs';

describe('cofre de tokens contra o Postgres de verdade (ADR 0032)', { concurrency: false }, () => {
  let resultado;

  before(() => {
    const org = dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Cofre no banco', 'cofre-no-banco-${Date.now()}', 'agency') RETURNING id`,
    );
    const execucao = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', '--import', './tests/apoio/registrar.mjs', 'tests/apoio/cofreNoBanco.ts', org],
      { encoding: 'utf8', env: { ...process.env, ...env(), LOG_LEVEL: 'error' }, timeout: 60_000 },
    );
    assert.equal(execucao.status, 0, execucao.stderr);
    resultado = JSON.parse(execucao.stdout.trim().split('\n').at(-1));
  });

  it('autorizar grava conexão e token juntos; renovar mantém o id e sobe a versão', () => {
    assert.deepEqual(resultado.criada, { versao: 1, status: 'active' });
    assert.equal(resultado.renovada.versao, 2);
    assert.ok(resultado.renovada.id);
  });

  it('renovação concorrente com versão velha é recusada e não sobrescreve o token mais novo', () => {
    assert.equal(resultado.atrasadaRecusada, true);
    assert.equal(resultado.versaoDepoisDoConflito, 2);
  });

  it('renovação única entre processos: um só pedido ao provedor, todos recebem o mesmo access token', () => {
    assert.deepEqual(resultado.chamadasAoProvedor, ['refresh-2']);
    assert.deepEqual(resultado.acessos, ['acesso-de-refresh-2']);
  });

  it('nenhuma transação fica aberta durante a chamada ao provedor: a linha continua gravável', () => {
    assert.equal(resultado.leaseVisivel, true, 'a concessão de renovação fica visível no banco');
    assert.ok(resultado.escritaDuranteARenovacaoMs < 400, `escrita esperou ${resultado.escritaDuranteARenovacaoMs} ms`);
    assert.equal(resultado.transacoesPresas, 0);
  });

  it('remover exige a versão lida, apaga o ciphertext e revoga no mesmo passo', () => {
    assert.equal(resultado.removerVelhoRecusado, true);
    assert.deepEqual(resultado.remocao, { revogacao: 'revogado', apagado: true });
    assert.deepEqual(resultado.removida, { status: 'revoked', versao: null, email: null });
  });

  it('o banco recusa conexão ativa sem token (gatilho adiado do corte)', () => {
    assert.match(resultado.ativaSemToken, /ativa sem token no cofre/);
  });

  it('falha velha após reautorizar não marca reauth_pending e não solta nem sobrescreve a concessão de outro processo', () => {
    const c = resultado.corridas;
    assert.equal(c.aDono, true);
    assert.equal(c.reautorizadaVersao, 2);
    assert.equal(c.statusDepoisDaFalhaVelha, 'active');
    assert.equal(c.bDono, true);
    assert.equal(c.leaseDeBPreservado, true);
    assert.equal(c.falhaVelhaNaoGravada, true);
    assert.equal(c.gravouAtrasado, false);
    assert.equal(c.leaseDeBDepoisDoAtrasado, true);
  });

  it('autorização (Google e Meta) contra o banco: conexão pós-corte reautorizada volta com o MESMO id', () => {
    for (const platform of ['ga4', 'meta']) {
      assert.deepEqual(resultado.autorizacao[platform], { mesmoId: true, status: 'active', versao: 1 }, platform);
    }
  });

  it('guardarChave contra o banco: rotacionar mantém o id, sobe a versão e guarda a chave nova cifrada', () => {
    assert.deepEqual(resultado.chave, { mesmoId: true, versao: 2, decifrada: 'apify_api_chave-segunda-com-mais-de-vinte', tipo: 'api_key' });
  });
});

