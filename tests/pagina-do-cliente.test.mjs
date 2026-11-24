import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, signIn, signOut, submitAction } from './helpers.mjs';
import { psqlDonoPrimeiraLinha as dono } from './apoio/psql.mjs';

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

  it('cada bloco e seção responde para quem administra', async () => {
    signIn(pessoas.owner);
    for (const rota of ['/conexoes', '/conexoes?secao=fontes', '/conexoes?secao=pedir', '/contexto', '/contexto?secao=brain']) {
      const { status, texto } = await html(`/clientes/${cliente}${rota}`);
      assert.equal(status, 200, `rota ${rota}`);
      assert.ok(texto.includes(`Café ${sufixo}`));
    }
    const { texto } = await html(`/clientes/${cliente}/conexoes?secao=pedir`);
    assert.ok(texto.includes('Pedir ao cliente'));
    assert.ok(texto.includes('Pronto para planejar'));
  });

  it('rotas antigas redirecionam para o destino da tabela do ADR 0036', async () => {
    signIn(pessoas.owner);
    const casos = [
      ['', '/conexoes'],
      ['/dados', '/conexoes?secao=fontes'],
      ['/acessos', '/conexoes?secao=pedir'],
      ['/acessos?enviar=contexto', '/conexoes?enviar=contexto&secao=pedir'],
      ['/brain', '/contexto?secao=brain'],
      ['/configuracoes', '/conexoes'],
      ['/dados?feito=Ok', '/conexoes?feito=Ok&secao=fontes'],
    ];
    for (const [antiga, nova] of casos) {
      const resposta = await browse(`/clientes/${cliente}${antiga}`);
      assert.ok([301, 302, 307, 308].includes(resposta.status), `${antiga || 'raiz'}: ${resposta.status}`);
      assert.equal(new URL(resposta.headers.get('location'), BASE).pathname + new URL(resposta.headers.get('location'), BASE).search, `/clientes/${cliente}${nova}`);
    }
  });

  it('cliente de outra organização ou excluído dá 404 em todas as rotas novas e antigas', async () => {
    const outraOrg = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Outra ${sufixo}', 'outra-${sufixo}', 'agency') RETURNING id`);
    const alheio = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${outraOrg}', 'Alheio ${sufixo}', 'ecommerce') RETURNING id`);
    const excluido = dono(`INSERT INTO core.clients (organization_id, name, business_model, excluido_em, excluido_por) VALUES ('${org}', 'Excluído ${sufixo}', 'ecommerce', now(), '${pessoas.owner}') RETURNING id`);
    signIn(pessoas.owner);
    for (const id of [alheio, excluido]) {
      for (const rota of ['', '/conexoes', '/conexoes?secao=pedir', '/contexto', '/contexto?secao=brain', '/dados', '/acessos', '/brain', '/configuracoes']) {
        assert.equal((await browse(`/clientes/${id}${rota}`)).status, 404, `${id}${rota}`);
      }
    }
  });

  it('existe um único ponto de entrada para conectar na página de conexões', async () => {
    signIn(pessoas.owner);
    for (const rota of ['/conexoes', '/conexoes?secao=fontes']) {
      const resposta = await browse(`/clientes/${cliente}${rota}`);
      const corpo = (await resposta.text()).replaceAll('<!-- -->', '').replace(/<script[\s\S]*?<\/script>/g, '');
      assert.ok(corpo.includes('Pronto para planejar'), `a prontidão precisa carregar em ${rota}`);
      const entradas = [...corpo.matchAll(/<a [^>]*>((?:Conectar|Vincular)[^<]*)<\/a>/g)];
      assert.equal(entradas.length, 1, rota);
      const noCabecalho = entradas[0].index < corpo.indexOf('id="t-fontes"');
      assert.equal(noCabecalho, entradas[0][1] !== 'Conectar conta', 'ação de conexão no cabeçalho esconde o botão de Fontes; sem ela, o botão é o de Fontes');
    }
  });

  it('link público não traz campo não compartilhável nem anotação interna', async () => {
    const entrada = (campo, valor, compartilhavel) =>
      dono(
        `INSERT INTO core.client_context_entries (organization_id, client_id, section, field_key, value, source, shareable)
         VALUES ('${org}', '${cliente}', 'empresa', '${campo}', to_jsonb('${valor}'::text), 'equipe', ${compartilhavel})
         ON CONFLICT DO NOTHING RETURNING id`,
      );
    entrada('notas_internas_empresa', `SEGREDO-INTERNO-${sufixo}`, false);
    entrada('descricao_do_cliente', `PRIVADO-DA-EQUIPE-${sufixo}`, false);
    const { token } = linkAtivo();
    signOut();
    const corpo = await fetch(`${BASE}/contexto/${token}`).then((r) => r.text());
    assert.ok(corpo.includes('Mapa de contexto'));
    assert.ok(!corpo.includes(`SEGREDO-INTERNO-${sufixo}`), 'anotação interna vazou');
    assert.ok(!corpo.includes(`PRIVADO-DA-EQUIPE-${sufixo}`), 'campo não compartilhável vazou');
  });

  it('cliente de outra organização ou id inválido dá 404', async () => {
    signIn(pessoas.owner);
    assert.equal((await browse('/clientes/nao-e-uuid')).status, 404);
    assert.equal((await browse('/clientes/00000000-0000-4000-8000-000000000000/contexto')).status, 404);
  });

  it('quem opera edita o contexto e envia o mapa, mas não cria convite de integração', async () => {
    signIn(pessoas.operator);
    const { texto } = await html(`/clientes/${cliente}/conexoes?secao=pedir`);
    assert.ok(texto.includes('Pedir ao cliente'));
    assert.ok(!texto.includes('Conectar contas'), 'plataformas do convite são só de quem administra');
  });

  it('quem só vê não recebe ações de edição', async () => {
    signIn(pessoas.viewer);
    const acessos = await html(`/clientes/${cliente}/conexoes?secao=pedir`);
    assert.equal(acessos.status, 200);
    assert.ok(!acessos.texto.includes('Gerar link'));
    assert.ok(!acessos.texto.includes('>Pedir ao cliente<</button>'));
    const dados = await html(`/clientes/${cliente}/conexoes?secao=fontes`);
    assert.ok(!dados.texto.includes('>Conectar conta<'));
  });

  it('revogar link: quem só vê é recusado, quem opera revoga', async () => {
    const { id } = linkAtivo();
    signIn(pessoas.owner);
    const acao = await acaoComCampo(`/clientes/${cliente}/conexoes?secao=pedir`, 'linkId');

    signIn(pessoas.viewer);
    const recusado = await submitAction(`/clientes/${cliente}/conexoes?secao=pedir`, acao, { clientId: cliente, linkId: id });
    assert.match(decodeURIComponent(recusado.location ?? recusado.redirectedTo ?? ''), /erro=/);
    assert.equal(dono(`SELECT revoked_at IS NULL FROM core.client_context_links WHERE id = '${id}'`), 't');

    signIn(pessoas.operator);
    const aceito = await submitAction(`/clientes/${cliente}/conexoes?secao=pedir`, acao, { clientId: cliente, linkId: id });
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
