import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, sqlDeConexao } from './helpers.mjs';

const CONTAINER = process.env.ORLA_PG_CONTAINER ?? 'orla-postgres';

function senhaDoApp() {
  if (process.env.APP_DB_PASSWORD) return process.env.APP_DB_PASSWORD;
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith('APP_DB_PASSWORD='))
    .slice('APP_DB_PASSWORD='.length);
}

const dono = (sql) =>
  execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'tria', '-qtAc', sql], {
    encoding: 'utf8',
  }).trim();

const comoApp = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoApp()}`, CONTAINER,
     'psql', '-U', 'orla_app', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

function senhaDoWorker() {
  if (process.env.WORKER_DB_PASSWORD) return process.env.WORKER_DB_PASSWORD;
  return readFileSync('.env', 'utf8')
    .split('\n')
    .find((linha) => linha.startsWith('WORKER_DB_PASSWORD='))
    .slice('WORKER_DB_PASSWORD='.length);
}

const comoWorker = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `PGPASSWORD=${senhaDoWorker()}`, CONTAINER,
     'psql', '-U', 'orla_worker', '-h', '127.0.0.1', '-d', 'tria', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

const naSessao = (organizationId, clientIds, sql) =>
  comoApp(`SET app.organization_id = '${organizationId}'; SET app.client_ids = '${clientIds}'; ${sql}`);

const umaLinha = (saida) => saida.split('\n').filter(Boolean).at(-1)?.trim() ?? '';
const marca = Date.now();
const hash = (texto) => createHash('sha256').update(texto).digest('hex');
const falhaDe = (acao) => {
  try {
    acao();
    return null;
  } catch (erro) {
    return String(erro.stderr ?? erro.message);
  }
};

function novaOrganizacao(nome) {
  return umaLinha(dono(
    `INSERT INTO core.organizations (name, slug, type) VALUES ('${nome}', '${nome.toLowerCase()}-${marca}', 'agency') RETURNING id`,
  ));
}

function conexao(org, platform, externalId, status = 'active') {
  return umaLinha(dono(sqlDeConexao({
    organizationId: org,
    platform,
    label: `${platform} ${externalId}`,
    externalId,
    status,
    comToken: status !== 'revoked',
  }).sql));
}

function canal(org, connectionId, externalId, nome = 'Canal com título') {
  return umaLinha(dono(
    `INSERT INTO integrations.connection_accounts (organization_id, connection_id, platform, external_id, name)
     VALUES ('${org}', '${connectionId}', 'youtube', '${externalId}', '${nome}') RETURNING id`,
  ));
}

describe('privacidade: revogação, expurgo do YouTube e pedidos da Meta (ADR 0029)', { concurrency: false }, () => {
  let org = '';
  let outraOrg = '';

  before(() => {
    org = novaOrganizacao('Privacidade');
    outraOrg = novaOrganizacao('Outra');
  });

  it('acesso compartilhado: a mesma pessoa em outra conexão da família, em qualquer organização, impede revogar', () => {
    const usuario = `g-${marca}`;
    const youtube = conexao(org, 'youtube', usuario);
    const naSessaoDaOrg = (id) => umaLinha(naSessao(org, '*', `SELECT integrations.acesso_compartilhado('${id}')`));

    assert.equal(naSessaoDaOrg(youtube), 'f');
    conexao(outraOrg, 'ga4', usuario);
    assert.equal(naSessaoDaOrg(youtube), 't');

    const meta = conexao(org, 'meta', usuario);
    assert.equal(naSessaoDaOrg(meta), 'f', 'família diferente não conta');

    assert.equal(umaLinha(naSessao(outraOrg, '*', `SELECT integrations.acesso_compartilhado('${youtube}')`)), 'f',
      'outra organização não descobre nada sobre a conexão');

    dono(`UPDATE integrations.connections SET status = 'revoked' WHERE organization_id = '${outraOrg}' AND external_id = '${usuario}'`);
    assert.equal(naSessaoDaOrg(youtube), 'f', 'conexão revogada não conta');
  });

  it('remover conexão do YouTube enfileira o canal sem outra autorização ativa e troca o título pelo id', () => {
    const removida = conexao(org, 'youtube', `yt-a-${marca}`);
    const outra = conexao(org, 'youtube', `yt-b-${marca}`);
    const so = canal(org, removida, `UCso${marca}`);
    canal(org, removida, `UCdois${marca}`);
    canal(org, outra, `UCdois${marca}`);

    const fila = naSessao(org, '*', `SELECT external_id FROM privacidade.enfileirar_expurgo_da_conexao('${removida}') ORDER BY 1`);
    assert.deepEqual(fila.split('\n').filter(Boolean), [`UCso${marca}`]);
    assert.equal(umaLinha(dono(`SELECT name FROM integrations.connection_accounts WHERE id = '${so}'`)), `UCso${marca}`);
    assert.equal(umaLinha(dono(
      `SELECT motivo || '|' || (apos <= now()) FROM privacidade.expurgos_de_fonte WHERE external_id = 'UCso${marca}'`)), 'conexao_removida|true');

    const repetida = naSessao(org, '*', `SELECT count(*) FROM privacidade.enfileirar_expurgo_da_conexao('${removida}')`);
    assert.equal(umaLinha(repetida), '1');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM privacidade.expurgos_de_fonte WHERE external_id = 'UCso${marca}'`)), '1');

    const erro = falhaDe(() => naSessao(outraOrg, '*', `SELECT * FROM privacidade.enfileirar_expurgo_da_conexao('${removida}')`));
    assert.match(erro ?? '', /não é da organização do contexto/);

    const id = umaLinha(dono(`SELECT id FROM privacidade.expurgos_de_fonte WHERE external_id = 'UCso${marca}'`));
    assert.ok(comoWorker(`SELECT external_id FROM privacidade.expurgos_de_fonte_vencidos(500)`).includes(`UCso${marca}`));
    comoApp(`SELECT privacidade.registrar_resultado_do_expurgo('${id}', 'quota')`);
    assert.equal(umaLinha(dono(`SELECT tentativas || '|' || ultimo_erro || '|' || (concluido_em IS NULL) FROM privacidade.expurgos_de_fonte WHERE id = '${id}'`)), '1|quota|true');
    comoApp(`SELECT privacidade.registrar_resultado_do_expurgo('${id}', NULL)`);
    assert.equal(umaLinha(dono(`SELECT concluido_em IS NOT NULL FROM privacidade.expurgos_de_fonte WHERE id = '${id}'`)), 't');

    assert.match(falhaDe(() => naSessao(org, '*', 'SELECT count(*) FROM privacidade.expurgos_de_fonte')) ?? '', /permission denied/,
      'a fila só é lida pelas funções');
  });

  it('job do YouTube: título velho vira id, canal sem autorização entra com 7 dias de carência e sai se voltar a ter', () => {
    const parada = conexao(org, 'youtube', `yt-c-${marca}`, 'reauth_pending');
    dono(`UPDATE integrations.connections SET status_desde = now() - interval '31 days' WHERE id = '${parada}'`);
    const velho = canal(org, parada, `UCvelho${marca}`);
    dono(`UPDATE integrations.connection_accounts SET discovered_at = now() - interval '31 days' WHERE id = '${velho}'`);

    assert.match(falhaDe(() => comoApp('SELECT privacidade.preparar_conformidade_youtube()')) ?? '', /permission denied/,
      'a web não roda o job que atravessa inquilinos (ADR 0028)');
    assert.match(falhaDe(() => comoApp('SELECT * FROM privacidade.expurgos_de_fonte_vencidos(1)')) ?? '', /permission denied/);
    const resumo = JSON.parse(comoWorker('SELECT privacidade.preparar_conformidade_youtube()'));
    assert.ok(resumo.nomesTrocadosPeloId >= 1);
    assert.equal(umaLinha(dono(`SELECT name FROM integrations.connection_accounts WHERE id = '${velho}'`)), `UCvelho${marca}`);
    assert.equal(umaLinha(dono(
      `SELECT motivo || '|' || (apos > now() + interval '6 days') FROM privacidade.expurgos_de_fonte
       WHERE external_id = 'UCvelho${marca}' AND concluido_em IS NULL AND cancelado_em IS NULL`)), 'sem_autorizacao_ativa|true');
    assert.ok(!comoWorker('SELECT external_id FROM privacidade.expurgos_de_fonte_vencidos(500)').includes(`UCvelho${marca}`));

    comoWorker('SELECT privacidade.preparar_conformidade_youtube()');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM privacidade.expurgos_de_fonte WHERE external_id = 'UCvelho${marca}'`)), '1');

    dono(`UPDATE integrations.connections SET status = 'active' WHERE id = '${parada}'`);
    comoWorker('SELECT privacidade.preparar_conformidade_youtube()');
    assert.equal(umaLinha(dono(
      `SELECT cancelado_em IS NOT NULL FROM privacidade.expurgos_de_fonte WHERE external_id = 'UCvelho${marca}'`)), 't');
  });

  it('reauth_pending e degraded recentes ainda contam como autorização: nada é enfileirado', () => {
    const reautorizar = conexao(org, 'youtube', `yt-r-${marca}`, 'reauth_pending');
    const degradada = conexao(org, 'youtube', `yt-d-${marca}`, 'degraded');
    canal(org, reautorizar, `UCreauth${marca}`);
    canal(org, degradada, `UCdegradado${marca}`);
    dono(`UPDATE integrations.connections SET status_desde = now() - interval '8 days' WHERE id IN ('${reautorizar}', '${degradada}')`);

    comoWorker('SELECT privacidade.preparar_conformidade_youtube()');
    assert.equal(umaLinha(dono(
      `SELECT count(*) FROM privacidade.expurgos_de_fonte WHERE external_id IN ('UCreauth${marca}', 'UCdegradado${marca}')`)), '0',
      'reautorizar no dia 8 não pode encontrar os dados apagados');

    const revogada = conexao(org, 'youtube', `yt-v-${marca}`, 'revoked');
    canal(org, revogada, `UCrevogado${marca}`);
    comoWorker('SELECT privacidade.preparar_conformidade_youtube()');
    assert.equal(umaLinha(dono(
      `SELECT count(*) FROM privacidade.expurgos_de_fonte WHERE external_id = 'UCrevogado${marca}' AND cancelado_em IS NULL`)), '1',
      'revogada não conta como autorização');
  });

  it('depois da 0123 não há corte em andamento: reauth_pending vencida entra na fila e o expurgo segue normal', () => {
    assert.equal(umaLinha(dono(`SELECT to_regclass('integrations.corte_para_cofre_refs') IS NULL`)), 't');
    const vencida = conexao(org, 'youtube', `yt-corte-${marca}`, 'active');
    canal(org, vencida, `UCcorte${marca}`);
    const jaNaFila = conexao(org, 'youtube', `yt-fila-${marca}`, 'revoked');
    canal(org, jaNaFila, `UCfila${marca}`);
    comoWorker('SELECT privacidade.preparar_conformidade_youtube()');
    dono(`UPDATE privacidade.expurgos_de_fonte SET apos = now() - interval '1 minute' WHERE external_id = 'UCfila${marca}'`);
    dono(`UPDATE integrations.connections SET status = 'reauth_pending' WHERE id = '${vencida}'`);
    dono(`UPDATE integrations.connections SET status_desde = now() - interval '60 days' WHERE id = '${vencida}'`);

    const resumo = JSON.parse(comoWorker('SELECT privacidade.preparar_conformidade_youtube()'));
    assert.equal(resumo.pausadoPeloCorte, false);
    assert.equal(umaLinha(dono(`SELECT count(*) FROM privacidade.expurgos_de_fonte WHERE external_id = 'UCcorte${marca}'`)), '1');
    assert.ok(comoWorker('SELECT external_id FROM privacidade.expurgos_de_fonte_vencidos(500)').includes(`UCfila${marca}`),
      'sem corte, o expurgo da conexão revogada é executado');
  });

  it('pedido de exclusão da Meta com a pimenta dedicada migra o pseudônimo antigo e mantém o código', () => {
    const usuario = String(marca + 7).slice(-9);
    conexao(org, 'meta', usuario);
    const antigo = hash(`sessao-${usuario}`);
    const novo = hash(`pimenta-${usuario}`);
    const codigo = `MIGRA${hash(`m-${marca}`).slice(0, 18)}`.toUpperCase();
    const primeiro = umaLinha(comoApp(
      `SELECT codigo FROM privacidade.registrar_pedido_de_exclusao_meta('${antigo}', '${usuario}', '${codigo}')`));
    assert.equal(primeiro, codigo);
    const segundo = umaLinha(comoApp(
      `SELECT codigo || '|' || novo FROM privacidade.registrar_pedido_de_exclusao_meta('${novo}', ARRAY['${antigo}'], '${usuario}', 'OUTRO${codigo}')`));
    assert.equal(segundo, `${codigo}|false`);
    assert.equal(umaLinha(dono(`SELECT usuario_externo_hash FROM privacidade.pedidos_de_exclusao WHERE codigo_de_confirmacao = '${codigo}'`)), novo);
    assert.match(falhaDe(() => comoApp(
      `SELECT * FROM privacidade.registrar_pedido_de_exclusao_meta('nao-hex', ARRAY[]::text[], '${usuario}', 'X${codigo}')`)) ?? '', /pseudônimo inválido/);
  });

  it('pedido de exclusão da Meta: idempotente por usuário, liga as conexões da Meta e não guarda o id', () => {
    const usuario = String(marca).slice(-9);
    const meta = conexao(org, 'meta', usuario);
    const pixelOutraOrg = conexao(outraOrg, 'pixel', usuario);
    const google = conexao(org, 'google', usuario);
    const pseudonimo = hash(`teste-${usuario}`);
    const codigo = `PEDIDO${hash(`codigo-${marca}`).slice(0, 18)}`.toUpperCase();

    const primeiro = umaLinha(comoApp(
      `SELECT codigo || '|' || situacao || '|' || novo FROM privacidade.registrar_pedido_de_exclusao_meta('${pseudonimo}', '${usuario}', '${codigo}')`));
    assert.equal(primeiro, `${codigo}|pendente|true`);
    const segundo = umaLinha(comoApp(
      `SELECT codigo || '|' || novo FROM privacidade.registrar_pedido_de_exclusao_meta('${pseudonimo}', '${usuario}', 'OUTROCODIGO0000000000')`));
    assert.equal(segundo, `${codigo}|false`);

    assert.equal(umaLinha(dono(`SELECT count(*) FROM privacidade.pedidos_de_exclusao WHERE usuario_externo_hash = '${pseudonimo}'`)), '1');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM privacidade.pedidos_de_exclusao WHERE usuario_externo_hash = '${usuario}' OR codigo_de_confirmacao LIKE '%${usuario}%'`)), '0');
    const ligadas = dono(`SELECT connection_id FROM privacidade.pedidos_de_exclusao_conexoes l JOIN privacidade.pedidos_de_exclusao p ON p.id = l.pedido_id WHERE p.codigo_de_confirmacao = '${codigo}' ORDER BY 1`);
    assert.deepEqual(ligadas.split('\n').filter(Boolean).sort(), [meta, pixelOutraOrg].sort());
    assert.ok(!ligadas.includes(google));
    assert.equal(umaLinha(dono(
      `SELECT count(*) FROM audit.audit_log WHERE action = 'privacidade.pedido_de_exclusao_recebido' AND metadata ->> 'codigo' = '${codigo}'`)), '2');

    assert.equal(umaLinha(comoApp(`SELECT situacao FROM privacidade.situacao_do_pedido_de_exclusao('${codigo}')`)), 'pendente');
    assert.equal(umaLinha(naSessao(org, '*', `SELECT count(*) FROM privacidade.pedidos_de_exclusao WHERE codigo_de_confirmacao = '${codigo}'`)), '1');
    assert.equal(umaLinha(naSessao(org, '00000000-0000-4000-8000-000000000000', `SELECT count(*) FROM privacidade.pedidos_de_exclusao_conexoes`)), '0', 'recorte não vê');

    assert.match(falhaDe(() => comoApp(`SELECT privacidade.atualizar_pedido_de_exclusao('${codigo}', 'concluido', 'x', 'app')`)) ?? '', /permission denied/);
    assert.match(falhaDe(() => dono(`SELECT privacidade.atualizar_pedido_de_exclusao('${codigo}', 'concluido', '', 'teste')`)) ?? '', /evidência/);
    dono(`SELECT privacidade.atualizar_pedido_de_exclusao('${codigo}', 'concluido', 'conexões removidas', 'teste')`);
    assert.equal(umaLinha(comoApp(`SELECT situacao FROM privacidade.situacao_do_pedido_de_exclusao('${codigo}')`)), 'concluido');

    const novo = umaLinha(comoApp(
      `SELECT novo FROM privacidade.registrar_pedido_de_exclusao_meta('${pseudonimo}', '${usuario}', 'NOVOPEDIDO${String(marca).slice(-10)}')`));
    assert.equal(novo, 't', 'pedido concluído não bloqueia um novo');
  });

  it('o callback da Meta é público e recusa pedido sem signed_request válido; a página de situação não vaza código desconhecido', async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    const resposta = await fetch(`${BASE}/api/meta/exclusao`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'signed_request=AAAA.BBBB',
      redirect: 'manual',
    });
    assert.ok([400, 401, 503].includes(resposta.status), `status ${resposta.status}`);

    const semCorpo = await fetch(`${BASE}/api/meta/exclusao`, { method: 'POST', redirect: 'manual' });
    assert.ok([400, 503].includes(semCorpo.status) || semCorpo.status === 400, `status ${semCorpo.status}`);

    const situacao = await fetch(`${BASE}/exclusao-de-dados/status/NAOEXISTE0000000000000`, { redirect: 'manual' });
    assert.equal(situacao.status, 404);
  });
});

