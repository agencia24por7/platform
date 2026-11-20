import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, makeOwner, signIn, signOut, submitAction } from './helpers.mjs';

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  }).trim();

const umaLinha = (saida) => saida.split('\n')[0].trim();

describe('remover uma conexão', { concurrency: false }, () => {
  let org = '';
  let conexao = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');

    org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Remoção', 'remocao-${Date.now()}', 'agency') RETURNING id`,
    ));
    const pessoa = ensureUser('remove@tria.local');
    dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${pessoa}' AND organization_id <> '${org}'`);
    makeOwner(pessoa, org);
    conexao = umaLinha(dono(
      `INSERT INTO integrations.connections
         (organization_id, platform, grant_type, label, external_id, scopes, credential_ref, account_email, coletor_ref)
       VALUES ('${org}', 'ga4', 'oauth_user', 'GA4 para remover', 'ga4-remover',
               ARRAY['https://www.googleapis.com/auth/analytics.readonly'], 'n8n:credential:remover',
               'dono@cliente.test', 'wfColetorRemover')
       RETURNING id`,
    ));
    signIn(pessoa);
  });

  it('o papel do app consegue revogar: a conexão sai da tela e não guarda mais nada que identifique ou dê acesso', async () => {
    const remover = await acaoComCampo('/integracoes/conector/ga4', 'connectionId');
    const resultado = await submitAction('/integracoes/conector/ga4', remover, {
      connectionId: conexao,
      voltarPara: '/integracoes/conector/ga4',
    });
    assert.ok([200, 303].includes(resultado.status), `status inesperado: ${resultado.status}`);

    const linha = umaLinha(dono(
      `SELECT status || '|' || credential_ref || '|' || coalesce(account_email, '-') || '|' || coalesce(coletor_ref, '-')
         FROM integrations.connections WHERE id = '${conexao}'`,
    ));
    assert.equal(linha, 'revoked|descartada|-|-');

    const auditado = umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log WHERE action = 'connection.removed' AND target_id = '${conexao}'`,
    ));
    assert.equal(auditado, '1');

    const tela = await (await browse('/integracoes/conector/ga4')).text();
    assert.ok(!tela.includes('ga4-remover'), 'conexão revogada continua listada');
  });

  it('remover de novo não acha a conexão', async () => {
    const tela = await (await browse('/integracoes/conector/ga4')).text();
    assert.ok(!tela.includes(`value="${conexao}"`));
    signOut();
  });
});

describe('sair encerra a sessão de verdade', { concurrency: false }, () => {
  it('um cookie copiado antes do logout deixa de valer depois dele', async () => {
    const pessoa = ensureUser('sair@tria.local');
    const org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Sair', 'sair-${Date.now()}', 'agency') RETURNING id`,
    ));
    makeOwner(pessoa, org);
    const cookie = signIn(pessoa);
    await new Promise((resolver) => setTimeout(resolver, 20));

    assert.equal((await browse('/clientes')).status, 200);

    const saida = await fetch(`${BASE}/api/auth/sair`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: BASE },
      redirect: 'manual',
    });
    assert.equal(saida.status, 303);

    const depois = await browse('/clientes');
    assert.ok([302, 307].includes(depois.status), `sessão antiga ainda vale: ${depois.status}`);
    signOut();
  });
});
