import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, signIn, signOut, submitAction } from './helpers.mjs';

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', process.env.TRIA_TEST_PG ?? 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')[0]
    .trim();

const sufixo = randomBytes(4).toString('hex');
const orgs = {};
const pessoas = {};

function organizacao(tipo, apelido) {
  return dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('${apelido} ${sufixo}', '${apelido}-${sufixo}', '${tipo}') RETURNING id`);
}

function membro(nome, org, papel) {
  const id = ensureUser(`anunciante-${nome}-${sufixo}@tria.local`);
  dono(`UPDATE core.members SET revoked_at = now() WHERE user_id = '${id}' AND organization_id <> '${org}'`);
  dono(
    `INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${id}', '${papel}')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL`,
  );
  return id;
}

function negocio(org, nome) {
  return dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome}', 'ecommerce') RETURNING id`);
}

async function html(caminho) {
  const resposta = await browse(caminho);
  const texto = (await resposta.text()).replaceAll('<!-- -->', '').replace(/<script[\s\S]*?<\/script>/g, '');
  return { status: resposta.status, location: resposta.headers.get('location'), texto };
}

describe('anunciante direto: vocabulário, atalho e tipo da organização', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    orgs.anunciante = organizacao('advertiser', 'unico');
    orgs.agencia = organizacao('agency', 'agencia');
    orgs.varios = organizacao('advertiser', 'varios');
    pessoas.dono = membro('dono', orgs.anunciante, 'owner');
    pessoas.admin = membro('admin', orgs.anunciante, 'admin');
    pessoas.agencia = membro('agencia', orgs.agencia, 'owner');
    pessoas.varios = membro('varios', orgs.varios, 'owner');
    orgs.negocio = negocio(orgs.anunciante, `Loja ${sufixo}`);
    orgs.cliente = negocio(orgs.agencia, `Cliente ${sufixo}`);
    negocio(orgs.varios, `Primeiro ${sufixo}`);
    negocio(orgs.varios, `Segundo ${sufixo}`);
  });

  after(() => signOut());

  it('com um único negócio ativo a lista leva direto ao negócio', async () => {
    signIn(pessoas.dono);
    const { status, location } = await html('/clientes');
    assert.ok([307, 308].includes(status), `status ${status}`);
    assert.equal(new URL(location, BASE).pathname, `/clientes/${orgs.negocio}`);
  });

  it('com dois ou mais negócios a lista continua normal', async () => {
    signIn(pessoas.varios);
    const { status, texto } = await html('/clientes');
    assert.equal(status, 200);
    assert.ok(texto.includes(`Primeiro ${sufixo}`) && texto.includes(`Segundo ${sufixo}`));
  });

  it('anunciante não vê "Enviar mapa" nem "Pedir ao cliente"; vê "Convidar"', async () => {
    signIn(pessoas.dono);
    for (const rota of ['/conexoes', '/conexoes?secao=pedir', '/contexto']) {
      const { status, texto } = await html(`/clientes/${orgs.negocio}${rota}`);
      assert.equal(status, 200, rota);
      assert.ok(!texto.includes('Enviar mapa'), `Enviar mapa em ${rota}`);
      assert.ok(!texto.includes('Pedir ao cliente'), `Pedir ao cliente em ${rota}`);
    }
    const pedir = await html(`/clientes/${orgs.negocio}/conexoes?secao=pedir`);
    assert.ok(pedir.texto.includes('Convidar'));
  });

  it('anunciante com um negócio não vê a entrada de Conexões da organização no menu', async () => {
    signIn(pessoas.dono);
    const { texto } = await html(`/clientes/${orgs.negocio}/conexoes`);
    assert.ok(!texto.includes('href="/integracoes"'));
  });

  it('agência continua vendo o texto de agência', async () => {
    signIn(pessoas.agencia);
    const { texto } = await html(`/clientes/${orgs.cliente}/conexoes?secao=pedir`);
    assert.ok(texto.includes('Pedir ao cliente'));
    assert.ok(texto.includes('href="/integracoes"'));
  });

  it('anunciante não vê o seletor de tipo nem os identificadores de agência em /config', async () => {
    signIn(pessoas.dono);
    const { texto } = await html('/config');
    assert.ok(!texto.includes('Como esta organização trabalha'));
    assert.ok(!texto.includes('Business Manager do Meta'));
  });

  it('mudarTipo: só o dono executa; admin é recusado no servidor', async () => {
    signIn(pessoas.agencia);
    const acao = await acaoComCampo('/config', 'tipo');

    signIn(pessoas.admin);
    const recusado = await submitAction('/config', acao, { tipo: 'agency' });
    assert.match(decodeURIComponent(recusado.location ?? recusado.redirectedTo ?? ''), /erro=/);
    assert.equal(dono(`SELECT type FROM core.organizations WHERE id = '${orgs.anunciante}'`), 'advertiser');

    signIn(pessoas.agencia);
    const aceito = await submitAction('/config', acao, { tipo: 'agency' });
    assert.match(decodeURIComponent(aceito.location ?? aceito.redirectedTo ?? ''), /feito=/);
  });
});