describe('posse legada: ids preenchidos só quando o nome não é ambíguo (ADR 0029)', { concurrency: false }, () => {
  it('preenche deId por nome único (inclusive nome antigo de cliente renomeado) e deixa ambíguo sem id', () => {
    const org = novaOrganizacao('Posse');
    const cliente = (nome) => umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome}', 'leads') RETURNING id`));
    const unico = cliente('Único');
    const homonimoExcluido = cliente('Repetido');
    dono(`SELECT core.excluir_cliente('${homonimoExcluido}', 'teste')`);
    cliente('Repetido');
    const renomeado = cliente('Nome Atual');

    const linha = (acao, metadata) => umaLinha(dono(
      `INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
       VALUES ('${org}', 'user', '${acao}', 'connection_account', 'x', '${JSON.stringify(metadata)}'::jsonb) RETURNING id`));

    const legadoUnico = linha('connection_account.unlink', { de: 'Único' });
    const preenchidoErrado = linha('connection_account.unlink', { de: 'Repetido', deId: unico, idsPreenchidosPela: '0080' });
    const legadoAmbiguo = linha('connection_account.unlink', { de: 'Repetido' });
    linha('connection_account.reassigned', { de: 'Nome Antigo', deId: renomeado, para: 'X', paraId: unico });
    const legadoRenomeado = linha('ad_account.unlinked', { de: 'Nome Antigo' });
    const legadoDesconhecido = linha('connection_account.unlink', { de: 'Nunca Existiu' });
    const legadoLink = linha('connection_account.link', { cliente: 'Único' });

    dono('SELECT automation.preencher_ids_de_posse_legados()');
    const metadata = (id) => JSON.parse(umaLinha(dono(`SELECT metadata FROM audit.audit_log WHERE id = '${id}'`)));

    assert.equal(metadata(legadoUnico).deId, unico);
    assert.equal(metadata(legadoUnico).idsPreenchidosPela, '0133');
    assert.equal(metadata(legadoAmbiguo).deId, undefined);
    assert.equal(metadata(legadoAmbiguo).posseDesconhecida, true);
    assert.equal(metadata(preenchidoErrado).deId, undefined, 'o corretivo tira o id que a 0080 pôs por nome ambíguo');
    assert.deepEqual(metadata(preenchidoErrado).idsRemovidos, { deId: unico });
    assert.equal(metadata(legadoRenomeado).deId, renomeado);
    assert.equal(metadata(legadoDesconhecido).deId, undefined);
    assert.equal(metadata(legadoLink).clientId, unico);

    assert.equal(umaLinha(dono(`SELECT automation.dono_anterior_da_auditoria('${org}', metadata) FROM audit.audit_log WHERE id = '${legadoRenomeado}'`)), renomeado);
    assert.equal(umaLinha(dono(`SELECT automation.dono_anterior_da_auditoria('${org}', metadata) IS NULL FROM audit.audit_log WHERE id = '${legadoAmbiguo}'`)), 't');
    assert.match(falhaDe(() => comoApp('SELECT automation.preencher_ids_de_posse_legados()')) ?? '', /permission denied/);
    const repetida = JSON.parse(dono('SELECT automation.preencher_ids_de_posse_legados()'));
    assert.deepEqual(repetida, { linhasCorrigidas: 0, idsPreenchidos: 0, posseDesconhecida: 0 }, 'idempotente');
  });

  it('cliente renomeado e outro cliente com o nome antigo: a linha antiga não vai para quem herdou o nome', () => {
    const org = novaOrganizacao('Homonimo');
    const cliente = (nome) => umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome}', 'leads') RETURNING id`));
    const linha = (metadata, atras) => umaLinha(dono(
      `INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata, occurred_at)
       VALUES ('${org}', 'user', 'connection_account.unlink', 'connection_account', 'x', '${JSON.stringify(metadata)}'::jsonb,
               now() - interval '${atras}') RETURNING id`));
    const metadata = (id) => JSON.parse(umaLinha(dono(`SELECT metadata FROM audit.audit_log WHERE id = '${id}'`)));

    const renomeado = cliente('Loja Velha');
    const comEvidencia = linha({ de: 'Loja Velha' }, '1 second');
    dono(`UPDATE core.clients SET name = 'Loja Nova' WHERE id = '${renomeado}'`);
    assert.equal(umaLinha(dono(
      `SELECT metadata ->> 'de' || '>' || (metadata ->> 'para') FROM audit.audit_log WHERE action = 'client.renamed' AND target_id = '${renomeado}'`)),
      'Loja Velha>Loja Nova', 'renomear vira evidência na trilha');
    const herdeiro = cliente('Loja Velha');

    const semEvidencia = cliente('Antiga Sem Trilha');
    const antiga = linha({ de: 'Antiga Sem Trilha' }, '1 second');
    dono(`ALTER TABLE core.clients DISABLE TRIGGER clients_registrar_renomeacao;
          UPDATE core.clients SET name = 'Atual Sem Trilha' WHERE id = '${semEvidencia}';
          ALTER TABLE core.clients ENABLE TRIGGER clients_registrar_renomeacao;`);
    cliente('Antiga Sem Trilha');

    dono('SELECT automation.preencher_ids_de_posse_legados()');
    assert.equal(metadata(comEvidencia).deId, undefined, 'nome que passou por dois clientes é ambíguo');
    assert.equal(metadata(comEvidencia).posseDesconhecida, true);
    assert.equal(metadata(antiga).deId, undefined, 'cliente criado depois da linha não pode ser o dono dela');
    assert.equal(umaLinha(dono(`SELECT automation.dono_anterior_da_auditoria('${org}', metadata) IS NULL FROM audit.audit_log WHERE id = '${antiga}'`)), 't');
    assert.notEqual(metadata(comEvidencia).deId, herdeiro);
  });
});

