import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, describe, it } from 'node:test';
import {
  BASE,
  acaoComCampo,
  appIsUp,
  browse,
  ensureUser,
  handoffToken,
  makeOwner,
  sessionCookie,
  signIn,
  submitAction,
  submitForm,
  signOut,
} from './helpers.mjs';

const query = (sql) =>
  execFileSync('docker', ['exec', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql])
    .toString()
    .trim()
    .split('\n')[0]
    .trim();

const PROTEGIDAS = ['/clientes', '/integracoes', '/automacoes', '/comecar', '/clientes/novo'];

describe('porta de entrada', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
  });

  it('visitante sem sessão vai direto para o login do Google', async () => {
    signOut();
    for (const rota of PROTEGIDAS) {
      const response = await browse(rota);
      assert.equal(response.status, 307, `${rota} deveria redirecionar`);
      assert.match(
        response.headers.get('location') ?? '',
        /\/api\/auth\/google\/start/,
        `${rota} deveria ir direto para o login do Google`,
      );
    }
  });

  it('o login sem credencial configurada cai na entrada com o motivo', async () => {
    signOut();
    const response = await browse('/api/auth/google/start');
    const destino = response.headers.get('location') ?? '';
    assert.ok(
      destino.includes('accounts.google.com') || destino.includes('/entrar?erro=indisponivel'),
      `destino inesperado: ${destino}`,
    );
  });

  it('a entrada fica aberta e oferece o Google', async () => {
    signOut();
    const response = await browse('/entrar');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Entrar com Google|credencial de login/);
  });

  it('a saúde continua aberta para o monitoramento', async () => {
    signOut();
    const response = await browse('/api/health');
    assert.equal(response.status, 200);
  });

  it('sessão forjada com outro segredo é recusada', async () => {
    signOut();
    const falsa = 'tria_sessao=ZmFsc28.assinaturaforjada';
    const response = await fetch(`${BASE}/clientes`, { headers: { Cookie: falsa }, redirect: 'manual' });
    assert.notEqual(response.status, 200);
  });
});

describe('isolamento entre organizações', { concurrency: false }, () => {
  let organizacaoA = '';
  let usuarioB = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    query(
      'TRUNCATE core.members, integrations.connection_accounts, integrations.ad_accounts, integrations.connections, core.clients, audit.audit_log, core.organizations RESTART IDENTITY CASCADE',
    );

    organizacaoA = query(
      "INSERT INTO core.organizations (name, slug, type) VALUES ('Agência A', 'agencia-a', 'agency') RETURNING id",
    );
    const usuarioA = ensureUser('a@tria.local');
    makeOwner(usuarioA, organizacaoA);

    usuarioB = ensureUser('b@tria.local');
  });

  it('usuário sem vínculo não enxerga a organização alheia', async () => {
    signIn(usuarioB);
    const response = await browse('/clientes');
    assert.notEqual(response.status, 200);
    assert.match(response.headers.get('location') ?? '', /\/organizacoes\/nova|\/entrar/);
  });

  it('usuário vinculado enxerga a própria organização', async () => {
    signIn(ensureUser('a@tria.local'));
    const response = await browse('/clientes');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Agência A/);
  });

  it('o vínculo de dono é único por organização', async () => {
    const total = query(
      `SELECT count(*) FROM core.members WHERE organization_id = '${organizacaoA}' AND role = 'owner'`,
    );
    assert.equal(total, '1');
  });
});

describe('passagem para a automação', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
  });

  it('a troca da passagem é recusada na segunda vez', async () => {
    const usuario = ensureUser('portaria@tria.local');
    const passagem = handoffToken(usuario);

    const primeira = await fetch(`${BASE}/api/portaria/receber?t=${encodeURIComponent(passagem)}`, {
      redirect: 'manual',
    });
    const segunda = await fetch(`${BASE}/api/portaria/receber?t=${encodeURIComponent(passagem)}`, {
      redirect: 'manual',
    });

    const emitiuCookie = (resposta) => (resposta.headers.get('set-cookie') ?? '').includes('tria_portaria=ey');

    assert.ok(emitiuCookie(primeira), 'a primeira troca deveria emitir o cookie');
    assert.ok(!emitiuCookie(segunda), 'a segunda troca não pode emitir cookie');
    assert.match(segunda.headers.get('location') ?? '', /\/entrar/);
  });

  it('a passagem some do banco depois de gasta apenas quando expira', async () => {
    const gastas = Number(query('select count(*) from core.handoff_consumed'));
    assert.ok(gastas >= 1, 'a passagem gasta precisa ficar registrada');
  });
});

