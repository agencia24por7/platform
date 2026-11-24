import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, signIn, signOut, submitAction } from './helpers.mjs';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
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

function negocio(org, nome, situacao = 'active') {
  return dono(`INSERT INTO core.clients (organization_id, name, business_model, status) VALUES ('${org}', '${nome}', 'ecommerce', '${situacao}') RETURNING id`);
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
    orgs.pausado = organizacao('advertiser', 'pausado');
    orgs.misto = organizacao('advertiser', 'misto');
    orgs.zero = organizacao('advertiser', 'zero');
    pessoas.pausado = membro('pausado', orgs.pausado, 'owner');
    pessoas.misto = membro('misto', orgs.misto, 'owner');
    pessoas.zero = membro('zero', orgs.zero, 'owner');
    pessoas.operadorMisto = membro('opmisto', orgs.misto, 'operator');
    pessoas.adminMisto = membro('admmisto', orgs.misto, 'admin');
    orgs.negocioPausado = negocio(orgs.pausado, `Parado ${sufixo}`, 'paused');
    negocio(orgs.misto, `Ativo ${sufixo}`);
    negocio(orgs.misto, `Pausado ${sufixo}`, 'paused');
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

  it('um único negócio em qualquer situação leva direto a ele; zero ou mais de um mostram a lista', async () => {
    signIn(pessoas.pausado);
    const pausado = await html('/clientes');
    assert.equal(new URL(pausado.location, BASE).pathname, `/clientes/${orgs.negocioPausado}`);
    signIn(pessoas.misto);
    assert.equal((await html('/clientes')).status, 200);
    signIn(pessoas.zero);
    const zero = await html('/clientes');
    assert.equal(zero.status, 200);
    assert.ok(zero.texto.includes('Novo negócio'));
  });

  it('só owner e admin do anunciante cadastram negócio, também no servidor; agência segue com quem opera', async () => {
    signIn(pessoas.misto);
    const criar = await acaoComCampo('/clientes/novo', 'name');
    signIn(pessoas.operadorMisto);
    const pagina = await html('/clientes/novo');
    assert.ok([307, 308].includes(pagina.status), 'operador de anunciante não abre o formulário');
    const recusado = await submitAction('/clientes/novo', criar, { name: `Intruso ${sufixo}`, businessModel: 'leads' });
    assert.match(decodeURIComponent(recusado.location ?? recusado.redirectedTo ?? ''), /erro=/);
    assert.equal(dono(`SELECT count(*) FROM core.clients WHERE organization_id = '${orgs.misto}' AND name = 'Intruso ${sufixo}'`), '0');
    assert.ok(!(await html('/clientes')).texto?.includes('Novo negócio'));

    signIn(pessoas.adminMisto);
    const aceito = await submitAction('/clientes/novo', criar, { name: `Segundo ${sufixo}`, businessModel: 'leads' });
    assert.ok(!/erro=/.test(decodeURIComponent(aceito.location ?? aceito.redirectedTo ?? '')));
    assert.equal(dono(`SELECT count(*) FROM core.clients WHERE organization_id = '${orgs.misto}' AND name = 'Segundo ${sufixo}'`), '1');
  });

  it('Perfil do anunciante fala de convidado, não de cliente; o da agência mantém o texto original', async () => {
    signIn(pessoas.dono);
    const anunciante = await html(`/clientes/${orgs.negocio}/contexto`);
    assert.ok(anunciante.texto.includes('Descrição do negócio'));
    assert.ok(!anunciante.texto.includes('Descrição do cliente'));
    assert.ok(!anunciante.texto.includes('Compartilhável com o cliente'));
    assert.ok(anunciante.texto.includes('Visível a quem eu convidar'));
    signIn(pessoas.agencia);
    const agencia = await html(`/clientes/${orgs.cliente}/contexto`);
    assert.ok(agencia.texto.includes('Descrição do cliente'));
  });

  it('anunciante dono ou admin cria o segundo negócio a partir do cabeçalho do negócio', async () => {
    signIn(pessoas.dono);
    const { texto } = await html(`/clientes/${orgs.negocio}/conexoes`);
    assert.ok(texto.includes('Novo negócio'));
    signIn(pessoas.agencia);
    assert.ok(!(await html(`/clientes/${orgs.cliente}/conexoes`)).texto.includes('Novo negócio'));
  });

  it('um único ponto de entrada para conectar, em anunciante e em agência', async () => {
    for (const [pessoa, alvo] of [[pessoas.dono, orgs.negocio], [pessoas.agencia, orgs.cliente]]) {
      signIn(pessoa);
      const resposta = await browse(`/clientes/${alvo}/conexoes`);
      const corpo = (await resposta.text()).replaceAll('<!-- -->', '').replace(/<script[\s\S]*?<\/script>/g, '');
      assert.equal((corpo.match(/<a [^>]*>(?:Conectar|Vincular)[^<]*<\/a>/g) ?? []).length, 1);
    }
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