describe('exclusão e expurgo vistos de fora (ADR 0022, 0023)', { concurrency: false }, () => {
  it('quem tem recorte de clientes não vê cliente excluído, nem o próprio, nem o que pende dele', () => {
    const org = novaOrganizacao('Recorte');
    const novo = (nome) => umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome}', 'leads') RETURNING id`));
    const a = novo('Recortado A');
    const b = novo('Recortado B');
    const con = conexao(org, 'google', `rec-${marca}`);
    const conta = umaLinha(dono(
      `INSERT INTO integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
       VALUES ('${org}', '${a}', '${con}', 'google', '321-${String(marca).slice(-3)}-0001', 'Conta A') RETURNING id`));

    assert.equal(umaLinha(naSessao(org, a, 'SELECT count(*) FROM core.clients')), '1');
    assert.equal(umaLinha(naSessao(org, a, `SELECT count(*) FROM integrations.ad_accounts WHERE id = '${conta}'`)), '1');

    dono(`SELECT core.excluir_cliente('${a}', 'teste')`);
    assert.equal(umaLinha(naSessao(org, a, 'SELECT count(*) FROM core.clients')), '0');
    assert.equal(umaLinha(naSessao(org, a, `SELECT count(*) FROM integrations.ad_accounts WHERE id = '${conta}'`)), '0');
    assert.equal(umaLinha(naSessao(org, `${a},${b}`, `SELECT count(*) FROM core.clients WHERE id = '${a}'`)), '0');
    assert.equal(umaLinha(naSessao(org, b, `SELECT count(*) FROM core.clients WHERE id = '${a}'`)), '0');
    assert.match(
      falhaDe(() => naSessao(org, a, `UPDATE core.clients SET name = 'invadido' WHERE id = '${a}' RETURNING id`)) ?? 'sem efeito',
      /sem efeito|policy|permission/,
    );
    assert.equal(umaLinha(dono(`SELECT name FROM core.clients WHERE id = '${a}'`)), 'Recortado A');
  });

  it('o expurgo nunca toca o homônimo: trilha, contas e recursos do outro cliente com o mesmo nome ficam', () => {
    const org = novaOrganizacao('Homonimos');
    const cliente = (nome) => umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome}', 'leads') RETURNING id`));
    const expurgado = cliente('Mesmo Nome');
    dono(`SELECT core.excluir_cliente('${expurgado}', 'teste')`);
    const homonimo = cliente('Mesmo Nome');
    const con = conexao(org, 'google', `hom-${marca}`);
    const contaDoHomonimo = umaLinha(dono(
      `INSERT INTO integrations.ad_accounts (organization_id, client_id, connection_id, platform, external_id, name)
       VALUES ('${org}', '${homonimo}', '${con}', 'google', '654-${String(marca).slice(-3)}-0002', 'Conta H') RETURNING id`));

    const linha = (metadata) => umaLinha(dono(
      `INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
       VALUES ('${org}', 'user', 'connection_account.unlink', 'connection_account', 'x', '${JSON.stringify(metadata)}'::jsonb) RETURNING id`));
    const doHomonimo = linha({ de: 'Mesmo Nome', deId: homonimo });
    const semId = linha({ de: 'Mesmo Nome' });
    const doExpurgado = linha({ de: 'Mesmo Nome', deId: expurgado });

    dono(`SELECT core.expurgar_cliente('${expurgado}')`);
    const de = (id) => umaLinha(dono(`SELECT metadata ->> 'de' FROM audit.audit_log WHERE id = '${id}'`));
    assert.equal(de(doHomonimo), 'Mesmo Nome');
    assert.equal(de(semId), 'Mesmo Nome');
    assert.equal(de(doExpurgado), '[cliente expurgado]');
    assert.equal(umaLinha(dono(`SELECT client_id FROM integrations.ad_accounts WHERE id = '${contaDoHomonimo}'`)), homonimo);
    assert.equal(umaLinha(dono(`SELECT count(*) FROM core.clients WHERE id = '${homonimo}'`)), '1');
  });
});
