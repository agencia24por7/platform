import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, sessionCookie, signIn, signOut, submitAction } from './helpers.mjs';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
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

function conexao(org, plataforma, rotulo, status = 'reauth_pending') {
  return dono(
    `INSERT INTO integrations.connections (organization_id, platform, grant_type, label, external_id, status)
     VALUES ('${org}', '${plataforma}', 'oauth_user', '${rotulo} ${sufixo}', '${plataforma}-${rotulo}-${sufixo}', '${status}') RETURNING id`,
  );
}

function conta(org, clienteId, conexaoId, externo, plataforma = 'meta') {
  return dono(
    `INSERT INTO integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
     VALUES ('${org}', '${clienteId}', '${conexaoId}', '${plataforma}', '${externo}-${sufixo}', 'Conta ${externo}') RETURNING id`,
  );
}

function fonte(clienteId, externo) {
  return dono(
    `INSERT INTO integrations.connection_accounts (organization_id, connection_id, platform, external_id, name, state, client_id)
     VALUES ('${ids.org}', '${ids.conexaoGoogle}', 'ga4', '${externo}-${sufixo}', 'Fonte ${externo}', 'linked', '${clienteId}') RETURNING id`,
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

const sincronizando = (id) => dono(`SELECT sync_enabled FROM integrations.ad_accounts WHERE id = '${id}'`);
const donoDaConta = (id) => dono(`SELECT client_id FROM integrations.ad_accounts WHERE id = '${id}'`);
const estadoDaConta = (id) => dono(`SELECT status FROM integrations.ad_accounts WHERE id = '${id}'`);
const estadoDaFonte = (id) => dono(`SELECT state || '|' || coalesce(client_id::text, '-') FROM integrations.connection_accounts WHERE id = '${id}'`);
const erro = (r) => /erro=/.test(decodeURIComponent(r.location ?? r.redirectedTo ?? ''));

async function acaoDoBotao(caminho, rotuloDoBotao, campo) {
  const html = (await (await browse(caminho)).text()).replaceAll('<!-- -->', '');
  for (const pedaco of html.split('<form').slice(1)) {
    const formulario = pedaco.slice(0, pedaco.indexOf('</form>'));
    if (!formulario.includes(`name="${campo}"`) || !formulario.includes(`>${rotuloDoBotao}<`)) continue;
    const id = formulario.match(/name="\$ACTION_ID_([a-f0-9]+)"/)?.[1];
    if (id) return id;
  }
  throw new Error(`Nenhuma action com o botão "${rotuloDoBotao}" e o campo "${campo}" em ${caminho}`);
}

async function acoesDeFontes() {
  signIn(pessoas.owner);
  const tela = `/clientes/${ids.b}/conexoes?secao=fontes`;
  return {
    alternar: await acaoDoBotao(tela, 'Pausar coleta', 'accountId'),
    moverConta: await acaoDoBotao(tela, 'Mover', 'accountId'),
    desvincularConta: await acaoDoBotao(tela, 'Desvincular', 'accountId'),
    moverFonte: await acaoDoBotao(tela, 'Mover', 'recursoId'),
    desvincularFonte: await acaoDoBotao(tela, 'Desvincular', 'recursoId'),
  };
}

describe('ações de Conexões respeitam o recorte, o papel e o cliente informado', { concurrency: false }, () => {
  let acao;

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
    pessoas.viewer = membro('viewer', ids.org, 'viewer');
    ids.excluido = dono(
      `INSERT INTO core.clients (organization_id, name, business_model, excluido_em, excluido_por) VALUES ('${ids.org}', 'Excluído ${sufixo}', 'ecommerce', now(), '${pessoas.owner}') RETURNING id`,
    );
    const membroId = dono(`SELECT id FROM core.members WHERE user_id = '${pessoas.recortado}' AND organization_id = '${ids.org}'`);
    dono(`INSERT INTO core.member_clients (member_id, client_id) VALUES ('${membroId}', '${ids.a}')`);
    ids.conexao = conexao(ids.org, 'meta', 'Meta');
    ids.conexaoGoogle = conexao(ids.org, 'google', 'Google');
    ids.conexaoAlheia = conexao(ids.outraOrg, 'meta', 'Alheia');
    ids.contaA = conta(ids.org, ids.a, ids.conexao, 'a');
    ids.contaB = conta(ids.org, ids.b, ids.conexao, 'b');
    ids.contaAlheia = conta(ids.outraOrg, ids.alheio, ids.conexaoAlheia, 'alheia');
    ids.fonteB = fonte(ids.b, 'fb');
    ids.fonteB2 = fonte(ids.b, 'fb2');
    ids.fonteA = fonte(ids.a, 'fa');
    ids.linkA = link(ids.a);
    ids.linkB = link(ids.b);
    acao = await acoesDeFontes();
  });

  after(() => signOut());

  it('controle positivo: quem vê tudo opera, move e desvincula o que é do cliente informado', async () => {
    signIn(pessoas.owner);
    const tela = `/clientes/${ids.b}/conexoes?secao=fontes`;
    assert.ok(!erro(await submitAction(tela, acao.alternar, { clientId: ids.b, accountId: ids.contaB, ligar: 'nao' })));
    assert.equal(sincronizando(ids.contaB), 'f');
    assert.ok(!erro(await submitAction(tela, acao.moverFonte, { clientId: ids.b, recursoId: ids.fonteB2, destinoId: ids.a })));
    assert.equal(estadoDaFonte(ids.fonteB2), `linked|${ids.a}`);
    assert.ok(!erro(await submitAction(tela, acao.desvincularFonte, { clientId: ids.a, recursoId: ids.fonteB2 })));
    assert.equal(estadoDaFonte(ids.fonteB2).startsWith('discovered'), true);
    assert.ok(!erro(await submitAction(tela, acao.alternar, { clientId: ids.b, accountId: ids.contaB, ligar: 'sim' })));
  });

  it('membro recortado opera a conta do próprio cliente', async () => {
    signIn(pessoas.recortado);
    const tela = `/clientes/${ids.a}/conexoes?secao=fontes`;
    const r = await submitAction(tela, acao.alternar, { clientId: ids.a, accountId: ids.contaA, ligar: 'nao' });
    assert.ok(!erro(r), 'operação permitida');
    assert.equal(sincronizando(ids.contaA), 'f');
  });

  it('membro recortado não mexe em conta nem fonte de cliente fora do recorte, nem manda para fora', async () => {
    signIn(pessoas.recortado);
    const tela = `/clientes/${ids.a}/conexoes?secao=fontes`;
    assert.ok(erro(await submitAction(tela, acao.alternar, { clientId: ids.b, accountId: ids.contaB, ligar: 'nao' })));
    assert.ok(erro(await submitAction(tela, acao.alternar, { clientId: ids.a, accountId: ids.contaB, ligar: 'nao' })), 'conta de outro cliente com clientId do recorte');
    assert.ok(erro(await submitAction(tela, acao.moverConta, { clientId: ids.a, accountId: ids.contaA, destinoId: ids.b })), 'destino fora do recorte');
    assert.ok(erro(await submitAction(tela, acao.desvincularConta, { clientId: ids.b, accountId: ids.contaB })));
    assert.ok(erro(await submitAction(tela, acao.desvincularConta, { clientId: ids.a, accountId: ids.contaB })));
    assert.ok(erro(await submitAction(tela, acao.moverFonte, { clientId: ids.a, recursoId: ids.fonteA, destinoId: ids.b })));
    assert.ok(erro(await submitAction(tela, acao.desvincularFonte, { clientId: ids.b, recursoId: ids.fonteB })));
    assert.equal(sincronizando(ids.contaB), 't');
    assert.equal(donoDaConta(ids.contaA), ids.a);
    assert.equal(donoDaConta(ids.contaB), ids.b);
    assert.equal(estadoDaFonte(ids.fonteA), `linked|${ids.a}`);
    assert.equal(estadoDaFonte(ids.fonteB), `linked|${ids.b}`);
  });

  it('quem vê a organização inteira não age sobre cliente excluído, de outra organização ou conta alheia', async () => {
    signIn(pessoas.operador);
    const tela = `/clientes/${ids.b}/conexoes?secao=fontes`;
    for (const destino of [ids.excluido, ids.alheio, 'nao-e-uuid']) {
      assert.ok(erro(await submitAction(tela, acao.moverConta, { clientId: ids.b, accountId: ids.contaB, destinoId: destino })), destino);
      assert.ok(erro(await submitAction(tela, acao.moverFonte, { clientId: ids.b, recursoId: ids.fonteB, destinoId: destino })), destino);
    }
    assert.ok(erro(await submitAction(tela, acao.moverConta, { clientId: ids.alheio, accountId: ids.contaB, destinoId: ids.a })), 'origem de outra organização');
    assert.ok(erro(await submitAction(tela, acao.moverConta, { clientId: ids.excluido, accountId: ids.contaB, destinoId: ids.a })), 'origem excluída');
    assert.ok(erro(await submitAction(tela, acao.desvincularConta, { clientId: ids.b, accountId: ids.contaAlheia })), 'conta de outra organização');
    assert.ok(erro(await submitAction(tela, acao.desvincularConta, { clientId: ids.alheio, accountId: ids.contaAlheia })), 'cliente de outra organização');
    assert.ok(erro(await submitAction(tela, acao.desvincularFonte, { clientId: ids.excluido, recursoId: ids.fonteB })), 'fonte com origem excluída');
    assert.equal(donoDaConta(ids.contaB), ids.b);
    assert.equal(estadoDaConta(ids.contaAlheia), 'linked');
    assert.equal(estadoDaFonte(ids.fonteB), `linked|${ids.b}`);
  });

  it('quem só vê é recusado em todas as ações de Conexões', async () => {
    signIn(pessoas.viewer);
    const tela = `/clientes/${ids.b}/conexoes?secao=fontes`;
    await submitAction(tela, acao.alternar, { clientId: ids.b, accountId: ids.contaB, ligar: 'nao' });
    await submitAction(tela, acao.desvincularConta, { clientId: ids.b, accountId: ids.contaB });
    await submitAction(tela, acao.moverConta, { clientId: ids.b, accountId: ids.contaB, destinoId: ids.a });
    await submitAction(tela, acao.desvincularFonte, { clientId: ids.b, recursoId: ids.fonteB });
    await submitAction(tela, acao.moverFonte, { clientId: ids.b, recursoId: ids.fonteB, destinoId: ids.a });
    assert.equal(sincronizando(ids.contaB), 't');
    assert.equal(estadoDaConta(ids.contaB), 'linked');
    assert.equal(donoDaConta(ids.contaB), ids.b);
    assert.equal(estadoDaFonte(ids.fonteB), `linked|${ids.b}`);
  });

  it('revogar link: cliente de outra organização, excluído e fora do recorte são recusados', async () => {
    signIn(pessoas.owner);
    const tela = `/clientes/${ids.a}/conexoes?secao=pedir`;
    const revogar = await acaoDoBotao(tela, 'Revogar', 'linkId');
    signIn(pessoas.recortado);
    for (const alvo of [ids.b, ids.alheio, ids.excluido]) {
      assert.ok(erro(await submitAction(tela, revogar, { clientId: alvo, linkId: ids.linkB })), alvo);
    }
    assert.equal(dono(`SELECT revoked_at IS NULL FROM core.client_context_links WHERE id = '${ids.linkB}'`), 't');
    assert.ok(!erro(await submitAction(tela, revogar, { clientId: ids.a, linkId: ids.linkA })), 'controle positivo no próprio cliente');
    assert.equal(dono(`SELECT revoked_at IS NOT NULL FROM core.client_context_links WHERE id = '${ids.linkA}'`), 't');
  });

  it('revogar convite de integração: cliente de outra organização não derruba convite, e recortado nem vê o botão', async () => {
    const convite = dono(
      `INSERT INTO integrations.connection_invites (organization_id, client_id, kind, token, expires_at)
       VALUES ('${ids.org}', '${ids.a}', 'oauth_self_service', '${randomBytes(24).toString('base64url')}', now() + interval '7 days') RETURNING id`,
    );
    dono(
      `INSERT INTO integrations.connection_invite_items (invite_id, organization_id, platform)
       VALUES ('${convite}', '${ids.org}', 'meta')`,
    );
    signIn(pessoas.owner);
    const tela = `/clientes/${ids.a}/conexoes?secao=pedir`;
    const revogar = await acaoDoBotao(tela, 'Revogar', 'inviteId');
    const status = () => dono(`SELECT status FROM integrations.connection_invites WHERE id = '${convite}'`);
    signIn(pessoas.recortado);
    const doRecortado = await submitAction(tela, revogar, { clientId: ids.a, inviteId: convite });
    assert.ok(!/feito=/.test(decodeURIComponent(doRecortado.location ?? '')), 'recortado não administra');
    assert.equal(status(), 'pending');
    signIn(pessoas.owner);
    assert.ok(erro(await submitAction(tela, revogar, { clientId: ids.alheio, inviteId: convite })), 'cliente de outra organização');
    assert.equal(status(), 'pending');
    assert.ok(!erro(await submitAction(tela, revogar, { clientId: ids.a, inviteId: convite })), 'controle positivo');
    assert.equal(status(), 'revoked');
  });

  it('vincular conta: cliente de outra organização ou fora do recorte não recebe a fonte', async () => {
    const descoberta = dono(
      `INSERT INTO integrations.connection_accounts (organization_id, connection_id, platform, external_id, name, state)
       VALUES ('${ids.org}', '${ids.conexaoGoogle}', 'ga4', 'desc-${sufixo}', 'Descoberta ${sufixo}', 'discovered') RETURNING id`,
    );
    signIn(pessoas.owner);
    const vincular = await acaoComCampo(`/clientes/${ids.b}/contas/nova`, 'descobertaId');
    for (const alvo of [ids.alheio, ids.excluido, 'nao-e-uuid']) {
      await submitAction(`/clientes/${ids.b}/contas/nova`, vincular, { clientId: alvo, descobertaId: descoberta });
      assert.equal(estadoDaFonte(descoberta).startsWith('discovered'), true, alvo);
    }
  });

  it('página de vincular conta: recortado recebe 404 em cliente fora do recorte', async () => {
    signIn(pessoas.recortado);
    assert.equal((await browse(`/clientes/${ids.b}/contas/nova`)).status, 404);
    assert.equal((await browse(`/clientes/${ids.alheio}/contas/nova`)).status, 404);
  });

  it('envio interno de arquivo: cliente de outra organização, excluído ou fora do recorte dá 404', async () => {
    const enviar = (clienteId, usuario) =>
      fetch(`${BASE}/api/contexto/${clienteId}/arquivos`, {
        method: 'POST',
        headers: { Cookie: sessionCookie(usuario), Origin: new URL(BASE).origin, 'content-type': 'application/octet-stream' },
        body: 'x',
      });
    assert.equal((await enviar(ids.alheio, pessoas.owner)).status, 404);
    assert.equal((await enviar(ids.excluido, pessoas.owner)).status, 404);
    assert.equal((await enviar(ids.b, pessoas.recortado)).status, 404);
    assert.notEqual((await enviar(ids.a, pessoas.recortado)).status, 404, 'cliente do recorte passa do escopo');
  });

  it('mudar situação exige cliente no escopo e papel', async () => {
    signIn(pessoas.owner);
    const tela = `/clientes/${ids.a}/conexoes?secao=fontes`;
    const mudar = await acaoDoBotao(tela, 'Aplicar', 'situacao');
    signIn(pessoas.recortado);
    assert.ok(erro(await submitAction(tela, mudar, { clientId: ids.b, situacao: 'paused' })));
    assert.equal(dono(`SELECT status FROM core.clients WHERE id = '${ids.b}'`), 'active');
    assert.ok(erro(await submitAction(tela, mudar, { clientId: ids.alheio, situacao: 'paused' })));
    assert.equal(dono(`SELECT status FROM core.clients WHERE id = '${ids.alheio}'`), 'active');
    signIn(pessoas.viewer);
    await submitAction(tela, mudar, { clientId: ids.b, situacao: 'paused' });
    assert.equal(dono(`SELECT status FROM core.clients WHERE id = '${ids.b}'`), 'active');
    signIn(pessoas.owner);
    assert.ok(!erro(await submitAction(tela, mudar, { clientId: ids.b, situacao: 'paused' })), 'controle positivo');
    assert.equal(dono(`SELECT status FROM core.clients WHERE id = '${ids.b}'`), 'paused');
  });

  it('reautorização é só das conexões do cliente: outro cliente, conexão revogada e cliente sem fontes não pesam', async () => {
    dono(`UPDATE integrations.connections SET status = 'reauth_pending' WHERE id = '${ids.conexao}'`);
    dono(`UPDATE integrations.connections SET status = 'revoked' WHERE id = '${ids.conexaoGoogle}'`);
    const clienteSemFontes = cliente(ids.org, 'Sem fontes');
    signIn(pessoas.owner);
    const texto = async (id) => (await (await browse(`/clientes/${id}/conexoes`)).text()).replaceAll('<!-- -->', '').replace(/<script[\s\S]*?<\/script>/g, '');
    const doClienteA = await texto(ids.a);
    assert.ok(doClienteA.includes('Reautorizar Meta Ads'), 'cliente com conta na conexão em reautorização');
    assert.ok(!doClienteA.includes('Reautorizar Google Ads'), 'conexão revogada não pesa');
    const semFontes = await texto(clienteSemFontes);
    assert.ok(!semFontes.includes('Reautorizar Meta Ads'), 'cliente sem fontes não herda a reautorização da organização');
    assert.ok(!semFontes.includes('Reautorizar Google Ads'));
  });

  it('o aviso de reautorização não aparece em outro cliente cuja conexão está em dia', async () => {
    const outraConexao = conexao(ids.org, 'meta', 'Meta2', 'reauth_pending');
    dono(
      `INSERT INTO integrations.connection_tokens (connection_id, organization_id, tipo, ciphertext, kms_key_version, algoritmo)
       VALUES ('${outraConexao}', '${ids.org}', 'oauth_refresh', decode(repeat('ab',40),'hex'), 'v1', 'aes-256-gcm+local')`,
    );
    const clienteC = cliente(ids.org, 'C');
    const clienteD = cliente(ids.org, 'D');
    const comProblema = conexao(ids.org, 'google', 'GoogleC', 'reauth_pending');
    conta(ids.org, clienteC, comProblema, 'c', 'google');
    conta(ids.org, clienteD, outraConexao, 'd');
    dono(`UPDATE integrations.connections SET status = 'active' WHERE id = '${outraConexao}'`);
    signIn(pessoas.owner);
    const texto = async (id) => (await (await browse(`/clientes/${id}/conexoes`)).text()).replaceAll('<!-- -->', '').replace(/<script[\s\S]*?<\/script>/g, '');
    assert.ok((await texto(clienteC)).includes('Reautorizar Google Ads'));
    assert.ok(!(await texto(clienteD)).includes('Reautorizar Google Ads'));
  });
});
