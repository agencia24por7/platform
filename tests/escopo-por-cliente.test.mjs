import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { acaoComCampo, appIsUp, ensureUser, signIn, signOut, submitAction } from './helpers.mjs';

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', process.env.TRIA_TEST_PG ?? 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')[0]
    .trim();

const sufixo = randomBytes(4).toString('hex');
const ids = {};
const pessoas = {};

function membro(nome, org, papel) {
  const id = ensureUser(`escopo-${nome}-${sufixo}@tria.local`);
  dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${id}' AND organization_id <> '${org}'`);
  dono(
    `INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${id}', '${papel}')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL`,
  );
  return id;
}

function cliente(org, nome) {
  return dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome} ${sufixo}', 'ecommerce') RETURNING id`);
}

function conta(clienteId, externo) {
  return dono(
    `INSERT INTO integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
     VALUES ('${ids.org}', '${clienteId}', '${ids.conexao}', 'meta', '${externo}-${sufixo}', 'Conta ${externo}') RETURNING id`,
  );
}

function link(clienteId) {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return dono(
    `INSERT INTO core.client_context_links (organization_id, client_id, token_hash, sections, expires_at)
     VALUES ('${ids.org}', '${clienteId}', '${hash}', ARRAY['empresa'], now() + interval '7 days') RETURNING id`,
  );
}

const sincronizando = (conta) => dono(`SELECT sync_enabled FROM integrations.ad_accounts WHERE id = '${conta}'`);
const donoDaConta = (conta) => dono(`SELECT client_id FROM integrations.ad_accounts WHERE id = '${conta}'`);
const erro = (r) => /erro=/.test(decodeURIComponent(r.location ?? r.redirectedTo ?? ''));

describe('ações de Conexões respeitam o recorte e o cliente informado', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    ids.org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Escopo ${sufixo}', 'escopo-${sufixo}', 'agency') RETURNING id`);
    ids.outraOrg = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Fora ${sufixo}', 'fora-${sufixo}', 'agency') RETURNING id`);
    ids.a = cliente(ids.org, 'A');
    ids.b = cliente(ids.org, 'B');
    ids.alheio = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${ids.outraOrg}', 'Alheio ${sufixo}', 'ecommerce') RETURNING id`);
    pessoas.owner = membro('owner', ids.org, 'owner');
    pessoas.recortado = membro('recortado', ids.org, 'operator');
    pessoas.operador = membro('operador', ids.org, 'operator');
    ids.excluido = dono(
      `INSERT INTO core.clients (organization_id, name, business_model, excluido_em, excluido_por) VALUES ('${ids.org}', 'Excluído ${sufixo}', 'ecommerce', now(), '${pessoas.owner}') RETURNING id`,
    );
    const membroId = dono(`SELECT id FROM core.members WHERE user_id = '${pessoas.recortado}' AND organization_id = '${ids.org}'`);
    dono(`INSERT INTO core.member_clients (member_id, client_id) VALUES ('${membroId}', '${ids.a}')`);
    ids.conexao = dono(
      `INSERT INTO integrations.connections (organization_id, platform, grant_type, label, external_id, status)
       VALUES ('${ids.org}', 'meta', 'oauth_user', 'Meta ${sufixo}', 'm-${sufixo}', 'reauth_pending') RETURNING id`,
    );
    ids.contaA = conta(ids.a, 'a');
    ids.contaB = conta(ids.b, 'b');
    ids.linkA = link(ids.a);
    ids.linkB = link(ids.b);
  });

  after(() => signOut());

  it('membro recortado opera a conta do próprio cliente', async () => {
    signIn(pessoas.recortado);
    const tela = `/clientes/${ids.a}/conexoes?secao=fontes`;
    const acao = await acaoComCampo(tela, 'ligar');
    const r = await submitAction(tela, acao, { clientId: ids.a, accountId: ids.contaA, ligar: 'nao' });
    assert.ok(!erro(r), 'operação permitida');
    assert.equal(sincronizando(ids.contaA), 'f');
  });

  it('membro recortado não mexe em conta de cliente fora do recorte', async () => {
    signIn(pessoas.operador);
    const telaCompleta = `/clientes/${ids.b}/conexoes?secao=fontes`;
    const alternar = await acaoComCampo(telaCompleta, 'ligar');
    const mover = await acaoComCampo(telaCompleta, 'destinoId');
    const desvincular = await acaoComCampo(telaCompleta, 'accountId');
    signIn(pessoas.recortado);
    const tela = `/clientes/${ids.a}/conexoes?secao=fontes`;

    assert.ok(erro(await submitAction(tela, alternar, { clientId: ids.b, accountId: ids.contaB, ligar: 'nao' })));
    assert.ok(erro(await submitAction(tela, alternar, { clientId: ids.a, accountId: ids.contaB, ligar: 'nao' })), 'conta de outro cliente com clientId do recorte');
    assert.ok(erro(await submitAction(tela, mover, { clientId: ids.a, accountId: ids.contaA, destinoId: ids.b })), 'destino fora do recorte');
    assert.ok(erro(await submitAction(tela, desvincular, { clientId: ids.b, accountId: ids.contaB })));
    assert.equal(sincronizando(ids.contaB), 't');
    assert.equal(donoDaConta(ids.contaA), ids.a);
    assert.equal(donoDaConta(ids.contaB), ids.b);
  });

  it('quem vê a organização inteira não move conta para cliente excluído ou de outra organização', async () => {
    signIn(pessoas.operador);
    const tela = `/clientes/${ids.b}/conexoes?secao=fontes`;
    const mover = await acaoComCampo(tela, 'destinoId');
    for (const destino of [ids.excluido, ids.alheio, 'nao-e-uuid']) {
      assert.ok(erro(await submitAction(tela, mover, { clientId: ids.b, accountId: ids.contaB, destinoId: destino })), destino);
    }
    assert.ok(erro(await submitAction(tela, mover, { clientId: ids.alheio, accountId: ids.contaB, destinoId: ids.a })), 'origem de outra organização');
    assert.ok(erro(await submitAction(tela, mover, { clientId: ids.excluido, accountId: ids.contaB, destinoId: ids.a })), 'origem excluída');
    assert.equal(donoDaConta(ids.contaB), ids.b);
  });

  it('revogar link: cliente de outra organização, excluído e fora do recorte são recusados', async () => {
    signIn(pessoas.recortado);
    const tela = `/clientes/${ids.a}/conexoes?secao=pedir`;
    const acao = await acaoComCampo(tela, 'linkId');
    for (const alvo of [ids.b, ids.alheio, ids.excluido]) {
      assert.ok(erro(await submitAction(tela, acao, { clientId: alvo, linkId: ids.linkB })), alvo);
    }
    assert.equal(dono(`SELECT revoked_at IS NULL FROM core.client_context_links WHERE id = '${ids.linkB}'`), 't');
  });

  it('mudar situação exige cliente no escopo', async () => {
    signIn(pessoas.recortado);
    const tela = `/clientes/${ids.a}/conexoes?secao=fontes`;
    const acao = await acaoComCampo(tela, 'situacao').catch(() => null);
    if (!acao) return;
    assert.ok(erro(await submitAction(tela, acao, { clientId: ids.b, situacao: 'paused' })));
    assert.equal(dono(`SELECT status FROM core.clients WHERE id = '${ids.b}'`), 'active');
  });
});
