import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { BASE, appIsUp, ensureOperador, ensureUser, portariaToken, sessionCookie } from './helpers.mjs';
import { PG_CONTAINER } from './apoio/pgContainer.mjs';
import { FUNCOES_DEFINER_DO_APP, SQL_FUNCOES_DEFINER_DO_APP } from './apoio/funcoesDefinerDoApp.mjs';

function valorDoEnv(chave) {
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith(`${chave}=`))
    .slice(chave.length + 1);
}

const dono = (sql) => {
  try {
    return execFileSync('docker', ['exec', '-i', PG_CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (falha) {
    throw new Error(`psql como dono falhou: ${String(falha.stderr ?? '').trim()}`);
  }
};

const comoApp = (sql) => {
  try {
    return execFileSync(
      'docker',
      ['exec', '-i', '-e', `PGPASSWORD=${valorDoEnv('APP_DB_PASSWORD')}`, PG_CONTAINER,
       'psql', '-U', 'orla_app', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch (falha) {
    const erro = new Error(`psql como orla_app falhou: ${String(falha.stderr ?? '').trim()}`);
    erro.stderr = String(falha.stderr ?? '');
    throw erro;
  }
};

const comoWorker = (sql) => {
  try {
    return execFileSync(
      'docker',
      ['exec', '-i', '-e', `PGPASSWORD=${valorDoEnv('WORKER_DB_PASSWORD')}`, PG_CONTAINER,
       'psql', '-U', 'orla_worker', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  } catch (falha) {
    const erro = new Error(`psql como orla_worker falhou: ${String(falha.stderr ?? '').trim()}`);
    erro.stderr = String(falha.stderr ?? '');
    throw erro;
  }
};

const comoUsuario = (userId, sql) => comoApp(`SET app.user_id = '${userId}'; ${sql}`);

const naSessao = (org, clientIds, userId, sql) =>
  comoApp(
    `SET app.organization_id = '${org}'; SET app.client_ids = '${clientIds}'; ` +
      `SET app.user_id = '${userId}'; ${sql}`,
  );

const recusa = (fn) => {
  try {
    fn();
    return null;
  } catch (falha) {
    return String(falha.stderr ?? falha.message);
  }
};

const rotulo = randomUUID().slice(0, 8);
const ids = () => randomUUID();
const codigoDeExclusao = () => `F5R${rotulo.toUpperCase()}${randomUUID().replaceAll('-', '').toUpperCase()}`.slice(0, 40);
const hex64 = () => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
const digitos = () => String(Date.now()) + String(Math.floor(Math.random() * 1e6));

const escopoEfetivo = (userId, orgId) => {
  return comoApp(
    `SET app.user_id = '${userId}'; SELECT CASE WHEN e IS NULL THEN '*' WHEN cardinality(e) = 0 THEN 'nenhum' ELSE array_to_string(e, ',') END
       FROM (SELECT core.client_scope_of('${userId}', '${orgId}') AS e) x`,
  );
};

describe('fase 5: regressão dos achados de tenant', { concurrency: false }, () => {
  const orgA = ids();
  const orgB = ids();
  const orgVazia = ids();
  const cA1 = ids();
  const cA2 = ids();
  const cB1 = ids();
  const nomeA1 = `F5R Visivel ${rotulo}`;
  const nomeA2 = `F5R Oculto ${rotulo}`;
  const connB = ids();
  const externoB = digitos();
  const emails = [];
  let uA = '';
  let uB = '';
  let uArecortado = '';
  let mArecortado = '';

  const novoUsuario = (prefixo) => {
    const email = `f5r-${prefixo}-${rotulo}-${ids().slice(0, 4)}@tria.local`;
    emails.push(email);
    return { id: ensureUser(email), email };
  };

  const novoMembroRecortado = (org, clientes) => {
    const { id } = novoUsuario('rec');
    const membro = ids();
    dono(`INSERT INTO core.members (id, organization_id, user_id, role) VALUES ('${membro}', '${org}', '${id}', 'viewer')`);
    for (const cliente of clientes) {
      dono(`INSERT INTO core.member_clients (member_id, client_id) VALUES ('${membro}', '${cliente}')`);
    }
    return { userId: id, memberId: membro };
  };

  const novoCliente = (org, nome = `F5R Cliente ${ids().slice(0, 6)}`) => {
    const id = ids();
    dono(`INSERT INTO core.clients (id, organization_id, name, business_model) VALUES ('${id}', '${org}', '${nome}', 'ecommerce')`);
    return id;
  };

  const novoConvite = (org, client, { status = 'pending', expira = "now() + interval '1 day'", token = ids().replaceAll('-', '') } = {}) => {
    const convite = ids();
    const item = ids();
    dono(
      `INSERT INTO integrations.connection_invites (id, organization_id, client_id, kind, token, status, expires_at, created_at)
       VALUES ('${convite}', '${org}', '${client}', 'oauth_self_service', '${token}', '${status}', ${expira}, now() - interval '2 days')`,
    );
    dono(
      `INSERT INTO integrations.connection_invite_items (id, invite_id, organization_id, platform)
       VALUES ('${item}', '${convite}', '${org}', 'meta')`,
    );
    return { convite, item, token };
  };

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');

    for (const [id, nome] of [[orgA, 'a'], [orgB, 'b'], [orgVazia, 'vazia']]) {
      dono(`INSERT INTO core.organizations (id, name, slug, type) VALUES ('${id}', 'F5R ${nome}', 'f5r-${nome}-${rotulo}', 'agency')`);
    }
    uA = novoUsuario('a').id;
    uB = novoUsuario('b').id;
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${orgA}', '${uA}', 'owner')`);
    dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${orgB}', '${uB}', 'owner')`);

    dono(`INSERT INTO core.clients (id, organization_id, name, business_model) VALUES ('${cA1}', '${orgA}', '${nomeA1}', 'ecommerce')`);
    dono(`INSERT INTO core.clients (id, organization_id, name, business_model) VALUES ('${cA2}', '${orgA}', '${nomeA2}', 'ecommerce')`);
    dono(`INSERT INTO core.clients (id, organization_id, name, business_model) VALUES ('${cB1}', '${orgB}', 'F5R B1 ${rotulo}', 'ecommerce')`);

    ({ userId: uArecortado, memberId: mArecortado } = novoMembroRecortado(orgA, [cA1]));

    dono(
      `INSERT INTO integrations.connections (id, organization_id, platform, grant_type, label, external_id, status)
       VALUES ('${connB}', '${orgB}', 'meta', 'oauth_user', 'F5R conexao B', '${externoB}', 'reauth_pending')`,
    );
  });

  after(() => {
    const limpar = (sql) => {
      try {
        dono(sql);
      } catch {}
    };
    const orgs = `'${orgA}', '${orgB}', '${orgVazia}'`;
    limpar(`DELETE FROM automation.alertas WHERE workflow_nome LIKE 'F5R-%'`);
    limpar(`DELETE FROM privacidade.pedidos_de_exclusao_conexoes WHERE organization_id IN (${orgs})`);
    limpar(`DELETE FROM privacidade.pedidos_de_exclusao WHERE codigo_de_confirmacao LIKE 'F5R%'`);
    limpar(`DELETE FROM privacidade.expurgos_de_fonte WHERE organization_id IN (${orgs})`);
    limpar(`DELETE FROM integrations.whatsapp_inbound_events WHERE external_ref LIKE 'f5r-%'`);
    limpar(`DELETE FROM audit.audit_log WHERE action LIKE 'f5r-%'`);
    limpar(`DELETE FROM audit.audit_log WHERE action = 'team.scope_changed' AND organization_id IN (${orgs})`);
    limpar(`DELETE FROM core.client_context_file_reservations WHERE organization_id IN (${orgs})`);
    for (const tabela of ['client_context_revisions', 'client_context_files', 'client_context_items', 'client_context_entries', 'client_context_links']) {
      limpar(`DELETE FROM core.${tabela} WHERE organization_id IN (${orgs})`);
    }
    limpar(`DELETE FROM integrations.connection_invites WHERE organization_id IN (${orgs})`);
    limpar(`DELETE FROM integrations.ad_accounts WHERE organization_id IN (${orgs})`);
    limpar(`DELETE FROM integrations.connection_accounts WHERE organization_id IN (${orgs})`);
    limpar(`DELETE FROM integrations.connections WHERE organization_id IN (${orgs})`);
    limpar(`DELETE FROM core.member_clients WHERE member_id IN (SELECT id FROM core.members WHERE organization_id IN (${orgs}))`);
    limpar(`DELETE FROM core.invitations WHERE organization_id IN (${orgs})`);
    limpar(`DELETE FROM core.members WHERE organization_id IN (${orgs})`);
    limpar(`DELETE FROM core.clients WHERE organization_id IN (${orgs})`);
    limpar(`DELETE FROM core.organizations WHERE id IN (${orgs})`);
    limpar(`DELETE FROM core.users WHERE email LIKE 'f5r-%-${rotulo}-%'`);
  });

  describe('C1 portaria do n8n', () => {
    it('C1: usuário novo com organização própria não entra na automação (/api/portaria)', async () => {
      const { id } = novoUsuario('novato');
      const org = ids();
      dono(`INSERT INTO core.organizations (id, name, slug, type) VALUES ('${org}', 'F5R proprio', 'f5r-proprio-${rotulo}', 'agency')`);
      dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${id}', 'owner')`);

      const resposta = await fetch(`${BASE}/api/portaria`, {
        headers: { Cookie: `tria_portaria=${portariaToken(id).replace(/^.*?=/, '')}; n8n-auth=sessao-qualquer` },
        redirect: 'manual',
      });
      try {
        assert.notEqual(resposta.status, 204, 'podeEntrarNaAutomacao devolveu true: o dono de uma organização qualquer entra no n8n');
      } finally {
        dono(`DELETE FROM core.members WHERE organization_id = '${org}'`);
        dono(`DELETE FROM core.organizations WHERE id = '${org}'`);
      }
    });

    it('C1: /api/portaria/emitir não emite passagem para o dono de uma organização qualquer', async () => {
      const { id } = novoUsuario('novato2');
      const org = ids();
      dono(`INSERT INTO core.organizations (id, name, slug, type) VALUES ('${org}', 'F5R proprio2', 'f5r-proprio2-${rotulo}', 'agency')`);
      dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${id}', 'owner')`);
      try {
        const resposta = await fetch(`${BASE}/api/portaria/emitir`, {
          headers: { Cookie: sessionCookie(id) },
          redirect: 'manual',
        });
        const destino = resposta.headers.get('location') ?? '';
        assert.ok(!/portaria\/receber\?t=/.test(destino), `passagem emitida: ${destino.split('?')[0]}`);
      } finally {
        dono(`DELETE FROM core.members WHERE organization_id = '${org}'`);
        dono(`DELETE FROM core.organizations WHERE id = '${org}'`);
      }
    });
  });

  describe('A2 recorte vazio vira organização inteira', () => {
    it('A2: expurgar o único cliente do recorte não devolve a organização inteira', () => {
      const alvo = novoCliente(orgA);
      const { userId } = novoMembroRecortado(orgA, [alvo]);
      assert.equal(escopoEfetivo(userId, orgA), alvo, 'pré-condição: recorte de 1 cliente');

      dono(`SELECT core.expurgar_cliente('${alvo}')`);

      const efetivo = escopoEfetivo(userId, orgA);
      assert.notEqual(efetivo, '*', 'escopoDoUsuario devolveria "*": o membro passou a ver a organização inteira');
      assert.equal(naSessao(orgA, efetivo, userId, `SELECT count(*) FROM core.clients WHERE organization_id = '${orgA}'`), '0');
    });

    it('A2: replaceScope com lista vazia não devolve a organização inteira', () => {
      const { userId, memberId } = novoMembroRecortado(orgA, [cA1]);
      naSessao(
        orgA,
        '*',
        uA,
        `UPDATE core.member_clients SET revoked_at = now()
          WHERE member_id = '${memberId}' AND revoked_at IS NULL AND NOT (client_id = ANY ('{}'::uuid[]))`,
      );
      assert.notEqual(escopoEfetivo(userId, orgA), '*', 'recorte esvaziado virou organização inteira');
    });

    it('A2: convite com recorte que resolve a zero clientes não concede a organização inteira', () => {
      const { id: userId, email } = novoUsuario('conv');
      const convite = ids();
      dono(
        `INSERT INTO core.invitations (id, organization_id, email, role, expires_at, client_ids)
         VALUES ('${convite}', '${orgA}', '${email}', 'viewer', now() + interval '1 day', ARRAY['${ids()}']::uuid[])`,
      );
      assert.equal(comoUsuario(userId, `SELECT core.accept_invitation('${convite}', '${userId}')`), 't');
      assert.notEqual(escopoEfetivo(userId, orgA), '*', 'convite recortado a cliente inexistente virou acesso à organização inteira');
    });

    it('A2: o membro recortado, depois do expurgo, não vê outro cliente da organização pela página', async () => {
      const alvo = novoCliente(orgA, `F5R Alvo ${rotulo}`);
      const { userId } = novoMembroRecortado(orgA, [alvo]);
      const ler = async () => {
        const resposta = await fetch(`${BASE}/clientes`, { headers: { Cookie: sessionCookie(userId) }, redirect: 'manual' });
        return { status: resposta.status, corpo: await resposta.text() };
      };
      const antes = await ler();
      assert.equal(antes.status, 200, 'pré-condição: a página abre');
      assert.ok(antes.corpo.includes(`F5R Alvo ${rotulo}`), 'pré-condição: vê o cliente do recorte');
      assert.ok(!antes.corpo.includes(nomeA1), 'pré-condição: não vê cliente fora do recorte');

      dono(`SELECT core.expurgar_cliente('${alvo}')`);

      const depois = await ler();
      assert.ok(!depois.corpo.includes(nomeA1) && !depois.corpo.includes(nomeA2), 'passou a ver clientes fora do recorte original');
    });
  });

  describe('M3 alertas', () => {
    const assinatura = hex64().slice(0, 64);
    before(() => {
      dono(
        `INSERT INTO automation.alertas (workflow_nome, mensagem, assinatura) VALUES ('F5R-${rotulo}', 'falha de plataforma', '${assinatura}')`,
      );
    });

    it('M3: admin da organização B não lê alerta de plataforma', () => {
      const erro = recusa(() => naSessao(orgB, '*', uB, `SELECT count(*) FROM automation.alertas WHERE assinatura = '${assinatura}'`));
      assert.ok(erro && /permission denied/.test(erro), erro ?? 'o app leu alertas de plataforma (ADR 0043)');
    });

    it('M3: membro recortado da organização A não lê alerta de plataforma', () => {
      const erro = recusa(() => naSessao(orgA, cA1, uArecortado, `SELECT count(*) FROM automation.alertas WHERE assinatura = '${assinatura}'`));
      assert.ok(erro && /permission denied/.test(erro), erro ?? 'o app leu alertas de plataforma (ADR 0043)');
    });

    it('M3: o app não resolve nem altera alerta (o 0136 revogou a escrita)', () => {
      const erro = recusa(() =>
        naSessao(orgB, '*', uB, `UPDATE automation.alertas SET resolvido_em = now() WHERE assinatura = '${assinatura}'`),
      );
      assert.ok(erro && /permission denied/.test(erro), erro ?? 'o UPDATE passou');
      assert.equal(dono(`SELECT resolvido_em IS NULL FROM automation.alertas WHERE assinatura = '${assinatura}'`), 't');
    });

    it('M3: o app não apaga alerta', () => {
      const erro = recusa(() => naSessao(orgB, '*', uB, `DELETE FROM automation.alertas WHERE assinatura = '${assinatura}'`));
      assert.ok(erro && /permission denied/.test(erro), erro ?? 'o DELETE passou');
    });
  });

  describe('M4 funções SECURITY DEFINER executáveis pelo app', () => {
    it('M4: complete_invite_item não conclui item de convite de outra organização', () => {
      const { item } = novoConvite(orgB, cB1);
      const saida = naSessao(orgA, '*', uA, `SELECT * FROM integrations.complete_invite_item('${item}', '${connB}')`);
      assert.equal(saida, '', 'a organização A concluiu e leu client_id/organization_id de convite da B');
      assert.equal(dono(`SELECT status FROM integrations.connection_invite_items WHERE id = '${item}'`), 'pending');
    });

    it('M4: invite_item_still_pending não revela organização e cliente de item de outra organização', () => {
      const { item } = novoConvite(orgB, cB1);
      const saida = naSessao(orgA, '*', uA, `SELECT * FROM integrations.invite_item_still_pending('${item}')`);
      assert.equal(saida, '');
    });

    it('M4: record_whatsapp_inbound não grava evento em conexão de outra organização', () => {
      const referencia = `f5r-${ids()}`;
      recusa(() =>
        naSessao(orgA, '*', uA, `SELECT integrations.record_whatsapp_inbound('${connB}', 'zapi', '${referencia}', '{}'::jsonb)`),
      );
      assert.equal(dono(`SELECT count(*) FROM integrations.whatsapp_inbound_events WHERE external_ref = '${referencia}'`), '0');
    });

    it('M4: registrar_resultado_do_expurgo não conclui expurgo de outra organização', () => {
      const expurgo = ids();
      dono(
        `INSERT INTO privacidade.expurgos_de_fonte (id, organization_id, platform, external_id, motivo)
         VALUES ('${expurgo}', '${orgB}', 'youtube', 'f5r-canal-${rotulo}', 'conexao_removida')`,
      );
      recusa(() => naSessao(orgA, '*', uA, `SELECT privacidade.registrar_resultado_do_expurgo('${expurgo}', NULL)`));
      assert.equal(
        dono(`SELECT concluido_em IS NULL FROM privacidade.expurgos_de_fonte WHERE id = '${expurgo}'`),
        't',
        'a organização A marcou como concluído o expurgo da B',
      );
    });

    it('M4: encerrar_sessoes não invalida sessões de outro usuário', () => {
      recusa(() => naSessao(orgA, '*', uA, `SELECT core.encerrar_sessoes('${uB}', now() + interval '10 years')`));
      assert.equal(
        dono(`SELECT sessoes_validas_desde IS NULL FROM core.users WHERE id = '${uB}'`),
        't',
        'qualquer sessão do app derruba as sessões de qualquer usuário (e pode travar o login por anos)',
      );
    });

    it('M4: registrar_pedido_de_exclusao_meta em contexto de uma organização não liga conexão de outra', () => {
      const hash = hex64().slice(0, 64);
      const codigo = codigoDeExclusao();
      recusa(() =>
        naSessao(orgA, '*', uA, `SELECT * FROM privacidade.registrar_pedido_de_exclusao_meta('${hash}', '${externoB}', '${codigo}')`),
      );
      const ligadas = dono(`SELECT count(*) FROM privacidade.pedidos_de_exclusao_conexoes WHERE connection_id = '${connB}'`);
      dono(`DELETE FROM privacidade.pedidos_de_exclusao_conexoes WHERE connection_id = '${connB}'`);
      dono(`DELETE FROM privacidade.pedidos_de_exclusao WHERE codigo_de_confirmacao = '${codigo}'`);
      assert.equal(ligadas, '0', 'sessão de A criou pedido de exclusão sobre a conexão da B');
    });

    it('M4: contexto_link_* e situacao_do_pedido_de_exclusao não devolvem nada para segredo inválido', () => {
      const hashFalso = hex64().slice(0, 64);
      assert.equal(naSessao(orgA, '*', uA, `SELECT count(*) FROM core.contexto_link_abrir('${hashFalso}')`), '0');
      assert.equal(naSessao(orgA, '*', uA, `SELECT core.contexto_link_ler('${hashFalso}', ARRAY['x']) IS NULL`), 't');
      assert.equal(naSessao(orgA, '*', uA, `SELECT count(*) FROM privacidade.situacao_do_pedido_de_exclusao('f5r-${ids()}')`), '0');
    });

    it('M4: as funções SECURITY DEFINER executáveis pelo app são exatamente a allowlist do ADR 0045', () => {
      const reais = dono(SQL_FUNCOES_DEFINER_DO_APP).split('\n').filter(Boolean);
      assert.deepEqual(reais, [...FUNCOES_DEFINER_DO_APP].sort());
    });
  });

  describe('M5 sessao_alcanca_organizacao e oráculos de vínculo', () => {
    const alcanca = (org, quem, perguntando = quem) =>
      comoUsuario(quem, `SELECT core.sessao_alcanca_organizacao('${org}', '${perguntando}')`);
    const orgDoCriador = (criador, minutos) => {
      const org = ids();
      dono(
        `INSERT INTO core.organizations (id, name, slug, type, created_by, created_at)
         VALUES ('${org}', 'F5R janela', 'f5r-j-${ids().slice(0, 8)}', 'agency', '${criador}', now() - interval '${minutos} minutes')`,
      );
      return org;
    };
    const limpa = (org) => {
      dono(`DELETE FROM core.members WHERE organization_id = '${org}'`);
      dono(`DELETE FROM core.organizations WHERE id = '${org}'`);
    };

    it('M5: organização sem membro não é alcançável por usuário que não é dela', () => {
      const { id } = novoUsuario('intruso');
      assert.equal(dono(`SELECT count(*) FROM core.members WHERE organization_id = '${orgVazia}'`), '0');
      assert.equal(alcanca(orgVazia, id), 'f');
    });

    it('M5: organização com membro continua só alcançável por quem é membro (controle)', () => {
      const { id } = novoUsuario('fora');
      assert.equal(alcanca(orgA, id), 'f');
      assert.equal(alcanca(orgA, uA), 't');
    });

    it('M5: criador dentro da janela de 15 minutos alcança a organização sem membro', () => {
      const criador = novoUsuario('criador').id;
      const org = orgDoCriador(criador, 5);
      try {
        assert.equal(alcanca(org, criador), 't');
      } finally {
        limpa(org);
      }
    });

    it('M5: criador depois de 15 minutos não alcança mais a organização sem membro', () => {
      const criador = novoUsuario('criador2').id;
      const org = orgDoCriador(criador, 16);
      try {
        assert.equal(alcanca(org, criador), 'f');
      } finally {
        limpa(org);
      }
    });

    it('M5: outro usuário nunca alcança a organização sem membro, mesmo dentro da janela', () => {
      const criador = novoUsuario('criador3').id;
      const outro = novoUsuario('outro').id;
      const org = orgDoCriador(criador, 1);
      try {
        assert.equal(alcanca(org, outro), 'f');
      } finally {
        limpa(org);
      }
    });

    it('M5: organização com membro segue a regra de vínculo, e o criador sem vínculo não entra', () => {
      const criador = novoUsuario('criador4').id;
      const membro = novoUsuario('membro4').id;
      const org = orgDoCriador(criador, 1);
      dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${org}', '${membro}', 'owner')`);
      try {
        assert.equal(alcanca(org, criador), 'f');
        assert.equal(alcanca(org, membro), 't');
      } finally {
        limpa(org);
      }
    });

    it('B7: is_member, client_scope_of e sessao_alcanca_organizacao não respondem sobre outro usuário', () => {
      assert.equal(alcanca(orgA, uB, uA), 'f', 'sessão de B perguntou por A e obteve vínculo');
      assert.equal(comoUsuario(uB, `SELECT core.is_member('${orgA}', '${uA}')`), 'f');
      assert.equal(
        comoUsuario(uB, `SELECT cardinality(core.client_scope_of('${uA}', '${orgA}'))`),
        '0',
        'sem prova a resposta é recorte vazio (nega), nunca organização inteira',
      );
      assert.equal(comoApp(`SELECT core.is_member('${orgA}', '${uA}')`), 'f', 'sem usuário no contexto não há prova');
      assert.equal(comoUsuario(uA, `SELECT core.is_member('${orgA}', '${uA}')`), 't');
    });

    it('B6: pending_invitations_for e memberships_of não valem sem prova do usuário (sem desvio de superusuário)', () => {
      const alvo = novoUsuario('alvoconv');
      const convite = ids();
      dono(
        `INSERT INTO core.invitations (id, organization_id, email, role, expires_at)
         VALUES ('${convite}', '${orgA}', '${alvo.email}', 'viewer', now() + interval '1 day')`,
      );
      assert.equal(comoUsuario(alvo.id, `SELECT count(*) FROM core.pending_invitations_for('${alvo.email}')`), '1');
      assert.equal(comoUsuario(uB, `SELECT count(*) FROM core.pending_invitations_for('${alvo.email}')`), '0');
      assert.equal(dono(`SELECT count(*) FROM core.pending_invitations_for('${alvo.email}')`), '0', 'o dono do banco também não tem desvio');
      assert.equal(dono(`SELECT count(*) FROM core.memberships_of('${uA}')`), '0');
      assert.equal(comoUsuario(uB, `SELECT count(*) FROM core.memberships_of('${uA}')`), '0');
      assert.equal(comoUsuario(uA, `SELECT count(*) FROM core.memberships_of('${uA}')`), '1');
    });
  });

  describe('M1 backfill do recorte explícito', () => {
    const backfill = () => {
      const migracao = readFileSync('db/migrations/0139_recorte_explicito_de_clientes.sql', 'utf8');
      const texto = migracao.match(/UPDATE core\.members m\s+SET escopo = 'clientes'[\s\S]*?;\n/)?.[0];
      assert.ok(texto, 'backfill de members.escopo não encontrado na 0139');
      return texto.replace(/;\s*$/, '');
    };

    const montar = (rotuloDoCaso, { role = 'viewer', vinculo, convites = [], auditorias = [] }) => {
      const { id, email } = novoUsuario(rotuloDoCaso);
      const membro = ids();
      dono(`INSERT INTO core.members (id, organization_id, user_id, role) VALUES ('${membro}', '${orgA}', '${id}', '${role}')`);
      for (const { recorte, quando } of convites) {
        dono(
          `INSERT INTO core.invitations (organization_id, email, role, expires_at, client_ids, accepted_at, accepted_by)
           VALUES ('${orgA}', '${email}', '${role}', now() + interval '1 day',
                   ${recorte ? `ARRAY['${ids()}']::uuid[]` : `ARRAY[]::uuid[]`}, now() - interval '${quando}', '${id}')`,
        );
      }
      for (const { organizacaoInteira, quando } of auditorias) {
        dono(
          `INSERT INTO audit.audit_log (organization_id, occurred_at, actor_type, actor_id, action, target_type, target_id, metadata)
           VALUES ('${orgA}', now() - interval '${quando}', 'user', '${uA}', 'team.scope_changed', 'member', '${id}',
                   '{"organizacaoInteira": ${organizacaoInteira}}'::jsonb)`,
        );
      }
      if (vinculo === 'vivo') dono(`INSERT INTO core.member_clients (member_id, client_id) VALUES ('${membro}', '${cA1}')`);
      if (vinculo === 'revogado') {
        dono(`INSERT INTO core.member_clients (member_id, client_id, revoked_at) VALUES ('${membro}', '${cA1}', now())`);
      }
      dono(`UPDATE core.members SET escopo = 'organizacao' WHERE id = '${membro}'`);
      return { membro, userId: id };
    };

    const escopoDe = ({ membro }) => dono(`SELECT escopo FROM core.members WHERE id = '${membro}'`);

    it('M1: convite com recorte e vínculo vivo viram clientes; sem nenhum sinal fica organizacao', () => {
      const convidadoSemVinculo = montar('bf1', { convites: [{ recorte: true, quando: '2 hours' }] });
      const vinculoVivo = montar('bf2', { vinculo: 'vivo' });
      const aberto = montar('bf3', {});
      dono(backfill());
      assert.equal(escopoDe(convidadoSemVinculo), 'clientes', 'convite com recorte e sem vínculo vivo ficou com acesso total');
      assert.equal(escopoDe(vinculoVivo), 'clientes');
      assert.equal(escopoDe(aberto), 'organizacao', 'membro aberto de verdade não pode ser restringido');
    });

    it('R1: recortado pela tela de equipe e com os clientes expurgados (vínculos apagados) volta restrito', () => {
      const recortado = montar('bf4', { auditorias: [{ organizacaoInteira: false, quando: '1 hour' }] });
      const revogado = montar('bf4b', { vinculo: 'revogado', auditorias: [{ organizacaoInteira: false, quando: '1 hour' }] });
      dono(backfill());
      assert.equal(escopoDe(recortado), 'clientes', 'recorte pela tela sem vínculos ficou com acesso total');
      assert.equal(escopoDe(revogado), 'clientes');
    });

    it('R1: convite com recorte e depois aberto à organização inteira continua aberto', () => {
      const reaberto = montar('bf5', {
        convites: [{ recorte: true, quando: '3 hours' }],
        auditorias: [{ organizacaoInteira: true, quando: '1 hour' }],
      });
      const convidadoDepoisSemRecorte = montar('bf5b', {
        convites: [{ recorte: true, quando: '3 hours' }, { recorte: false, quando: '1 hour' }],
      });
      dono(backfill());
      assert.equal(escopoDe(reaberto), 'organizacao', 'membro reaberto perdeu o acesso');
      assert.equal(escopoDe(convidadoDepoisSemRecorte), 'organizacao', 'novo convite sem recorte não foi respeitado');
    });

    it('R1: aberto e depois restrito de novo pela tela volta restrito', () => {
      const restrito = montar('bf6', {
        convites: [{ recorte: true, quando: '5 hours' }],
        auditorias: [
          { organizacaoInteira: true, quando: '3 hours' },
          { organizacaoInteira: false, quando: '1 hour' },
        ],
      });
      dono(backfill());
      assert.equal(escopoDe(restrito), 'clientes');
    });

    it('R1: admin reaberto à organização continua enxergando tudo e gerindo a equipe', () => {
      const admin = montar('bf7', {
        role: 'admin',
        convites: [{ recorte: true, quando: '4 hours' }],
        auditorias: [{ organizacaoInteira: true, quando: '2 hours' }],
      });
      dono(backfill());
      assert.equal(escopoDe(admin), 'organizacao');
      assert.equal(dono(`SELECT role FROM core.members WHERE id = '${admin.membro}'`), 'admin');
      assert.equal(escopoEfetivo(admin.userId, orgA), '*', 'admin aberto perdeu o acesso à organização');
    });
  });

  describe('R7 R8 R9 provas das funções do app', () => {
    it('R7: record_whatsapp_inbound sem conexão lança com usuário no contexto e grava sem usuário e sem organização', () => {
      const referencia = `f5r-${ids()}`;
      const comUsuario = recusa(() =>
        comoUsuario(uA, `SELECT integrations.record_whatsapp_inbound(NULL, 'cloud_api', '${referencia}', '{}'::jsonb)`),
      );
      assert.ok(comUsuario && /sem conexao/.test(comUsuario), `devia lançar com usuário logado, veio: ${comUsuario}`);
      assert.match(
        comoApp(`SELECT integrations.record_whatsapp_inbound(NULL, 'cloud_api', '${referencia}', '{}'::jsonb)`),
        /^[0-9a-f-]{36}$/,
      );
    });

    it('R8: client_scope_of devolve lista vazia a quem não é membro, NULL ao criador na janela e ao membro aberto', () => {
      const intruso = novoUsuario('intruso');
      assert.equal(
        comoUsuario(intruso.id, `SELECT cardinality(core.client_scope_of('${intruso.id}', '${orgA}'))`),
        '0',
        'não membro recebeu a organização inteira',
      );

      const criador = novoUsuario('criador');
      const orgNova = ids();
      dono(
        `INSERT INTO core.organizations (id, name, slug, type, created_by)
         VALUES ('${orgNova}', 'F5R Nova', 'f5r-nova-${orgNova.slice(0, 8)}', 'agency', '${criador.id}')`,
      );
      try {
        assert.equal(comoUsuario(criador.id, `SELECT core.client_scope_of('${criador.id}', '${orgNova}') IS NULL`), 't');
        assert.equal(
          comoUsuario(intruso.id, `SELECT cardinality(core.client_scope_of('${intruso.id}', '${orgNova}'))`),
          '0',
          'outro usuário não pode herdar a janela do criador',
        );
        dono(`UPDATE core.organizations SET created_at = now() - interval '1 hour' WHERE id = '${orgNova}'`);
        assert.equal(comoUsuario(criador.id, `SELECT cardinality(core.client_scope_of('${criador.id}', '${orgNova}'))`), '0');
      } finally {
        dono(`DELETE FROM core.organizations WHERE id = '${orgNova}'`);
      }

      assert.equal(comoUsuario(uA, `SELECT core.client_scope_of('${uA}', '${orgA}') IS NULL`), 't', 'membro organizacao');
      const { userId } = novoMembroRecortado(orgA, [cA1]);
      assert.equal(comoUsuario(userId, `SELECT core.client_scope_of('${userId}', '${orgA}')::text`), `{${cA1}}`);
    });

    it('R9: accept_invitation recusa usuário diferente do contexto e sem usuário no contexto', () => {
      const alvo = novoUsuario('aceita');
      const outro = novoUsuario('outro');
      const convite = ids();
      dono(
        `INSERT INTO core.invitations (id, organization_id, email, role, expires_at)
         VALUES ('${convite}', '${orgA}', '${alvo.email}', 'viewer', now() + interval '1 day')`,
      );
      assert.equal(comoUsuario(outro.id, `SELECT core.accept_invitation('${convite}', '${alvo.id}')`), 'f');
      assert.equal(comoApp(`SELECT core.accept_invitation('${convite}', '${alvo.id}')`), 'f');
      assert.equal(
        dono(`SELECT count(*) FROM core.members WHERE organization_id = '${orgA}' AND user_id = '${alvo.id}'`),
        '0',
      );
      assert.equal(comoUsuario(alvo.id, `SELECT core.accept_invitation('${convite}', '${alvo.id}')`), 't');
    });
  });

  describe('M2 expurgar_cliente e vínculos revogados', () => {
    it('M2: admin recortado, aberto à organização e depois um cliente expurgado, continua vendo tudo', () => {
      const alvo = novoCliente(orgA);
      const { userId, memberId } = novoMembroRecortado(orgA, [alvo]);
      dono(`UPDATE core.member_clients SET revoked_at = now() WHERE member_id = '${memberId}'`);
      dono(`UPDATE core.members SET escopo = 'organizacao' WHERE id = '${memberId}'`);
      assert.equal(escopoEfetivo(userId, orgA), '*', 'pré-condição: membro aberto à organização');

      dono(`SELECT core.expurgar_cliente('${alvo}')`);

      assert.equal(escopoEfetivo(userId, orgA), '*', 'o expurgo restringiu um membro que já estava aberto');
      assert.equal(dono(`SELECT escopo FROM core.members WHERE id = '${memberId}'`), 'organizacao');
    });
  });

  describe('M3 created_by e a retenção', () => {
    it('M3: a retenção apaga o usuário que criou organização sem membro e não aborta', () => {
      const email = `f5r-ret-${rotulo}-${ids().slice(0, 4)}@tria.local`;
      emails.push(email);
      const usuario = dono(
        `INSERT INTO core.users (email, name, last_login_at, created_at) VALUES ('${email}', 'x', now() - interval '60 days', now() - interval '60 days') RETURNING id`,
      ).split('\n')[0];
      const org = ids();
      dono(
        `INSERT INTO core.organizations (id, name, slug, type, created_by) VALUES ('${org}', 'F5R ret', 'f5r-ret-${rotulo}', 'agency', '${usuario}')`,
      );
      try {
        const saida = comoWorker('SELECT core.aplicar_retencao()');
        assert.ok(saida.length > 0);
        assert.equal(dono(`SELECT count(*) FROM core.users WHERE id = '${usuario}'`), '0', 'a retenção devia apagar o usuário');
        assert.equal(dono(`SELECT created_by IS NULL FROM core.organizations WHERE id = '${org}'`), 't');
      } finally {
        dono(`DELETE FROM core.organizations WHERE id = '${org}'`);
      }
    });

    it('M3: created_by continua imutável para outro valor não nulo', () => {
      const outro = novoUsuario('troca').id;
      const falha = recusa(() => naSessao(orgA, '*', uA, `UPDATE core.organizations SET created_by = '${outro}' WHERE id = '${orgA}'`));
      assert.ok(falha !== null, 'trocar created_by devia falhar');
    });
  });

  describe('B8 FK composta de coletas', () => {
    it('B8: coleta com conta de anúncios ou recurso de outra organização é recusada, e o resolvedor exige a mesma organização', () => {
      const conexaoA = ids();
      dono(
        `INSERT INTO integrations.connections (id, organization_id, platform, grant_type, label, external_id, status)
         VALUES ('${conexaoA}', '${orgA}', 'meta', 'oauth_user', 'F5R conexao A', '${digitos()}', 'reauth_pending')`,
      );
      const contaB = ids();
      dono(
        `INSERT INTO integrations.ad_accounts (id, organization_id, connection_id, client_id, platform, external_id, name)
         VALUES ('${contaB}', '${orgB}', '${connB}', '${cB1}', 'meta', 'f5r-act-${rotulo}', 'conta B')`,
      );
      const recursoB = ids();
      dono(
        `INSERT INTO integrations.connection_accounts (id, organization_id, connection_id, platform, external_id, name)
         VALUES ('${recursoB}', '${orgB}', '${connB}', 'meta', 'f5r-rec-${rotulo}', 'recurso B')`,
      );
      const inserirColeta = (colunaFonte, fonte, tipo) =>
        dono(
          `INSERT INTO automation.coletas (organization_id, client_id, platform, fonte_tipo, ${colunaFonte}, mode, idempotency_key, window_start, window_end)
           VALUES ('${orgA}', '${cA1}', 'meta', '${tipo}', '${fonte}', 'amostra', 'f5r-${ids()}', current_date - 1, current_date)`,
        );
      try {
        assert.ok(recusa(() => inserirColeta('ad_account_id', contaB, 'ad_account')), 'coleta da A com conta da B foi aceita');
        assert.ok(recusa(() => inserirColeta('connection_account_id', recursoB, 'connection_account')), 'coleta da A com recurso da B foi aceita');
        const coletaB = dono(
          `INSERT INTO automation.coletas (organization_id, client_id, platform, fonte_tipo, ad_account_id, mode, idempotency_key, window_start, window_end)
           VALUES ('${orgB}', '${cB1}', 'meta', 'ad_account', '${contaB}', 'amostra', 'f5r-${ids()}', current_date - 1, current_date) RETURNING id`,
        ).split('\n')[0];
        const resolvido = comoWorker(`SELECT organization_id FROM integrations.resolver_conexao_do_token('${coletaB}', NULL)`);
        assert.equal(resolvido, orgB, 'controle positivo: a coleta da B resolve para a B');
      } finally {
        dono(`DELETE FROM automation.coletas WHERE idempotency_key LIKE 'f5r-%' AND organization_id IN ('${orgA}', '${orgB}')`);
        dono(`DELETE FROM integrations.ad_accounts WHERE id = '${contaB}'`);
        dono(`DELETE FROM integrations.connection_accounts WHERE id = '${recursoB}'`);
        dono(`DELETE FROM integrations.connections WHERE id = '${conexaoA}'`);
      }
    });
  });

  describe('B4 WhatsApp sem prova não some em silêncio', () => {
    it('B4: record_whatsapp_inbound lança exceção quando a conexão não é da organização do contexto', () => {
      const referencia = `f5r-${ids()}`;
      const falha = recusa(() =>
        naSessao(orgA, '*', uA, `SELECT integrations.record_whatsapp_inbound('${connB}', 'zapi', '${referencia}', '{}'::jsonb)`),
      );
      assert.ok(falha && /nao pertence/.test(falha), `devia lançar exceção, veio: ${falha}`);
      const semConexaoEmOrg = recusa(() =>
        naSessao(orgA, '*', uA, `SELECT integrations.record_whatsapp_inbound(NULL, 'cloud_api', '${referencia}', '{}'::jsonb)`),
      );
      assert.ok(semConexaoEmOrg, 'Cloud API sem conexão dentro de organização devia lançar');
      assert.match(comoApp(`SELECT integrations.record_whatsapp_inbound(NULL, 'cloud_api', '${referencia}', '{}'::jsonb)`), /^[0-9a-f-]{36}$/);
    });
  });

  describe('B5 exclusão da Meta: a assinatura é conferida na rota', () => {
    it('B5: assinatura inválida (401) ou app Meta sem configuração (503) nunca registra pedido', async () => {
      const antes = dono(`SELECT count(*) FROM privacidade.pedidos_de_exclusao`);
      const resposta = await fetch(`${BASE}/api/meta/exclusao`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signed_request: `${'a'.repeat(43)}.${Buffer.from('{"user_id":"123","algorithm":"HMAC-SHA256"}').toString('base64url')}` }),
      });
      assert.ok([401, 503].includes(resposta.status), `status ${resposta.status}`);
      assert.notEqual(resposta.status, 200);
      assert.equal(dono(`SELECT count(*) FROM privacidade.pedidos_de_exclusao`), antes, 'pedido registrado com assinatura inválida');
    });
  });

  describe('M6 core.users', () => {
    it('M6: o app não altera o e-mail da própria linha', () => {
      const { id } = novoUsuario('mail');
      const novo = `f5r-roubado-${rotulo}-${ids().slice(0, 4)}@tria.local`;
      recusa(() => naSessao(orgA, '*', id, `UPDATE core.users SET email = '${novo}' WHERE id = '${id}'`));
      const gravado = dono(`SELECT email FROM core.users WHERE id = '${id}'`);
      assert.ok(gravado !== novo, 'orla_app tem UPDATE na coluna email');
    });

    it('M6: o app não zera sessoes_validas_desde (desfaz o encerramento de sessões)', () => {
      const { id } = novoUsuario('sess');
      dono(`UPDATE core.users SET sessoes_validas_desde = now() WHERE id = '${id}'`);
      recusa(() => naSessao(orgA, '*', id, `UPDATE core.users SET sessoes_validas_desde = NULL WHERE id = '${id}'`));
      assert.equal(dono(`SELECT sessoes_validas_desde IS NOT NULL FROM core.users WHERE id = '${id}'`), 't');
    });

    it('M6: trocar o e-mail próprio não permite aceitar convite endereçado a outra pessoa', () => {
      const atacante = novoUsuario('atac');
      const vitima = `f5r-vitima-${rotulo}-${ids().slice(0, 4)}@tria.local`;
      emails.push(vitima);
      const convite = ids();
      dono(
        `INSERT INTO core.invitations (id, organization_id, email, role, expires_at)
         VALUES ('${convite}', '${orgB}', '${vitima}', 'admin', now() + interval '1 day')`,
      );
      recusa(() => naSessao(orgA, '*', atacante.id, `UPDATE core.users SET email = '${vitima}' WHERE id = '${atacante.id}'`));
      assert.equal(comoUsuario(atacante.id, `SELECT core.accept_invitation('${convite}', '${atacante.id}')`), 'f');
      assert.equal(
        dono(`SELECT count(*) FROM core.members WHERE organization_id = '${orgB}' AND user_id = '${atacante.id}'`),
        '0',
        'o atacante virou admin da organização B',
      );
    });

    it('M6: o app só tem UPDATE nas colunas de perfil de core.users', () => {
      const colunas = dono(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE grantee = 'orla_app' AND table_schema = 'core' AND table_name = 'users' AND privilege_type = 'UPDATE'
          ORDER BY 1`,
      ).split('\n');
      const permitidas = new Set(['name', 'picture_url', 'last_login_at', 'updated_at']);
      assert.deepEqual(colunas.filter((coluna) => !permitidas.has(coluna)), []);
    });
  });

  describe('Baixos', () => {
    it('Baixo: usuarioDaSessao confere se a sessão foi encerrada (sessoesValidasDesde)', async () => {
      const codigo = readFileSync('src/shared/db/escopo.ts', 'utf8');
      assert.match(codigo, /core\.sessao_valida/, 'lerUsuario só valida assinatura e prazo do cookie');

      const { id } = novoUsuario('encerrada');
      dono(`INSERT INTO core.members (organization_id, user_id, role) VALUES ('${orgA}', '${id}', 'viewer')`);
      const cookie = sessionCookie(id);
      const abrir = () => fetch(`${BASE}/clientes`, { headers: { Cookie: cookie }, redirect: 'manual' });

      assert.equal((await abrir()).status, 200, 'pré-condição: a sessão abre a página');
      dono(`UPDATE core.users SET sessoes_validas_desde = now() + interval '1 minute' WHERE id = '${id}'`);
      const depois = await abrir();
      assert.ok([302, 303, 307].includes(depois.status), `sessão encerrada ainda abriu a página (${depois.status})`);
      assert.match(depois.headers.get('location') ?? '', /\/entrar/);
    });

    it('Baixo: audit_insert não aceita evento sem organização dentro de um contexto de organização', () => {
      const acao = `f5r-nulo-${ids()}`;
      recusa(() =>
        naSessao(orgA, '*', uA, `INSERT INTO audit.audit_log (organization_id, actor_type, action) VALUES (NULL, 'user', '${acao}')`),
      );
      assert.equal(dono(`SELECT count(*) FROM audit.audit_log WHERE action = '${acao}'`), '0');
    });

    it('Baixo: resolve_invite_for_display não devolve nome da organização de convite expirado ou revogado', () => {
      const expirado = novoConvite(orgB, cB1, { expira: "now() - interval '1 hour'" });
      const revogado = novoConvite(orgB, cB1, { status: 'revoked' });
      for (const { token } of [expirado, revogado]) {
        assert.equal(comoApp(`SELECT count(*) FROM integrations.resolve_invite_for_display('${token}')`), '0');
      }
    });

    it('Baixo: o app não vincula conexão de outra organização (connection_accounts, FK simples)', () => {
      const conta = ids();
      recusa(() =>
        naSessao(
          orgA,
          '*',
          uA,
          `INSERT INTO integrations.connection_accounts (id, organization_id, connection_id, platform, external_id, name)
           VALUES ('${conta}', '${orgA}', '${connB}', 'meta', 'f5r-${rotulo}', 'cruzada')`,
        ),
      );
      assert.equal(dono(`SELECT count(*) FROM integrations.connection_accounts WHERE id = '${conta}'`), '0');
    });

    it('Baixo: o app não cria ad_account de A sobre conexão de B', () => {
      const conta = ids();
      recusa(() =>
        naSessao(
          orgA,
          '*',
          uA,
          `INSERT INTO integrations.ad_accounts (id, organization_id, client_id, connection_id, platform, external_id, name)
           VALUES ('${conta}', '${orgA}', '${cA1}', '${connB}', 'meta', 'f5r-${rotulo}', 'cruzada')`,
        ),
      );
      assert.equal(dono(`SELECT count(*) FROM integrations.ad_accounts WHERE id = '${conta}'`), '0');
    });

    it('Baixo: toda FK para integrations.connections em tabela com organization_id é composta', () => {
      const simples = dono(
        `SELECT coalesce(string_agg(conrelid::regclass::text, ', '), '') FROM pg_constraint k
          WHERE k.contype = 'f' AND k.confrelid = 'integrations.connections'::regclass
            AND array_length(k.conkey, 1) = 1
            AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = k.conrelid AND a.attname = 'organization_id' AND NOT a.attisdropped)`,
      );
      assert.equal(simples, '', `FK simples: ${simples}`);
    });

    it('Baixo: o app não lê o estado das sequences globais', () => {
      const legiveis = dono(
        `SELECT coalesce(string_agg(schemaname || '.' || sequencename, ', '), '') FROM pg_sequences
          WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
            AND has_sequence_privilege('orla_app', schemaname || '.' || sequencename, 'SELECT')`,
      );
      assert.equal(legiveis, '', 'last_value revela o volume de eventos de toda a plataforma');
    });
  });

  describe('core.clients e papéis', () => {
    it('clients: a política de A não enxerga cliente de B nem insere em B', () => {
      assert.equal(naSessao(orgA, '*', uA, `SELECT count(*) FROM core.clients WHERE id = '${cB1}'`), '0');
      const erro = recusa(() =>
        naSessao(orgA, '*', uA, `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${orgB}', 'f5r-forjado', 'ecommerce')`),
      );
      assert.ok(erro && /row-level security/i.test(erro), erro ?? 'o INSERT passou');
    });

    it('clients: cliente excluído logicamente some e o app não o restaura nem se autoexclui', () => {
      const alvo = novoCliente(orgA);
      assert.equal(naSessao(orgA, '*', uA, `SELECT count(*) FROM core.clients WHERE id = '${alvo}'`), '1');
      const erro = recusa(() => naSessao(orgA, '*', uA, `UPDATE core.clients SET excluido_em = now() WHERE id = '${alvo}'`));
      assert.ok(erro && /row-level security/i.test(erro), erro ?? 'o app marcou exclusão direto');
      dono(`SELECT core.excluir_cliente('${alvo}', 'f5r')`);
      assert.equal(naSessao(orgA, '*', uA, `SELECT count(*) FROM core.clients WHERE id = '${alvo}'`), '0');
      assert.equal(
        naSessao(orgA, '*', uA, `WITH r AS (UPDATE core.clients SET excluido_em = NULL WHERE id = '${alvo}' RETURNING 1) SELECT count(*) FROM r`),
        '0',
      );
    });

    it('clients: membro recortado só enxerga o cliente do recorte e não cria cliente fora dele', () => {
      assert.equal(naSessao(orgA, cA1, uArecortado, `SELECT count(*) FROM core.clients WHERE organization_id = '${orgA}'`), '1');
      const erro = recusa(() =>
        naSessao(orgA, cA1, uArecortado, `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${orgA}', 'f5r-fora', 'ecommerce')`),
      );
      assert.ok(erro && /row-level security/i.test(erro), erro ?? 'o INSERT passou');
    });

    it('papéis: orla_app e orla_worker não têm superuser, bypassrls, createrole, createdb nem replicação', () => {
      const linhas = dono(
        `SELECT rolname || ':' || rolsuper || rolbypassrls || rolcreaterole || rolcreatedb || rolreplication FROM pg_roles
          WHERE rolname IN ('orla_app', 'orla_worker') ORDER BY 1`,
      );
      assert.equal(linhas, 'orla_app:falsefalsefalsefalsefalse\norla_worker:falsefalsefalsefalsefalse');
    });

    it('papéis: nenhum papel de aplicação é dono de tabela de negócio (FORCE RLS não é o único freio)', () => {
      const donas = dono(
        `SELECT coalesce(string_agg(schemaname || '.' || tablename, ', '), '') FROM pg_tables
          WHERE tableowner IN ('orla_app', 'orla_worker') AND schemaname IN ('core','integrations','metrics','automation','audit','privacidade')`,
      );
      assert.equal(donas, '');
    });
  });

  describe('isolamento: client_context_*, pedidos_de_exclusao, alertas', () => {
    const insercoes = {
      client_context_entries: (org, cliente) =>
        `INSERT INTO core.client_context_entries (organization_id, client_id, section, field_key, value) VALUES ('${org}', '${cliente}', 'negocio', 'f5r', '"x"'::jsonb)`,
      client_context_items: (org, cliente) =>
        `INSERT INTO core.client_context_items (organization_id, client_id, section, list_key, position, data) VALUES ('${org}', '${cliente}', 'negocio', 'f5r', 1, '{}'::jsonb)`,
      client_context_links: (org, cliente) =>
        `INSERT INTO core.client_context_links (organization_id, client_id, token_hash, sections, expires_at) VALUES ('${org}', '${cliente}', '${hex64().slice(0, 64)}', ARRAY['negocio'], now() + interval '1 day')`,
      client_context_revisions: (org, cliente) =>
        `INSERT INTO core.client_context_revisions (organization_id, client_id, target, section, key, operation) VALUES ('${org}', '${cliente}', 'campo', 'negocio', 'f5rrev', 'criar')`,
      client_context_files: (org, cliente) => {
        const arquivo = ids();
        const caminho = `orgs/${org}/clientes/${cliente}/arquivos/${arquivo}`;
        return `INSERT INTO core.client_context_file_reservations (id, organization_id, client_id, object_path, size_bytes) VALUES ('${arquivo}', '${org}', '${cliente}', '${caminho}', 10);
          INSERT INTO core.client_context_files (id, organization_id, client_id, section, field_key, object_path, filename, mime, size_bytes, sha256, source) VALUES ('${arquivo}', '${org}', '${cliente}', 'negocio', 'f5r', '${caminho}', 'a.pdf', 'application/pdf', 10, '${hex64().slice(0, 64)}', 'equipe')`;
      },
    };

    for (const [tabela, inserir] of Object.entries(insercoes)) {
      it(`ISOL ${tabela}: A não lê, não escreve e não apaga linhas de B; recorte esconde o outro cliente`, () => {
        dono(inserir(orgA, cA1));
        dono(inserir(orgA, cA2));
        dono(inserir(orgB, cB1));

        const marcador = { client_context_revisions: "key = 'f5rrev'", client_context_entries: "field_key = 'f5r'", client_context_items: "list_key = 'f5r'" }[tabela] ?? 'true';
        const contar = (org, escopo, user, filtro) =>
          naSessao(org, escopo, user, `SELECT count(*) FROM core.${tabela} WHERE ${marcador} AND ${filtro}`);

        assert.equal(contar(orgA, '*', uA, `organization_id = '${orgB}'`), '0', 'A leu linha da B');
        assert.equal(contar(orgB, '*', uB, `organization_id = '${orgB}'`), '1', 'B não lê a própria linha');
        assert.equal(contar(orgA, cA1, uArecortado, `client_id = '${cA2}'`), '0', 'recorte enxergou o outro cliente');
        assert.equal(contar(orgA, cA1, uArecortado, `client_id = '${cA1}'`), '1');

        if (tabela !== 'client_context_revisions') {
          const erroInsercao = recusa(() => naSessao(orgA, '*', uA, inserir(orgB, cB1)));
          assert.ok(erroInsercao && /row-level security|permission denied/i.test(erroInsercao), erroInsercao ?? 'A inseriu na B');
          let apagou = '0';
          const negado = recusa(() => {
            apagou = naSessao(orgA, '*', uA, `WITH d AS (DELETE FROM core.${tabela} WHERE organization_id = '${orgB}' RETURNING 1) SELECT count(*) FROM d`);
          });
          assert.ok(negado ? /permission denied/.test(negado) : apagou === '0', 'A apagou linha da B');
        }
        assert.equal(dono(`SELECT count(*) FROM core.${tabela} WHERE ${marcador} AND organization_id = '${orgB}'`), '1', 'a linha da B sumiu');
      });
    }

    it('ISOL pedidos_de_exclusao e conexões: só enxerga o pedido ligado à própria organização', () => {
      const connA = ids();
      dono(
        `INSERT INTO integrations.connections (id, organization_id, platform, grant_type, label, external_id, status)
         VALUES ('${connA}', '${orgA}', 'meta', 'oauth_user', 'F5R conexao A', '${digitos()}', 'reauth_pending')`,
      );
      const pedidoA = ids();
      const pedidoB = ids();
      dono(
        `INSERT INTO privacidade.pedidos_de_exclusao (id, origem, codigo_de_confirmacao, usuario_externo_hash)
         VALUES ('${pedidoA}', 'meta', '${codigoDeExclusao()}', '${hex64().slice(0, 64)}'), ('${pedidoB}', 'meta', '${codigoDeExclusao()}', '${hex64().slice(0, 64)}')`,
      );
      dono(`INSERT INTO privacidade.pedidos_de_exclusao_conexoes (pedido_id, organization_id, connection_id) VALUES ('${pedidoA}', '${orgA}', '${connA}'), ('${pedidoB}', '${orgB}', '${connB}')`);

      assert.equal(naSessao(orgA, '*', uA, `SELECT count(*) FROM privacidade.pedidos_de_exclusao WHERE id = '${pedidoB}'`), '0');
      assert.equal(naSessao(orgA, '*', uA, `SELECT count(*) FROM privacidade.pedidos_de_exclusao WHERE id = '${pedidoA}'`), '1');
      assert.equal(naSessao(orgA, '*', uA, `SELECT count(*) FROM privacidade.pedidos_de_exclusao_conexoes WHERE organization_id = '${orgB}'`), '0');
      assert.equal(naSessao(orgA, cA1, uArecortado, `SELECT count(*) FROM privacidade.pedidos_de_exclusao_conexoes`), '0');
      const erro = recusa(() => naSessao(orgA, '*', uA, `DELETE FROM privacidade.pedidos_de_exclusao WHERE id = '${pedidoA}'`));
      assert.ok(erro && /permission denied/.test(erro), erro ?? 'o app apagou pedido de exclusão');
    });
  });
});
