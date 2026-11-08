import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, browse, ensureUser, get, makeOwner, post, signIn, submitForm } from './helpers.mjs';

const query = (sql) =>
  execFileSync('docker', ['exec', 'tria-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-tAc', sql])
    .toString()
    .trim();

const reset = () =>
  query(
    'TRUNCATE metrics.metrics_restatements, metrics.metrics_daily, automation.sync_runs, integrations.connection_accounts, integrations.ad_accounts, integrations.connections, core.clients, audit.audit_log, core.organizations RESTART IDENTITY CASCADE',
  );

describe('cadastro de cliente e contas', { concurrency: false }, () => {
  let clientId = '';
  let accountId = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    reset();
    signIn(ensureUser());
  });

  it('a raiz leva ao assistente de início', async () => {
    const response = await browse(`/`);
    assert.equal(response.status, 307);
    assert.match(response.headers.get('location') ?? '', /\/comecar/);
  });

  it('oferece caminhos distintos, descritos por quem opera o quê', async () => {
    const html = await browse(`/organizacoes/nova`).then((r) => r.text());
    assert.match(html, /tipo=agency/);
    assert.match(html, /tipo=advertiser/);
    assert.match(html, /Opero contas de clientes/);
    assert.match(html, /Opero as contas da minha empresa/);
    assert.ok(!html.includes('$ACTION_ID_'), 'a escolha não deve ter formulário');
  });

  it('nenhuma tela de cadastro pede estrutura como pré-requisito', async () => {
    const telas = ['/organizacoes/nova', '/organizacoes/nova?tipo=agency', '/organizacoes/nova?tipo=advertiser'];
    const obsoletos = [/developer token/i, /é só informar/i, /conta administradora gratuita/i];

    for (const tela of telas) {
      const html = await browse(`${tela}`).then((r) => r.text());
      for (const padrao of obsoletos) {
        assert.ok(!padrao.test(html), `${tela} ainda traz ${padrao}`);
      }
    }
  });

  it('o formulário da agência pede só o nome, com estrutura opcional', async () => {
    const html = await browse(`/organizacoes/nova?tipo=agency`).then((r) => r.text());
    assert.match(html, /Nome da agência/);
    assert.match(html, /Já tenho conta administradora ou Business Manager/);
    assert.ok(!/name="developerTokenRef"/.test(html), 'não deve mais coletar referência de token');
  });

  it('o formulário da empresa diz que nada precisa estar pronto', async () => {
    const html = await browse(`/organizacoes/nova?tipo=advertiser`).then((r) => r.text());
    assert.match(html, /Nome da empresa/);
    assert.match(html, /Nada precisa estar pronto/);
    assert.match(html, /conecta direto/);
  });

  it('cria a organização', async () => {
    const result = await submitForm('/organizacoes/nova?tipo=agency', {
      type: 'agency',
      name: 'Operação de Teste',
      managerAccountId: '812-445-9031',
      businessManagerId: '1094887233',
    });
    assert.equal(result.status, 303);
    assert.match(result.location ?? '', /\/comecar\?passo=conectar/);
    assert.equal(query('select count(*) from core.organizations'), '1');
  });

  it('bloqueia uma segunda organização enquanto não há login', async () => {
    const page = await browse(`/organizacoes/nova?tipo=agency`);
    assert.equal(page.status, 307);
    assert.equal(page.headers.get('location'), '/clientes');
    assert.equal(query('select count(*) from core.organizations'), '1');
  });

  it('o assistente para de aparecer depois da organização criada', async () => {
    const page = await browse(`/comecar`);
    assert.equal(page.headers.get('location'), '/clientes');
  });

  it('cria o cliente', async () => {
    const result = await submitForm('/clientes/novo', {
      name: 'Cliente de Teste',
      segment: 'Serviços locais',
      businessModel: 'leads',
      parentClientId: '',
    });
    assert.equal(result.status, 303);
    clientId = (result.location ?? '').split('/').pop() ?? '';
    assert.match(clientId, /^[a-f0-9-]{36}$/);
  });

  it('recusa cliente com nome repetido', async () => {
    const result = await submitForm('/clientes/novo', {
      name: 'Cliente de Teste',
      segment: '',
      businessModel: 'leads',
      parentClientId: '',
    });
    assert.match(result.location ?? '', /erro=/);
    assert.equal(query('select count(*) from core.clients'), '1');
  });

  it('cria filial apontando para a rede', async () => {
    const result = await submitForm('/clientes/novo', {
      name: 'Filial de Teste',
      segment: '',
      businessModel: 'leads',
      parentClientId: clientId,
    });
    assert.equal(result.status, 303);
    assert.equal(query(`select count(*) from core.clients where parent_client_id = '${clientId}'`), '1');
  });

  it('recusa hierarquia de dois níveis', async () => {
    const branchId = query(
      `select id from core.clients where parent_client_id = '${clientId}' limit 1`,
    );
    const result = await submitForm('/clientes/novo', {
      name: 'Neta de Teste',
      segment: '',
      businessModel: 'leads',
      parentClientId: branchId,
    });
    assert.match(result.location ?? '', /erro=/);
    assert.equal(query('select count(*) from core.clients'), '2');
  });

  it('vincula a conta de anúncios criando a autorização', async () => {
    const result = await submitForm(`/clientes/${clientId}/contas/nova`, {
      clientId,
      platform: 'meta',
      connectionId: 'new',
      connectionLabel: 'Business Manager de teste',
      grantType: 'system_user',
      connectionExternalId: '1094887233',
      credentialRef: 'n8n:credential:meta',
      scopes: ['ads_read', 'ads_management'],
      externalId: '1234567890',
      name: 'Meta — Cliente de Teste',
      accountGroup: 'Principal',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      syncEnabled: 'on',
    });
    assert.equal(result.status, 303);
    accountId = query('select id from integrations.ad_accounts limit 1');
    assert.equal(query("select external_id from integrations.ad_accounts"), 'act_1234567890');
  });

  it('recusa a mesma conta duas vezes', async () => {
    const result = await submitForm(`/clientes/${clientId}/contas/nova`, {
      clientId,
      platform: 'meta',
      connectionId: query('select id from integrations.connections limit 1'),
      externalId: 'act_1234567890',
      name: 'Duplicada',
      accountGroup: 'Principal',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      syncEnabled: 'on',
    });
    assert.match(result.location ?? '', /erro=/);
    assert.equal(query('select count(*) from integrations.ad_accounts'), '1');
  });

  it('recusa id de conta no formato da outra plataforma', async () => {
    const result = await submitForm(`/clientes/${clientId}/contas/nova`, {
      clientId,
      platform: 'google',
      connectionId: query('select id from integrations.connections limit 1'),
      externalId: '123-456-7890',
      name: 'Plataforma trocada',
      accountGroup: 'Principal',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      syncEnabled: 'on',
    });
    assert.match(result.location ?? '', /erro=/);
    assert.equal(query('select count(*) from integrations.ad_accounts'), '1');
  });

  it('a conta entra na fila de coleta com janela de rejanela e sem segredo', async () => {
    const queue = await get('/api/v0/sync/queue').then((r) => r.json());
    assert.equal(queue.count, 1);

    const entry = queue.accounts[0];
    assert.equal(entry.adAccountId, accountId);
    assert.ok(entry.credentialRef.startsWith('n8n:'));

    const serialized = JSON.stringify(entry).toLowerCase();
    for (const forbidden of ['"token"', 'secret', 'password', 'bearer']) {
      assert.ok(!serialized.includes(forbidden), `vazou ${forbidden}`);
    }

    const days = (Date.parse(entry.window.end) - Date.parse(entry.window.start)) / 86_400_000;
    assert.equal(days, 28);
  });

  it('registra a trilha de auditoria do cadastro', async () => {
    const actions = query(
      "select string_agg(distinct action, ',' order by action) from audit.audit_log where actor_type = 'user'",
    );
    assert.equal(actions, 'ad_account.link,client.create,connection.create,identity.became_owner,organization.create');
  });

  it('não grava segredo na auditoria', async () => {
    const metadata = query('select string_agg(metadata::text, Chr(10)) from audit.audit_log');
    assert.ok(!metadata.includes('n8n:credential:meta'), 'credentialRef não deve aparecer em claro');
  });
});
