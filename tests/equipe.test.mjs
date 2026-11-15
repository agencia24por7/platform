import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import {
  BASE,
  acaoComCampo,
  appIsUp,
  browse,
  ensureUser,
  sessionCookie,
  signIn,
  signOut,
  submitAction,
} from './helpers.mjs';

function senhaDoApp() {
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith('APP_DB_PASSWORD='))
    .slice('APP_DB_PASSWORD='.length);
}

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  }).trim();

const comoApp = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoApp()}`, 'orla-postgres',
     'psql', '-U', 'orla_app', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

const naSessao = (organizationId, clientIds, sql) =>
  comoApp(
    `SET app.organization_id = '${organizationId}'; SET app.client_ids = '${clientIds}'; ${sql}`,
  );

const umaLinha = (texto) => texto.split('\n')[0].trim();

describe('equipe, convites e recorte por cliente', { concurrency: false }, () => {
  let org = '';
  let outraOrg = '';
  let clienteA = '';
  let clienteB = '';
  let dona = '';
  let convidada = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');

    dono(
      `TRUNCATE core.member_clients, core.invitations, metrics.metrics_restatements, metrics.metrics_daily,
               automation.account_tasks, automation.sync_runs, integrations.connection_accounts,
               integrations.ad_accounts, integrations.connections, core.clients, audit.audit_log,
               core.members, core.organizations RESTART IDENTITY CASCADE`,
    );

    org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Agência Teste', 'agencia-teste', 'agency') RETURNING id`,
    ));
    outraOrg = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Outra Casa', 'outra-casa', 'agency') RETURNING id`,
    ));
    clienteA = umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', 'Cliente A', 'leads') RETURNING id`,
    ));
    clienteB = umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', 'Cliente B', 'leads') RETURNING id`,
    ));

    dona = ensureUser('dona@tria.local');
    convidada = ensureUser('convidada@tria.local');
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${dona}', 'owner')
          ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner', revoked_at = NULL`);
  });

  it('o convite nasce com o recorte e o aceite já entrega o acesso restrito', () => {
    const convite = umaLinha(dono(
      `INSERT INTO core.invitations (organization_id, email, role, invited_by, expires_at, client_ids)
       VALUES ('${org}', 'convidada@tria.local', 'viewer', '${dona}', now() + interval '7 days',
               ARRAY['${clienteA}']::uuid[])
       RETURNING id`,
    ));

    const pendentes = umaLinha(dono(
      `SELECT count(*) FROM core.pending_invitations_for('convidada@tria.local')`,
    ));
    assert.equal(pendentes, '1');

    assert.equal(umaLinha(dono(`SELECT core.accept_invitation('${convite}', '${convidada}')`)), 't');

    const papel = umaLinha(dono(
      `SELECT role::text FROM core.members WHERE organization_id = '${org}' AND user_id = '${convidada}'`,
    ));
    assert.equal(papel, 'viewer');

    const recorte = dono(
      `SELECT c.name FROM core.member_clients mc
         JOIN core.members m ON m.id = mc.member_id
         JOIN core.clients c ON c.id = mc.client_id
        WHERE m.user_id = '${convidada}' AND mc.revoked_at IS NULL`,
    );
    assert.equal(umaLinha(recorte), 'Cliente A');
  });

  it('conhecer o identificador do convite não basta: o e-mail tem de bater', () => {
    const intrusa = ensureUser('intrusa@tria.local');
    const convite = umaLinha(dono(
      `INSERT INTO core.invitations (organization_id, email, role, invited_by, expires_at)
       VALUES ('${org}', 'outra.pessoa@tria.local', 'viewer', '${dona}', now() + interval '7 days')
       RETURNING id`,
    ));

    assert.equal(umaLinha(dono(`SELECT core.accept_invitation('${convite}', '${intrusa}')`)), 'f');
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM core.members WHERE user_id = '${intrusa}'`)),
      '0',
      'o convite de outra pessoa não podia virar vínculo',
    );
  });

  it('o mesmo convite não é aceito duas vezes', () => {
    const convite = umaLinha(dono(
      `SELECT id FROM core.invitations WHERE organization_id = '${org}' AND accepted_at IS NOT NULL LIMIT 1`,
    ));
    assert.equal(umaLinha(dono(`SELECT core.accept_invitation('${convite}', '${convidada}')`)), 'f');
  });

  it('o recorte resolvido é o que o banco aplica', () => {
    const escopo = umaLinha(dono(`SELECT core.client_scope_of('${convidada}', '${org}')`));
    assert.ok(escopo.includes(clienteA), `esperava o cliente A no recorte, veio ${escopo}`);
    assert.ok(!escopo.includes(clienteB), 'o cliente B não podia estar no recorte');

    assert.equal(umaLinha(dono(`SELECT core.client_scope_of('${dona}', '${org}')`)), '');
  });

  it('com recorte, a sessão enxerga só o cliente do recorte', () => {
    const comRecorte = naSessao(org, clienteA, 'SELECT count(*) FROM core.clients');
    assert.equal(umaLinha(comRecorte), '1');

    const inteira = naSessao(org, '*', 'SELECT count(*) FROM core.clients');
    assert.equal(umaLinha(inteira), '2');
  });

  it('com recorte, a equipe, as conexões e a trilha ficam fora de alcance', () => {
    assert.equal(umaLinha(naSessao(org, clienteA, 'SELECT count(*) FROM core.members')), '0');
    assert.equal(umaLinha(naSessao(org, clienteA, 'SELECT count(*) FROM integrations.connections')), '0');
    assert.equal(umaLinha(naSessao(org, clienteA, 'SELECT count(*) FROM core.invitations')), '0');
    assert.equal(umaLinha(naSessao(org, clienteA, 'SELECT count(*) FROM audit.audit_log')), '0');

    assert.equal(umaLinha(naSessao(org, '*', 'SELECT count(*) FROM core.members')), '2');
  });

  it('o recorte não atravessa a fronteira da organização', () => {
    assert.equal(umaLinha(naSessao(outraOrg, clienteA, 'SELECT count(*) FROM core.clients')), '0');
    assert.equal(umaLinha(naSessao(outraOrg, '*', 'SELECT count(*) FROM core.clients')), '0');
  });

  it('a sessão recortada não cria cliente fora do recorte', () => {
    const erro = (() => {
      try {
        naSessao(
          org,
          clienteA,
          `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', 'Cliente C', 'leads')`,
        );
        return null;
      } catch (falha) {
        return String(falha.stderr ?? falha.message);
      }
    })();

    assert.ok(erro, 'a inserção devia ter sido recusada pela política');
    assert.ok(/row-level security|política|policy/i.test(erro), erro);
  });

  it('revogar o vínculo tira a pessoa da lista de organizações', () => {
    const antes = umaLinha(dono(`SELECT count(*) FROM core.memberships_of('${convidada}')`));
    assert.equal(antes, '1');

    dono(`UPDATE core.members SET revoked_at = now(), revoked_by = '${dona}'
          WHERE organization_id = '${org}' AND user_id = '${convidada}'`);

    assert.equal(umaLinha(dono(`SELECT count(*) FROM core.memberships_of('${convidada}')`)), '0');
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM core.members WHERE user_id = '${convidada}'`)),
      '1',
      'o vínculo revogado continua escrito',
    );
  });

  it('quem foi revogado não entra mais no app', async () => {
    signIn(convidada);
    const resposta = await browse('/clientes');
    assert.ok(
      [302, 303, 307].includes(resposta.status),
      `esperava redirecionamento para fora, veio ${resposta.status}`,
    );
    assert.match(resposta.headers.get('location') ?? '', /organizacoes\/nova|entrar/);
    signOut();
  });

  it('pausar o cliente tira as contas dele da fila de coleta', () => {
    const conexao = umaLinha(dono(
      `INSERT INTO integrations.connections (organization_id, platform, grant_type, label, external_id, scopes, credential_ref)
       VALUES ('${org}', 'google', 'mcc', 'MCC teste', '111-222-3333',
               ARRAY['https://www.googleapis.com/auth/adwords'], 'cred-teste')
       RETURNING id`,
    ));
    const conta = umaLinha(dono(
      `INSERT INTO integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
       VALUES ('${org}', '${clienteA}', '${conexao}', 'google', '444-555-6666', 'Conta do A')
       RETURNING id`,
    ));

    const naFila = () =>
      umaLinha(dono(`SELECT count(*) FROM automation.sync_queue(50, 28, interval '0 seconds')
                     WHERE ad_account_id = '${conta}'`));

    assert.equal(naFila(), '1');

    dono(`UPDATE core.clients SET status = 'paused' WHERE id = '${clienteA}'`);
    assert.equal(naFila(), '0', 'cliente pausado não devia produzir trabalho');

    assert.equal(
      umaLinha(dono(`SELECT client_status FROM automation.resolve_account_organization('${conta}')`)),
      'paused',
    );

    dono(`UPDATE core.clients SET status = 'archived' WHERE id = '${clienteA}'`);
    assert.equal(naFila(), '0', 'cliente arquivado não devia produzir trabalho');

    dono(`UPDATE core.clients SET status = 'active' WHERE id = '${clienteA}'`);
    assert.equal(naFila(), '1', 'reativar devolve o cliente à fila');
  });

  it('a conta muda de cliente sem perder o histórico', () => {
    const conta = umaLinha(dono(
      `SELECT id FROM integrations.ad_accounts WHERE organization_id = '${org}' LIMIT 1`,
    ));
    const antes = umaLinha(dono(`SELECT count(*) FROM automation.sync_runs WHERE ad_account_id = '${conta}'`));

    dono(`UPDATE integrations.ad_accounts SET client_id = '${clienteB}' WHERE id = '${conta}'`);

    assert.equal(
      umaLinha(dono(`SELECT client_id FROM integrations.ad_accounts WHERE id = '${conta}'`)),
      clienteB,
    );
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM automation.sync_runs WHERE ad_account_id = '${conta}'`)),
      antes,
      'as coletas continuam apontando para a mesma conta',
    );
  });

  it('o app não tem como apagar vínculo, convite nem recorte', () => {
    for (const tabela of ['core.members', 'core.invitations', 'core.member_clients']) {
      const permitido = umaLinha(dono(
        `SELECT has_table_privilege('orla_app', '${tabela}', 'DELETE')`,
      ));
      assert.equal(permitido, 'f', `${tabela} não podia aceitar DELETE do app`);
    }
  });
});

