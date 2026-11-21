import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, signIn, signOut, submitAction } from './helpers.mjs';

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')[0]
    .trim();

const sufixo = randomBytes(4).toString('hex');
let org;
let cliente;
const pessoas = {};

function membro(papel) {
  const id = ensureUser(`pagina-${papel}-${sufixo}@tria.local`);
  dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${id}' AND organization_id <> '${org}'`);
  dono(
    `INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${id}', '${papel}')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL`,
  );
  return id;
}

function linkAtivo() {
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const id = dono(
    `INSERT INTO core.client_context_links (organization_id, client_id, token_hash, sections, expires_at)
     VALUES ('${org}', '${cliente}', '${hash}', ARRAY['empresa'], now() + interval '7 days') RETURNING id`,
  );
  return { id, token };
}

async function html(caminho) {
  const resposta = await browse(caminho);
  return { status: resposta.status, texto: (await resposta.text()).replaceAll('<!-- -->', '') };
}

describe('página do cliente: abas, papéis e formulário público', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Página ${sufixo}', 'pagina-${sufixo}', 'agency') RETURNING id`);
    cliente = dono(
      `INSERT INTO core.clients (organization_id, name, segment, business_model) VALUES ('${org}', 'Café ${sufixo}', 'Cafeteria', 'ecommerce') RETURNING id`,
    );
    pessoas.owner = membro('owner');
    pessoas.operator = membro('operator');
    pessoas.viewer = membro('viewer');
  });

  after(() => signOut());

  it('cada aba responde para quem administra', async () => {
    signIn(pessoas.owner);
    for (const aba of ['', '/contexto', '/brain', '/dados', '/acessos', '/configuracoes']) {
      const { status, texto } = await html(`/clientes/${cliente}${aba}`);
      assert.equal(status, 200, `aba ${aba || 'visão geral'}`);
      assert.ok(texto.includes(`Café ${sufixo}`));
    }
    const { texto } = await html(`/clientes/${cliente}/acessos`);
    assert.ok(texto.includes('Convite de integração'));
    assert.ok(texto.includes('Enviar mapa de contexto'));
  });

  it('cliente de outra organização ou id inválido dá 404', async () => {
    signIn(pessoas.owner);
    assert.equal((await browse('/clientes/nao-e-uuid')).status, 404);
    assert.equal((await browse('/clientes/00000000-0000-4000-8000-000000000000/contexto')).status, 404);
  });

  it('quem opera edita o contexto e envia o mapa, mas não cria convite de integração', async () => {
    signIn(pessoas.operator);
    const { texto } = await html(`/clientes/${cliente}/acessos`);
    assert.ok(texto.includes('Enviar mapa de contexto'));
    assert.ok(!texto.includes(`/clientes/${cliente}/convite/novo`), 'convite de integração é só de quem administra');
  });

  it('quem só vê não recebe ações de edição', async () => {
    signIn(pessoas.viewer);
    const acessos = await html(`/clientes/${cliente}/acessos`);
    assert.equal(acessos.status, 200);
    assert.ok(!acessos.texto.includes('Gerar link'));
    assert.ok(!acessos.texto.includes('>Enviar mapa de contexto<'));
    const dados = await html(`/clientes/${cliente}/dados`);
    assert.ok(!dados.texto.includes('Vincular conta ou fonte'));
  });

  it('revogar link: quem só vê é recusado, quem opera revoga', async () => {
    const { id } = linkAtivo();
    signIn(pessoas.owner);
    const acao = await acaoComCampo(`/clientes/${cliente}/acessos`, 'linkId');

    signIn(pessoas.viewer);
    const recusado = await submitAction(`/clientes/${cliente}/acessos`, acao, { clientId: cliente, linkId: id });
    assert.match(decodeURIComponent(recusado.location ?? recusado.redirectedTo ?? ''), /erro=/);
    assert.equal(dono(`SELECT revoked_at IS NULL FROM core.client_context_links WHERE id = '${id}'`), 't');

    signIn(pessoas.operator);
    const aceito = await submitAction(`/clientes/${cliente}/acessos`, acao, { clientId: cliente, linkId: id });
    assert.match(decodeURIComponent(aceito.location ?? aceito.redirectedTo ?? ''), /feito=/);
    assert.equal(dono(`SELECT revoked_at IS NOT NULL FROM core.client_context_links WHERE id = '${id}'`), 't');
  });

  it('upload autenticado exige mesma origem e sessão', async () => {
    signOut();
    const semOrigem = await fetch(`${BASE}/api/contexto/${cliente}/arquivos`, { method: 'POST', body: 'x' });
    assert.equal(semOrigem.status, 403);
    const semSessao = await fetch(`${BASE}/api/contexto/${cliente}/arquivos`, {
      method: 'POST',
      headers: { Origin: BASE, 'x-campo': 'logo', 'x-nome': 'a.png' },
      body: 'x',
    });
    assert.equal(semSessao.status, 401);
  });

  it('formulário público: link válido abre sem sessão, sem cache e sem indexação; link ruim mostra estado amigável', async () => {
    signOut();
    const { token } = linkAtivo();
    const valido = await fetch(`${BASE}/contexto/${token}`, { redirect: 'manual' });
    assert.equal(valido.status, 200);
    assert.equal(valido.headers.get('referrer-policy'), 'no-referrer');
    assert.match(valido.headers.get('cache-control') ?? '', /no-store/);
    assert.match(valido.headers.get('x-robots-tag') ?? '', /noindex/);
    const corpo = await valido.text();
    assert.ok(corpo.includes('Mapa de contexto'));
    assert.ok(!corpo.includes('Notas internas'), 'nota interna nunca vai ao cliente');

    const revogado = linkAtivo();
    dono(`UPDATE core.client_context_links SET revoked_at = now() WHERE id = '${revogado.id}'`);
    const ruim = await fetch(`${BASE}/contexto/${revogado.token}`).then((r) => r.text());
    assert.ok(ruim.includes('Este link não vale mais'));

    const upload = await fetch(`${BASE}/api/contexto/publico/${revogado.token}/arquivos`, {
      method: 'POST',
      headers: { Origin: BASE, 'x-campo': 'logo', 'x-nome': 'a.png', 'Content-Type': 'image/png' },
      body: 'x',
    });
    assert.ok([403, 404].includes(upload.status), `upload por link revogado: ${upload.status}`);
  });
});
