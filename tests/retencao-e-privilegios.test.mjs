import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { sqlDeConexao } from './helpers.mjs';

const CONTAINER = process.env.TRIA_TEST_PG ?? 'orla-postgres';
const sufixo = randomBytes(4).toString('hex');

const variavel = (nome) =>
  process.env[nome] ??
  readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith(`${nome}=`))
    .slice(nome.length + 1);

const psql = (usuario, senha, sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', ...(senha ? ['-e', `PGPASSWORD=${senha}`] : []), CONTAINER, 'psql', '-U', usuario, ...(senha ? ['-h', '127.0.0.1'] : []), '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

const dono = (sql) => psql('postgres', null, sql);
const comoApp = (sql) => psql('orla_app', variavel('APP_DB_PASSWORD'), sql);
const comoWorker = (sql) => psql('orla_worker', variavel('WORKER_DB_PASSWORD'), sql);
const ultimaLinha = (texto) => texto.split('\n').at(-1).trim();

const noContexto = (organizacao, clientes, consulta) =>
  ultimaLinha(comoApp(`SET app.organization_id = '${organizacao}'; SET app.client_ids = '${clientes}'; ${consulta}`));

describe('retenção: ex-membros, convites aceitos, alertas e WhatsApp', { concurrency: false }, () => {
  it('aplica os prazos novos e preserva o que ainda está dentro do prazo', () => {
    const org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Ret ${sufixo}', 'ret-${sufixo}', 'agency') RETURNING id`);
    const usuario = (nome) =>
      dono(`INSERT INTO core.users (email, name, last_login_at) VALUES ('${nome}-${sufixo}@ret.test', '${nome}', now()) RETURNING id`);
    const vinculo = (id, revogadoHa) =>
      dono(
        `INSERT INTO core.members (organization_id, user_id, role, revoked_at)
         VALUES ('${org}', '${id}', 'viewer', ${revogadoHa ? `now() - interval '${revogadoHa}'` : 'NULL'})`,
      );
    const exAntigo = usuario('exantigo');
    const exRecente = usuario('exrecente');
    const vivo = usuario('vivo');
    vinculo(exAntigo, '100 days');
    vinculo(exRecente, '20 days');
    vinculo(vivo, null);
    const orgDois = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Ret2 ${sufixo}', 'ret2-${sufixo}', 'agency') RETURNING id`);
    const doisVinculos = usuario('doisvinculos');
    dono(`INSERT INTO core.members (organization_id, user_id, role, revoked_at) VALUES ('${org}', '${doisVinculos}', 'viewer', now() - interval '100 days')`);
    dono(`INSERT INTO core.members (organization_id, user_id, role, revoked_at) VALUES ('${orgDois}', '${doisVinculos}', 'viewer', now() - interval '20 days')`);
    const auditoriaDoEx = dono(
      `INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
       VALUES ('${org}', 'user', 'team.invited', 'invitation', gen_random_uuid()::text, '{"email":"exantigo-${sufixo}@ret.test","role":"viewer"}') RETURNING id`,
    );

    const aceitoAntigo = dono(
      `INSERT INTO core.invitations (organization_id, email, role, expires_at, accepted_at, accepted_by)
       VALUES ('${org}', 'aceito-antigo-${sufixo}@ret.test', 'viewer', now() + interval '1 day', now() - interval '31 days', '${vivo}') RETURNING id`,
    );
    const aceitoRecente = dono(
      `INSERT INTO core.invitations (organization_id, email, role, expires_at, accepted_at, accepted_by)
       VALUES ('${org}', 'aceito-recente-${sufixo}@ret.test', 'viewer', now() + interval '1 day', now() - interval '5 days', '${vivo}') RETURNING id`,
    );

    const auditoriaDoConvite = dono(
      `INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
       VALUES ('${org}', 'user', 'team.invited', 'invitation', '${aceitoAntigo}', '{"email":"aceito-antigo-${sufixo}@ret.test","role":"viewer"}') RETURNING id`,
    );

    const alertaAntigo = dono(
      `INSERT INTO automation.alertas (workflow_nome, mensagem, assinatura, ultima_em)
       VALUES ('wf antigo ${sufixo}', 'm', '${'a'.repeat(64)}', now() - interval '100 days') RETURNING id`,
    );
    const alertaNovo = dono(
      `INSERT INTO automation.alertas (workflow_nome, mensagem, assinatura, ultima_em)
       VALUES ('wf novo ${sufixo}', 'm', '${'b'.repeat(64)}', now() - interval '10 days') RETURNING id`,
    );

    const resumo = JSON.parse(ultimaLinha(comoWorker('SELECT core.aplicar_retencao()')));
    assert.ok(resumo.usuariosAnonimizados >= 1 && resumo.convitesAceitosAnonimizados >= 1 && resumo.alertasApagados >= 1);

    const emailDe = (id) => dono(`SELECT email FROM core.users WHERE id = '${id}'`);
    assert.equal(emailDe(exAntigo), `removido+${exAntigo}@invalid`);
    assert.equal(dono(`SELECT name FROM core.users WHERE id = '${exAntigo}'`), 'Titular removido');
    assert.equal(emailDe(exRecente), `exrecente-${sufixo}@ret.test`, 'dentro do prazo');
    assert.equal(emailDe(vivo), `vivo-${sufixo}@ret.test`, 'vínculo vivo');
    assert.equal(emailDe(doisVinculos), `doisvinculos-${sufixo}@ret.test`, 'o vínculo mais recente ainda está dentro do prazo');
    const emailNaTrilha = (id) => dono(`SELECT coalesce(metadata ->> 'email', '-') FROM audit.audit_log WHERE id = '${id}'`);
    assert.equal(emailNaTrilha(auditoriaDoEx), '-', 'e-mail do ex-membro some da trilha');
    assert.equal(emailNaTrilha(auditoriaDoConvite), '-', 'e-mail do convite aceito some da trilha');

    const emailDoConvite = (id) => dono(`SELECT email FROM core.invitations WHERE id = '${id}'`);
    assert.equal(emailDoConvite(aceitoAntigo), `removido+${aceitoAntigo}@invalid`);
    assert.equal(emailDoConvite(aceitoRecente), `aceito-recente-${sufixo}@ret.test`);

    assert.equal(dono(`SELECT count(*) FROM automation.alertas WHERE id = '${alertaAntigo}'`), '0');
    assert.equal(dono(`SELECT count(*) FROM automation.alertas WHERE id = '${alertaNovo}'`), '1');
  });

  it('o pedido de exclusão do titular limpa o payload do WhatsApp que cita o e-mail', () => {
    const email = `titular-${sufixo}@wa.test`;
    const citando = dono(
      `INSERT INTO integrations.whatsapp_inbound_events (source, external_ref, payload)
       VALUES ('zapi', 'cita-${sufixo}', '{"contato":"${email}"}') RETURNING id`,
    );
    const outro = dono(
      `INSERT INTO integrations.whatsapp_inbound_events (source, external_ref, payload)
       VALUES ('zapi', 'outro-${sufixo}', '{"contato":"alheio@wa.test"}') RETURNING id`,
    );
    const contem = dono(
      `INSERT INTO integrations.whatsapp_inbound_events (source, external_ref, payload)
       VALUES ('zapi', 'contem-${sufixo}', '{"contato":"x${email}"}') RETURNING id`,
    );
    const resumo = JSON.parse(ultimaLinha(dono(`SELECT core.anonimizar_titular('${email}')`)));
    assert.ok(resumo.eventosWhatsapp >= 1);
    assert.equal(dono(`SELECT payload::text FROM integrations.whatsapp_inbound_events WHERE id = '${citando}'`), '{"removido": true}');
    assert.match(dono(`SELECT payload::text FROM integrations.whatsapp_inbound_events WHERE id = '${outro}'`), /alheio@wa\.test/);
    assert.match(dono(`SELECT payload::text FROM integrations.whatsapp_inbound_events WHERE id = '${contem}'`), /x.*@wa\.test/, 'não casa por pedaço do texto');
    assert.throws(() => dono(`SELECT core.anonimizar_titular('x@')`), /e-mail inválido/);
  });
});

describe('alertas: o papel do app só lê', { concurrency: false }, () => {
  it('app não insere, atualiza nem apaga; o worker insere e atualiza', () => {
    const assinatura = 'c'.repeat(64);
    assert.throws(() => comoApp(`INSERT INTO automation.alertas (workflow_nome, mensagem, assinatura) VALUES ('x', 'm', '${assinatura}')`), /permission denied/);
    const id = ultimaLinha(comoWorker(`INSERT INTO automation.alertas (workflow_nome, mensagem, assinatura) VALUES ('w ${sufixo}', 'm', '${assinatura}') RETURNING id`).split('\n')[0]);
    assert.throws(() => comoApp(`UPDATE automation.alertas SET resolvido_em = now() WHERE id = '${id}'`), /permission denied/);
    assert.throws(() => comoApp(`DELETE FROM automation.alertas WHERE id = '${id}'`), /permission denied/);
    assert.doesNotThrow(() => comoApp(`SELECT count(*) FROM automation.alertas`));
    assert.doesNotThrow(() => comoWorker(`UPDATE automation.alertas SET ocorrencias = ocorrencias + 1 WHERE id = '${id}'`));
    assert.throws(() => comoWorker(`DELETE FROM automation.alertas WHERE id = '${id}'`), /permission denied/);
  });
});

describe('isolamento cruzado: convites, itens, coletas e tokens', { concurrency: false }, () => {
  const ids = {};

  const montar = (rotulo) => {
    const org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('${rotulo} ${sufixo}', '${rotulo}-${sufixo}', 'agency') RETURNING id`);
    const cliente = (nome) =>
      dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome} ${sufixo}', 'ecommerce') RETURNING id`);
    return { org, cliente };
  };

  it('prepara duas organizações e dois clientes na primeira', () => {
    const a = montar('isoa');
    const b = montar('isob');
    ids.orgA = a.org;
    ids.orgB = b.org;
    ids.clienteA1 = a.cliente('A1');
    ids.clienteA2 = a.cliente('A2');
    ids.clienteB = b.cliente('B');
    for (const [org, cliente, rotulo] of [[ids.orgA, ids.clienteA1, 'a1'], [ids.orgA, ids.clienteA2, 'a2'], [ids.orgB, ids.clienteB, 'b']]) {
      const conexao = sqlDeConexao({ organizationId: org, platform: 'meta', label: `Conexão ${rotulo} ${sufixo}`, externalId: `iso-${rotulo}-${sufixo}` });
      dono(conexao.sql);
      ids[`conexao_${rotulo}`] = conexao.id;
      ids[`conta_${rotulo}`] = dono(
        `INSERT INTO integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
         VALUES ('${org}', '${cliente}', '${conexao.id}', 'meta', 'acc-${rotulo}-${sufixo}', 'Conta ${rotulo}') RETURNING id`,
      );
      dono(
        `INSERT INTO automation.coletas (organization_id, client_id, platform, fonte_tipo, ad_account_id, mode, idempotency_key, status, window_start, window_end)
         VALUES ('${org}', '${cliente}', 'meta', 'ad_account', '${ids[`conta_${rotulo}`]}', 'completa', 'iso-${rotulo}-${sufixo}', 'success', date '2026-11-01', date '2026-11-07')`,
      );
      ids[`convite_${rotulo}`] = dono(
        `INSERT INTO integrations.connection_invites (organization_id, client_id, kind, token, expires_at)
         VALUES ('${org}', '${cliente}', 'oauth_self_service', '${randomBytes(24).toString('base64url')}', now() + interval '7 days') RETURNING id`,
      );
      dono(
        `INSERT INTO integrations.connection_invite_items (invite_id, organization_id, platform)
         VALUES ('${ids[`convite_${rotulo}`]}', '${org}', 'meta')`,
      );
    }
  });

  const contar = (tabela, org, recorte, filtro) =>
    Number(noContexto(org, recorte, `SELECT count(*) FROM ${tabela} WHERE ${filtro}`));

  it('organização inteira vê o que é dela e nada da outra', () => {
    const doSufixo = (coluna) => `${coluna} IN ('${ids.orgA}', '${ids.orgB}')`;
    for (const tabela of ['integrations.connection_invites', 'integrations.connection_invite_items', 'automation.coletas', 'integrations.connection_tokens']) {
      assert.equal(contar(tabela, ids.orgA, '*', `organization_id = '${ids.orgB}'`), 0, `${tabela}: A vê B`);
      assert.equal(contar(tabela, ids.orgB, '*', `organization_id = '${ids.orgA}'`), 0, `${tabela}: B vê A`);
    }
    assert.equal(contar('integrations.connection_invites', ids.orgA, '*', doSufixo('organization_id')), 2);
    assert.equal(contar('integrations.connection_invite_items', ids.orgA, '*', doSufixo('organization_id')), 2);
    assert.equal(contar('automation.coletas', ids.orgA, '*', doSufixo('organization_id')), 2);
    assert.equal(contar('integrations.connection_tokens', ids.orgA, '*', doSufixo('organization_id')), 2);
  });

  it('membro recortado a A1 não vê convite, item nem coleta de A2', () => {
    const recorte = ids.clienteA1;
    assert.equal(contar('integrations.connection_invites', ids.orgA, recorte, `id = '${ids.convite_a2}'`), 0);
    assert.equal(contar('integrations.connection_invites', ids.orgA, recorte, `id = '${ids.convite_a1}'`), 1, 'controle positivo');
    assert.equal(contar('integrations.connection_invite_items', ids.orgA, recorte, `invite_id = '${ids.convite_a2}'`), 0);
    assert.equal(contar('integrations.connection_invite_items', ids.orgA, recorte, `invite_id = '${ids.convite_a1}'`), 1, 'controle positivo');
    assert.equal(contar('automation.coletas', ids.orgA, recorte, `client_id = '${ids.clienteA2}'`), 0);
  });

  it('grava convite e item do próprio cliente, com organização inteira ou recortado', () => {
    const inserir = (recorte, cliente, rotulo) => {
      const convite = randomBytes(24).toString('base64url');
      return noContexto(
        ids.orgA,
        recorte,
        `INSERT INTO integrations.connection_invites (organization_id, client_id, kind, token, expires_at)
           VALUES ('${ids.orgA}', '${cliente}', 'oauth_self_service', '${convite}', now() + interval '7 days');
         INSERT INTO integrations.connection_invite_items (invite_id, organization_id, platform)
           SELECT id, '${ids.orgA}', 'google' FROM integrations.connection_invites WHERE token = '${convite}' RETURNING '${rotulo}'`,
      );
    };
    assert.equal(inserir('*', ids.clienteA2, 'inteira'), 'inteira');
    assert.equal(inserir(ids.clienteA1, ids.clienteA1, 'recortado'), 'recortado');
    assert.throws(() => inserir(ids.clienteA1, ids.clienteA2, 'fora'), /row-level security/);
  });

  it('não grava item de convite de cliente fora do recorte nem de outra organização', () => {
    assert.throws(
      () => noContexto(ids.orgA, ids.clienteA1, `INSERT INTO integrations.connection_invite_items (invite_id, organization_id, platform) VALUES ('${ids.convite_a2}', '${ids.orgA}', 'google')`),
      /row-level security/,
    );
    assert.throws(
      () => noContexto(ids.orgA, '*', `INSERT INTO integrations.connection_invite_items (invite_id, organization_id, platform) VALUES ('${ids.convite_b}', '${ids.orgA}', 'google')`),
      /row-level security/,
    );
  });
});