describe('a equipe pela tela', { concurrency: false }, () => {
  let org = '';
  let cliente = '';
  let dona = '';
  let nova = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');

    dono(
      `TRUNCATE core.member_clients, core.invitations, metrics.metrics_restatements, metrics.metrics_daily,
               automation.account_tasks, automation.sync_runs, integrations.connection_accounts,
               integrations.ad_accounts, integrations.connections, core.clients, audit.audit_log,
               core.members, core.organizations RESTART IDENTITY CASCADE`,
    );

    org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Casa Teste', 'casa-teste', 'agency') RETURNING id`,
    ));
    cliente = umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', 'Padaria', 'leads') RETURNING id`,
    ));
    dona = ensureUser('dona2@tria.local');
    nova = ensureUser('nova@tria.local');
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${dona}', 'owner')
          ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner', revoked_at = NULL`);
    signIn(dona);
  });

  it('quem administra abre a tela de equipe', async () => {
    const resposta = await browse('/config');
    assert.equal(resposta.status, 200);
    const html = await resposta.text();
    assert.match(html, /Configurações/);
    assert.match(html, /Vínculos/);
  });

  it('o convite sai pela tela, com recorte, e fica na trilha', async () => {
    const convidar = await acaoComCampo('/config', 'email');
    const resultado = await submitAction('/config', convidar, {
      email: 'nova@tria.local',
      role: 'viewer',
      clientIds: [cliente],
    });

    assert.ok([200, 303].includes(resultado.status), `status inesperado: ${resultado.status}`);

    const convite = dono(
      `SELECT role::text || '|' || array_length(client_ids, 1)::text
         FROM core.invitations
        WHERE organization_id = '${org}' AND lower(email) = 'nova@tria.local'
          AND accepted_at IS NULL AND revoked_at IS NULL`,
    );
    assert.equal(umaLinha(convite), 'viewer|1');

    const trilha = umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log
        WHERE organization_id = '${org}' AND action = 'team.invited' AND actor_id = '${dona}'`,
    ));
    assert.equal(trilha, '1', 'o convite tinha de aparecer na auditoria com o autor');
  });

  it('o mesmo e-mail não recebe dois convites abertos', async () => {
    const convidar = await acaoComCampo('/config', 'email');
    await submitAction('/config', convidar, { email: 'nova@tria.local', role: 'viewer' });

    const abertos = umaLinha(dono(
      `SELECT count(*) FROM core.invitations
        WHERE organization_id = '${org}' AND lower(email) = 'nova@tria.local'
          AND accepted_at IS NULL AND revoked_at IS NULL`,
    ));
    assert.equal(abertos, '1');
  });

  it('quem entra com o e-mail convidado recebe o vínculo já recortado', async () => {
    signIn(nova);
    const resposta = await browse('/clientes');
    assert.equal(resposta.status, 200, 'a pessoa convidada devia entrar direto');

    const papel = umaLinha(dono(
      `SELECT role::text FROM core.members WHERE organization_id = '${org}' AND user_id = '${nova}'`,
    ));
    assert.equal(papel, 'viewer');

    const recorte = umaLinha(dono(
      `SELECT count(*) FROM core.member_clients mc
         JOIN core.members m ON m.id = mc.member_id
        WHERE m.user_id = '${nova}' AND mc.revoked_at IS NULL`,
    ));
    assert.equal(recorte, '1');

    const entrada = umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log
        WHERE organization_id = '${org}' AND action = 'team.joined' AND actor_id = '${nova}'`,
    ));
    assert.equal(entrada, '1');
  });

  it('o acesso recortado abre as configurações só com o próprio perfil', async () => {
    signIn(nova);
    const html = await (await browse('/config')).text();
    assert.match(html, /acesso restrito/i);
    assert.ok(!html.includes('Vínculos'), 'o recorte não devia enxergar a equipe');
    assert.ok(!html.includes('Como esta organização trabalha'), 'o recorte não muda a organização');
  });

  it('o acesso recortado não alcança conexões nem auditoria', async () => {
    signIn(nova);
    for (const rota of ['/integracoes', '/auditoria']) {
      const resposta = await browse(rota);
      assert.ok(
        [302, 303, 307].includes(resposta.status),
        `${rota} devia desviar um acesso recortado, veio ${resposta.status}`,
      );
      assert.match(resposta.headers.get('location') ?? '', /\/clientes/);
    }
  });

  it('o acesso recortado enxerga só o cliente dele', async () => {
    dono(`INSERT INTO core.clients (organization_id, name, business_model)
          VALUES ('${org}', 'Outro Cliente', 'leads') ON CONFLICT DO NOTHING`);

    signIn(nova);
    const html = await (await browse('/clientes')).text();
    assert.match(html, /Padaria/);
    assert.ok(!html.includes('Outro Cliente'), 'o cliente de fora do recorte vazou para a tela');

    signIn(dona);
    const completo = await (await browse('/clientes')).text();
    assert.match(completo, /Outro Cliente/);
  });

  it('quem não administra abre as configurações sem a seção de equipe', async () => {
    const operadora = ensureUser('operadora@tria.local');
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${operadora}', 'operator')
          ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'operator', revoked_at = NULL`);

    signIn(operadora);
    const html = await (await browse('/config')).text();
    assert.match(html, /Configurações/);
    assert.ok(!html.includes('Convites abertos'), 'quem opera não devia ver convites');
    assert.ok(!html.includes('Convidar'), 'quem opera não devia ver o formulário de convite');
    signIn(dona);
  });

  it('sessão recortada não vincula conta, mesmo forjando o envio', async () => {
    const operadoraRecortada = ensureUser('recortada@tria.local');
    const membro = umaLinha(dono(
      `INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${operadoraRecortada}', 'operator')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'operator', revoked_at = NULL
       RETURNING id`,
    ));
    dono(`INSERT INTO core.member_clients (member_id, client_id) VALUES ('${membro}', '${cliente}')
          ON CONFLICT (member_id, client_id) DO UPDATE SET revoked_at = NULL`);

    signIn(dona);
    const vincular = await acaoComCampo('/integracoes/conector/google', 'contaId').catch(() => null);

    const antes = umaLinha(dono(`SELECT count(*) FROM integrations.ad_accounts WHERE organization_id = '${org}'`));

    signIn(operadoraRecortada);
    const resposta = await browse('/integracoes');
    assert.ok(
      [302, 303, 307].includes(resposta.status),
      'a tela de conexões não pode abrir para quem entra recortado',
    );

    if (vincular) {
      await submitAction('/integracoes/conector/google', vincular, { contaId: 'qualquer', clientId: cliente });
    }

    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM integrations.ad_accounts WHERE organization_id = '${org}'`)),
      antes,
      'uma sessão recortada não pode vincular conta nem chamando a ação direto',
    );
    signIn(dona);
  });

  it('trocar de organização só vale para um vínculo real', async () => {
    const outra = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Alheia', 'alheia', 'agency') RETURNING id`,
    ));

    signIn(dona);
    const body = new FormData();
    body.set('organizationId', outra);
    body.set('voltarPara', '/clientes');

    const resposta = await fetch(`${BASE}/api/organizacao`, {
      method: 'POST',
      headers: { Cookie: sessionCookie(dona), Origin: BASE },
      body,
      redirect: 'manual',
    });

    assert.equal(resposta.status, 303);
    const cookies = resposta.headers.getSetCookie?.() ?? [];
    assert.ok(
      !cookies.some((valor) => valor.includes(outra)),
      'a troca para uma organização sem vínculo não podia gravar cookie',
    );
  });
});
