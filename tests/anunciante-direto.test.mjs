import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { BASE, acaoComCampo, appIsUp, browse, ensureUser, env, signIn, signOut, sqlDeConexao, submitAction } from './helpers.mjs';
import { psqlDonoPrimeiraLinha as dono } from './apoio/psql.mjs';

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
    for (const rota of ['/conexoes', '/contexto', '/atividade']) {
      const { status, texto } = await html(`/clientes/${orgs.negocio}${rota}`);
      assert.equal(status, 200, rota);
      assert.ok(!texto.includes('Enviar mapa'), `Enviar mapa em ${rota}`);
      assert.ok(!texto.includes('Pedir ao cliente'), `Pedir ao cliente em ${rota}`);
    }
    const pedir = await html(`/clientes/${orgs.negocio}/conexoes`);
    assert.ok(pedir.texto.includes('Convidar'));
  });

  it('anunciante com um negócio não vê a entrada de Conexões da organização no menu', async () => {
    signIn(pessoas.dono);
    const { texto } = await html(`/clientes/${orgs.negocio}/conexoes`);
    assert.ok(!texto.includes('href="/integracoes"'));
  });

  it('agência continua vendo o texto de agência', async () => {
    signIn(pessoas.agencia);
    const { texto } = await html(`/clientes/${orgs.cliente}/conexoes`);
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

  it('seleção de contas: operador de anunciante é recusado no servidor e nenhuma conta muda de estado', async () => {
    const org = organizacao('advertiser', 'onboarding');
    const admin = membro('onbadmin', org, 'admin');
    const operador = membro('onbop', org, 'operator');
    const conexaoId = dono(
      sqlDeConexao({ organizationId: org, platform: 'meta', label: `Meta ${sufixo}`, externalId: `meta-onb-${sufixo}` }).sql,
    );
    const descoberta = (externo) =>
      dono(
        `INSERT INTO integrations.connection_accounts (organization_id, connection_id, platform, external_id, name, state)
         VALUES ('${org}', '${conexaoId}', 'meta', '${externo}-${sufixo}', 'Conta ${externo}', 'discovered') RETURNING id`,
      );
    const escolhida = descoberta('escolhida');
    const outra = descoberta('outra');
    const estados = () => dono(`SELECT string_agg(state::text, ',' ORDER BY external_id) FROM integrations.connection_accounts WHERE organization_id = '${org}'`);

    signIn(admin);
    const acao = await acaoComCampo('/comecar/contas', 'clientName');

    signIn(operador);
    const recusado = await submitAction('/comecar/contas', acao, { selecionadas: [escolhida], clientName: `Intruso ${sufixo}` });
    assert.match(decodeURIComponent(recusado.location ?? recusado.redirectedTo ?? ''), /erro=/);
    assert.equal(dono(`SELECT count(*) FROM core.clients WHERE organization_id = '${org}'`), '0');
    assert.equal(estados(), 'discovered,discovered');

    const existente = negocio(org, `Existente ${sufixo}`);
    signIn(admin);
    const conflito = await submitAction('/comecar/contas', acao, { selecionadas: [escolhida], clientName: `Existente ${sufixo}` });
    assert.match(decodeURIComponent(conflito.location ?? conflito.redirectedTo ?? ''), /erro=/, 'falha ao criar não cai em outro negócio');
    assert.equal(dono(`SELECT count(*) FROM integrations.ad_accounts WHERE organization_id = '${org}'`), '0');
    assert.equal(dono(`SELECT count(*) FROM integrations.ad_accounts WHERE client_id = '${existente}'`), '0');
    assert.equal(estados(), 'discovered,discovered', 'nenhuma conta vinculada nem ignorada');
    assert.ok(outra);
  });

  it('seleção de contas: depois de falha parcial a nova tentativa retoma o mesmo negócio e recusa retomada forjada', async () => {
    const org = organizacao('advertiser', 'retomada');
    const admin = membro('retadmin', org, 'admin');
    const conexaoId = dono(
      sqlDeConexao({ organizationId: org, platform: 'meta', label: `Meta retomada ${sufixo}`, externalId: `meta-ret-${sufixo}` }).sql,
    );
    const digitos = String(parseInt(sufixo, 16)).padStart(10, '7');
    const descoberta = (externo, nome) =>
      dono(
        `INSERT INTO integrations.connection_accounts (organization_id, connection_id, platform, external_id, name, state)
         VALUES ('${org}', '${conexaoId}', 'meta', '${externo}', '${nome}', 'discovered') RETURNING id`,
      );
    const valida = descoberta(`act_${digitos}1`, `Válida ${sufixo}`);
    const quebrada = descoberta(`act_1${sufixo.length}`, `Quebrada ${sufixo}`);
    const ignorada = descoberta(`act_${digitos}9`, `Ignorada ${sufixo}`);
    const estado = (id) => dono(`SELECT state::text FROM integrations.connection_accounts WHERE id = '${id}'`);
    const negociosDaOrg = () => dono(`SELECT count(*) FROM core.clients WHERE organization_id = '${org}'`);
    const destino = (r) => new URL(r.location ?? r.redirectedTo ?? '/', BASE);

    signIn(admin);
    const acao = await acaoComCampo('/comecar/contas', 'clientName');
    const parcial = await submitAction('/comecar/contas', acao, { selecionadas: [valida, quebrada], clientName: `Retomada ${sufixo}` });
    const aposFalha = destino(parcial);
    assert.ok(aposFalha.searchParams.get('erro'), 'falha parcial volta com erro');
    const token = aposFalha.searchParams.get('retomar');
    assert.ok(token, 'falha parcial devolve a retomada assinada');
    assert.equal(negociosDaOrg(), '1');
    const criado = dono(`SELECT id FROM core.clients WHERE organization_id = '${org}' AND name = 'Retomada ${sufixo}'`);
    assert.equal(estado(valida), 'linked');
    assert.equal(estado(quebrada), 'discovered');
    assert.equal(estado(ignorada), 'discovered', 'falha não marca conta como ignorada');

    const assinar = (corpo) => {
      const segredo = env().TRIA_SESSION_SECRET;
      const chave = createHmac('sha256', segredo).update('orla.retomada-do-cadastro:v1').digest();
      const texto = JSON.stringify(corpo);
      return `${Buffer.from(texto).toString('base64url')}.${createHmac('sha256', chave).update(texto).digest('base64url')}`;
    };
    const prazo = Date.now() + 600_000;
    const forjadas = [
      assinar({ o: org, u: admin, c: orgs.cliente, e: prazo }),
      assinar({ o: orgs.agencia, u: admin, c: orgs.cliente, e: prazo }),
      assinar({ o: org, u: pessoas.dono, c: criado, e: prazo }),
      assinar({ o: org, u: admin, c: criado, e: Date.now() - 1000 }),
      criado,
    ];
    for (const forjada of forjadas) {
      const recusada = await submitAction('/comecar/contas', acao, { selecionadas: [quebrada], retomada: forjada });
      assert.ok(destino(recusada).searchParams.get('erro'), 'retomada forjada é recusada');
    }
    assert.equal(dono(`SELECT count(*) FROM integrations.ad_accounts WHERE client_id = '${orgs.cliente}'`), '0', 'nada vai para negócio de outra organização');
    assert.equal(estado(quebrada), 'discovered');
    assert.equal(negociosDaOrg(), '1');

    const tela = await html(`/comecar/contas?retomar=${encodeURIComponent(token)}`);
    assert.ok(tela.texto.includes('name="retomada"'), 'a tela leva a retomada no formulário');
    assert.ok(tela.texto.includes(`Retomada ${sufixo}`));

    dono(`UPDATE integrations.connection_accounts SET external_id = 'act_${digitos}2' WHERE id = '${quebrada}'`);
    const retomada = await submitAction('/comecar/contas', acao, { selecionadas: [quebrada], retomada: token });
    assert.ok(!destino(retomada).searchParams.get('erro'), `a retomada conclui: ${destino(retomada)}`);
    assert.equal(negociosDaOrg(), '1', 'a retomada não cria outro negócio');
    assert.equal(dono(`SELECT count(*) FROM integrations.ad_accounts WHERE organization_id = '${org}' AND client_id = '${criado}'`), '2');
    assert.equal(estado(quebrada), 'linked');
    assert.equal(estado(ignorada), 'ignored', 'só depois de tudo vinculado a não escolhida vira ignorada');
  });
});