describe('acesso à automação por papel', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
  });

  it('quem não administra não recebe a sessão do n8n', async () => {
    const organizacao = query('select id from core.organizations limit 1');
    const leitor = ensureUser('leitor@tria.local');

    query(
      `INSERT INTO core.members (organization_id, user_id, role)
       VALUES ('${organizacao}', '${leitor}', 'viewer')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'viewer'`,
    );

    signIn(leitor);
    const resposta = await browse('/api/portaria/emitir');
    const destino = resposta.headers.get('location') ?? '';

    assert.ok(!destino.includes('/api/portaria/receber'), 'leitor não pode receber passagem');
    assert.match(destino, /n8n_sem_permissao/);
  });

  it('quem administra recebe a passagem', async () => {
    const organizacao = query('select id from core.organizations limit 1');
    const administrador = ensureUser('admin@tria.local');

    query(
      `INSERT INTO core.members (organization_id, user_id, role)
       VALUES ('${organizacao}', '${administrador}', 'admin')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'admin'`,
    );

    signIn(administrador);
    const resposta = await browse('/api/portaria/emitir');
    const destino = resposta.headers.get('location') ?? '';

    assert.match(destino, /\/api\/portaria\/receber/);
  });
});

describe('a ponte para o n8n não pode virar laço', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
  });

  it('sem credencial do n8n, a troca marca a pausa em vez de insistir', async () => {
    const usuario = ensureUser('laco@tria.local');
    const passagem = handoffToken(usuario);

    const resposta = await fetch(`${BASE}/api/portaria/receber?t=${encodeURIComponent(passagem)}`, {
      redirect: 'manual',
    });

    const cookies = resposta.headers.get('set-cookie') ?? '';
    assert.match(cookies, /tria_portaria=/, 'a passagem precisa virar sessão');
    assert.match(cookies, /tria_portaria_sem_n8n=/, 'a pausa precisa ser marcada');
  });

  it('com a pausa marcada, a guarda deixa passar em vez de redirecionar', async () => {
    const usuario = ensureUser('laco@tria.local');
    const sessao = sessionCookie(usuario);

    const resposta = await fetch(`${BASE}/api/portaria`, {
      headers: { Cookie: `tria_portaria=${sessao.split('=')[1]}; tria_portaria_sem_n8n=1` },
      redirect: 'manual',
    });

    assert.equal(resposta.status, 204, 'a guarda precisa liberar durante a pausa');
  });
});

describe('vínculos de conta exigem papel e não confiam no formulário', { concurrency: false }, () => {
  let organizacao = '';
  let conexao = '';
  let convite = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');

    organizacao = query(
      `INSERT INTO core.organizations (name, slug, type)
       VALUES ('Agência do teste de papel', 'papel-teste', 'agency')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    );

    conexao = query(
      `INSERT INTO integrations.connections
         (organization_id, platform, grant_type, label, external_id, scopes, credential_ref)
       VALUES ('${organizacao}', 'google', 'oauth_user', 'Teste de papel', 'papel-teste',
               ARRAY['adwords'], 'n8n:credential:teste')
       ON CONFLICT (organization_id, platform, external_id) DO UPDATE SET label = EXCLUDED.label
       RETURNING id`,
    );

    query(
      `INSERT INTO integrations.connection_accounts
         (organization_id, connection_id, platform, external_id, name)
       VALUES ('${organizacao}', '${conexao}', 'google', '111-111-1111', 'Conta convidada')
       ON CONFLICT (connection_id, external_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
    );

    convite = query(
      `INSERT INTO automation.account_tasks
         (organization_id, connection_id, kind, manager_external_id, target_external_id, status)
       VALUES ('${organizacao}', '${conexao}', 'mcc_invite', '602-780-1803', '111-111-1111', 'done')
       ON CONFLICT (connection_id, kind, target_external_id) DO UPDATE SET status = 'done'
       RETURNING id`,
    );
  });

  it('a tela de conexões não carrega a administradora em campo oculto', async () => {
    const dono = ensureUser('dono-papel@tria.local');
    makeOwner(dono, organizacao);
    signIn(dono);

    const html = await browse('/integracoes/conector/google').then((r) => r.text());

    assert.match(html, /name="conviteId"/, 'o convite precisa ser identificado por id');
    assert.ok(
      !html.includes('name="administradora"'),
      'a administradora não pode vir do formulário: permitiria vincular a uma MCC arbitrária',
    );
  });

  it('leitor não consegue pedir aceite, mesmo forjando o envio', async () => {
    const leitor = ensureUser('leitor-papel@tria.local');
    query(
      `INSERT INTO core.members (organization_id, user_id, role)
       VALUES ('${organizacao}', '${leitor}', 'viewer')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'viewer'`,
    );

    const antes = query("select count(*) from automation.account_tasks where kind = 'mcc_accept'");

    signIn(leitor);
    const dono = ensureUser('dono-papel@tria.local');
    makeOwner(dono, organizacao);
    signIn(dono);
    const aceitar = await acaoComCampo('/integracoes/conector/google', 'conviteId');
    signIn(leitor);
    await submitAction('/integracoes/conector/google', aceitar, { conexaoDaConta: conexao, conviteId: convite });

    const depois = query("select count(*) from automation.account_tasks where kind = 'mcc_accept'");
    assert.equal(depois, antes, 'leitor não pode enfileirar alteração de vínculo');
  });

  it('leitor não vincula conta por nenhum dos dois caminhos', async () => {
    const cliente = query(
      `INSERT INTO core.clients (organization_id, name, business_model)
       VALUES ('${organizacao}', 'Cliente do papel', 'leads')
       ON CONFLICT (organization_id, name) WHERE excluido_em IS NULL DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    const leitor = ensureUser('leitor-papel@tria.local');
    query(
      `INSERT INTO core.members (organization_id, user_id, role)
       VALUES ('${organizacao}', '${leitor}', 'viewer')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'viewer', revoked_at = NULL`,
    );

    const antes = query('select count(*) from integrations.ad_accounts');

    signIn(leitor);
    const pelaFicha = await acaoComCampo(`/clientes/${cliente}/contas/nova`, 'descobertaId').catch(() => null);
    if (pelaFicha) {
      const pendente = query(
        `select id from integrations.connection_accounts where organization_id = '${organizacao}' limit 1`,
      );
      await submitAction(`/clientes/${cliente}/contas/nova`, pelaFicha, {
        clientId: cliente,
        descobertaId: pendente,
        coletar: 'on',
      });
    }

    const peloPainel = await acaoComCampo('/integracoes/conector/google', 'contaId').catch(() => null);
    assert.equal(peloPainel, null, 'a tela de conexões nem devia abrir para o leitor chegar na ação');

    assert.equal(
      query('select count(*) from integrations.ad_accounts'),
      antes,
      'leitor não pode vincular conta',
    );
  });

  it('convite inexistente é recusado mesmo para quem administra', async () => {
    const dono = ensureUser('dono-papel@tria.local');
    makeOwner(dono, organizacao);
    signIn(dono);

    const antes = query("select count(*) from automation.account_tasks where kind = 'mcc_accept'");

    const aceitar = await acaoComCampo('/integracoes/conector/google', 'conviteId');
    await submitAction('/integracoes/conector/google', aceitar, {
      conexaoDaConta: conexao,
      conviteId: '00000000-0000-4000-8000-000000000999',
    });

    const depois = query("select count(*) from automation.account_tasks where kind = 'mcc_accept'");
    assert.equal(depois, antes, 'convite inexistente não pode virar aceite');
  });
});
