import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { request as pedidoHttp } from 'node:http';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, env as ambiente } from './helpers.mjs';

const CONTAINER = process.env.TRIA_TEST_PG ?? process.env.ORLA_PG_CONTAINER ?? 'orla-postgres';

function senhaDoApp() {
  if (process.env.APP_DB_PASSWORD) return process.env.APP_DB_PASSWORD;
  if (!existsSync('.env')) throw new Error('Sem .env nem APP_DB_PASSWORD para entrar como o papel do app.');
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
     'psql', '-U', 'orla_app', '-h', '127.0.0.1', '-d', 'tria', '-v', 'ON_ERROR_STOP=1', '-qtAc', sql],
    { encoding: 'utf8' },
  ).trim();

const naOrg = (org, sql) =>
  comoApp(`SET app.organization_id = '${org}'; SET app.client_ids = '*'; SET app.user_id = ''; ${sql}`);

const publico = (sql) =>
  comoApp(`SET app.organization_id = ''; SET app.client_ids = ''; SET app.user_id = ''; ${sql}`);

const umaLinha = (texto) => texto.split('\n')[0].trim();

const recusa = (fn) => {
  try {
    fn();
    return null;
  } catch (falha) {
    return String(falha.stderr ?? falha.message);
  }
};

const novoToken = () => randomBytes(32).toString('base64url');
const hash = (token) => createHash('sha256').update(token).digest('hex');
const marca = Date.now();

function criarLink(org, cliente, secoes, extra = '') {
  const token = novoToken();
  const colunas = extra ? `, ${extra.split('=')[0]}` : '';
  const valores = extra ? `, ${extra.split('=').slice(1).join('=')}` : '';
  const id = umaLinha(naOrg(org, `
    INSERT INTO core.client_context_links (organization_id, client_id, token_hash, sections, expires_at${colunas})
    VALUES ('${org}', '${cliente}', '${hash(token)}', ARRAY[${secoes.map((s) => `'${s}'`).join(',')}],
            now() + interval '30 days'${valores})
    RETURNING id`));
  return { id, token, hash: hash(token) };
}

const salvarCampo = (h, secao, chave, valor, versao, epistemico = 'fato') =>
  umaLinha(publico(
    `SELECT resultado || ':' || coalesce(versao::text, '-') FROM core.contexto_link_salvar_campo(
       '${h}', '${secao}', '${chave}', ${valor === null ? 'NULL' : `'${JSON.stringify(valor)}'::jsonb`},
       '${epistemico}', ${versao})`,
  ));

describe('contexto do cliente no banco', { concurrency: false }, () => {
  let orgA = '';
  let orgB = '';
  let clienteA = '';
  let clienteA2 = '';
  let clienteB = '';

  before(() => {
    orgA = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Ctx A', 'ctx-a-${marca}', 'agency') RETURNING id`,
    ));
    orgB = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Ctx B', 'ctx-b-${marca}', 'agency') RETURNING id`,
    ));
    const cliente = (org, nome) => umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', '${nome}', 'leads') RETURNING id`,
    ));
    clienteA = cliente(orgA, 'Padaria A');
    clienteA2 = cliente(orgA, 'Padaria A2');
    clienteB = cliente(orgB, 'Padaria B');
  });

  it('isola o contexto entre organizações', () => {
    naOrg(orgA, `INSERT INTO core.client_context_entries (organization_id, client_id, section, field_key, value)
                 VALUES ('${orgA}', '${clienteA}', 'empresa', 'segmento', '"padaria"')`);

    assert.equal(umaLinha(naOrg(orgA, `SELECT count(*) FROM core.client_context_entries WHERE client_id = '${clienteA}'`)), '1');
    assert.equal(umaLinha(naOrg(orgB, `SELECT count(*) FROM core.client_context_entries WHERE client_id = '${clienteA}'`)), '0');

    const erro = recusa(() => naOrg(orgB,
      `INSERT INTO core.client_context_entries (organization_id, client_id, section, field_key, value)
       VALUES ('${orgB}', '${clienteA}', 'empresa', 'cidade', '"Recife"')`));
    assert.ok(erro && /row-level security|policy/i.test(erro), erro ?? 'gravou em cliente de outra organização');
  });

  it('cada mudança vira revisão escrita só pelo gatilho; o app não escreve histórico', () => {
    naOrg(orgA, `UPDATE core.client_context_entries SET value = '"padaria artesanal"', version = version + 1
                 WHERE client_id = '${clienteA}' AND field_key = 'segmento'`);
    const ops = naOrg(orgA, `SELECT string_agg(operation, ',' ORDER BY occurred_at) FROM core.client_context_revisions
                             WHERE client_id = '${clienteA}' AND key = 'segmento'`);
    assert.equal(umaLinha(ops), 'criar,alterar');
    assert.equal(umaLinha(dono(`SELECT has_table_privilege('orla_app', 'core.client_context_revisions', 'INSERT')`)), 'f');
    assert.equal(umaLinha(dono(`SELECT has_table_privilege('orla_app', 'core.client_context_revisions', 'DELETE')`)), 'f');
    assert.ok(Number(umaLinha(dono(`SELECT count(*) FROM core.client_context_brain WHERE client_id = '${clienteA}'`))) === 1);
  });

  it('a trava otimista recusa gravar sobre versão velha', () => {
    const alteradas = naOrg(orgA, `WITH u AS (UPDATE core.client_context_entries SET value = '"x"', version = version + 1
                                   WHERE client_id = '${clienteA}' AND field_key = 'segmento' AND version = 1 RETURNING 1)
                                   SELECT count(*) FROM u`);
    assert.equal(umaLinha(alteradas), '0');
  });

  it('o token nunca fica guardado em claro', () => {
    const link = criarLink(orgA, clienteA, ['empresa']);
    assert.equal(umaLinha(dono(`SELECT count(*) FROM core.client_context_links l WHERE to_jsonb(l)::text LIKE '%${link.token}%'`)), '0');
    const erro = recusa(() => criarLink(orgA, clienteA, ['empresa'], "token_hash='abc'"));
    assert.ok(erro, 'aceitou token_hash que não é SHA-256');
  });

  it('o link resolve só pelo hash certo e só para o próprio cliente', () => {
    const link = criarLink(orgA, clienteA, ['empresa']);
    assert.equal(umaLinha(publico(`SELECT client_id FROM core.contexto_link_abrir('${link.hash}')`)), clienteA);
    assert.equal(publico(`SELECT client_id FROM core.contexto_link_abrir('${hash(novoToken())}')`), '');
    assert.equal(publico(`SELECT count(*) FROM core.client_context_entries`), '0', 'sem sessão não lê tabela nenhuma');
  });

  it('o link grava com versão, só nas seções dele e com fonte cliente', () => {
    const link = criarLink(orgA, clienteA, ['empresa']);
    assert.equal(salvarCampo(link.hash, 'empresa', 'cidade', 'Recife', 0), 'ok:1');
    assert.equal(salvarCampo(link.hash, 'empresa', 'cidade', 'Olinda', 0), 'conflito:1');
    assert.equal(salvarCampo(link.hash, 'empresa', 'cidade', 'Olinda', 1), 'ok:2');
    assert.equal(salvarCampo(link.hash, 'marca', 'tagline', 'Pão bom', 0), 'fora_do_escopo:-');
    assert.equal(salvarCampo(link.hash, 'marca', 'cidade', 'X', 2), 'fora_do_escopo:-');
    assert.equal(
      umaLinha(dono(`SELECT source || ',' || shareable FROM core.client_context_entries
                     WHERE client_id = '${clienteA}' AND field_key = 'cidade'`)),
      'cliente,true',
    );
    assert.equal(
      umaLinha(dono(`SELECT count(*) FROM core.client_context_revisions
                     WHERE client_id = '${clienteA}' AND key = 'cidade' AND via_link_id = '${link.id}'`)),
      '2',
    );
  });

  it('o cliente não vê nota interna, hipótese, valor não compartilhado nem outra seção', () => {
    naOrg(orgA, `INSERT INTO core.client_context_entries
                   (organization_id, client_id, section, field_key, value, shareable, epistemic)
                 VALUES ('${orgA}', '${clienteA}', 'empresa', 'notas_internas_empresa', '"segredo"', false, 'hipotese'),
                        ('${orgA}', '${clienteA}', 'empresa', 'missao', '"hipótese da equipe"', true, 'hipotese'),
                        ('${orgA}', '${clienteA}', 'empresa', 'valores', '"compartilhado"', true, 'fato'),
                        ('${orgA}', '${clienteA}', 'marca', 'tagline', '"de outra seção"', true, 'fato')`);
    const link = criarLink(orgA, clienteA, ['empresa']);
    const visto = JSON.parse(umaLinha(publico(
      `SELECT core.contexto_link_ler('${link.hash}', ARRAY['notas_internas_empresa','missao','valores','tagline','cidade'])`,
    )));
    const chaves = visto.campos.map((c) => c.field_key).sort();
    assert.deepEqual(chaves, ['cidade', 'valores']);
    assert.ok(!JSON.stringify(visto).includes('segredo'));
  });

  it('valor que o cliente não via é substituído pelo dele e o da equipe fica na revisão', () => {
    const link = criarLink(orgA, clienteA, ['empresa']);
    assert.equal(salvarCampo(link.hash, 'empresa', 'missao', 'Missão do cliente', 0), 'ok:2');
    assert.equal(
      umaLinha(dono(`SELECT before->>'value' FROM core.client_context_revisions
                     WHERE client_id = '${clienteA}' AND key = 'missao' AND operation = 'alterar'`)),
      'hipótese da equipe',
    );
  });

  it('itens: o link cria e altera os do cliente, não alcança item de outro cliente e só remove o que é dele', () => {
    const link = criarLink(orgA, clienteA, ['presenca_digital']);
    const criado = umaLinha(publico(`SELECT resultado || '|' || item_id || '|' || versao FROM core.contexto_link_salvar_item(
      '${link.hash}', 'presenca_digital', 'redes_sociais', NULL, '{"rede":"instagram","perfil":"@padaria"}', 'fato', 0)`));
    const [resultado, itemId] = criado.split('|');
    assert.equal(resultado, 'ok');

    const alheio = umaLinha(dono(`INSERT INTO core.client_context_items
      (organization_id, client_id, section, list_key, position, data, shareable)
      VALUES ('${orgA}', '${clienteA2}', 'presenca_digital', 'redes_sociais', 0, '{"rede":"tiktok"}', true) RETURNING id`));
    assert.equal(umaLinha(publico(`SELECT resultado FROM core.contexto_link_salvar_item(
      '${link.hash}', 'presenca_digital', 'redes_sociais', '${alheio}', '{"rede":"x"}', 'fato', 1)`)), 'nao_encontrado');

    const daEquipe = umaLinha(dono(`INSERT INTO core.client_context_items
      (organization_id, client_id, section, list_key, position, data, shareable)
      VALUES ('${orgA}', '${clienteA}', 'presenca_digital', 'redes_sociais', 5, '{"rede":"youtube"}', true) RETURNING id`));
    assert.equal(umaLinha(publico(`SELECT core.contexto_link_remover_item('${link.hash}', '${daEquipe}', 1)`)), 'nao_encontrado');
    assert.equal(umaLinha(publico(`SELECT core.contexto_link_remover_item('${link.hash}', '${itemId}', 9)`)), 'conflito');
    assert.equal(umaLinha(publico(`SELECT core.contexto_link_remover_item('${link.hash}', '${itemId}', 1)`)), 'ok');
  });

  it('link vencido ou revogado é recusado', () => {
    const vencido = criarLink(orgA, clienteA, ['empresa']);
    dono(`UPDATE core.client_context_links SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
          WHERE id = '${vencido.id}'`);
    assert.equal(publico(`SELECT client_id FROM core.contexto_link_abrir('${vencido.hash}')`), '');
    assert.equal(salvarCampo(vencido.hash, 'empresa', 'cidade', 'X', 2), 'recusado:-');

    const revogado = criarLink(orgA, clienteA, ['empresa']);
    naOrg(orgA, `UPDATE core.client_context_links SET revoked_at = now() WHERE id = '${revogado.id}'`);
    assert.equal(publico(`SELECT client_id FROM core.contexto_link_abrir('${revogado.hash}')`), '');
    assert.equal(umaLinha(publico(`SELECT coalesce(core.contexto_link_concluir('${revogado.hash}')::text, 'nulo')`)), 'nulo');
  });

  it('arquivo só registra com reserva prévia, dentro do prefixo do cliente, da cota e do orçamento do link', () => {
    const link = criarLink(orgA, clienteA, ['marca']);
    const prefixo = `orgs/${orgA}/clientes/${clienteA}/arquivos/`;
    const reservar = (id, caminho, tamanho, cota = 524288000, orcamento = 209715200, envios = 60) => umaLinha(publico(
      `SELECT core.contexto_link_reservar_arquivo('${link.hash}', '${id}', 'marca', NULL, '${caminho}', ${tamanho},
         ${cota}, ${orcamento}, ${envios})`,
    ));
    const confirmar = (id, tamanho) => umaLinha(publico(
      `SELECT core.contexto_link_confirmar_arquivo('${link.hash}', '${id}', 'marca', 'logo', NULL, 'logo.png', 'image/png',
         ${tamanho}, '${'a'.repeat(64)}')`,
    ));
    const id = () => umaLinha(dono('SELECT gen_random_uuid()'));

    const primeiro = id();
    assert.equal(reservar(primeiro, `${prefixo}${primeiro}-logo.png`, 1000), 'ok');
    assert.equal(confirmar(primeiro, 1001), 'reserva_invalida', 'não confirma mais bytes do que reservou');
    assert.equal(confirmar(primeiro, 1000), 'ok');
    assert.equal(confirmar(primeiro, 1000), 'reserva_invalida', 'reserva consumida não serve de novo');

    const segundo = id();
    assert.equal(reservar(segundo, `${prefixo}${segundo}-b.png`, 1000, 1500), 'cota_excedida');
    const terceiro = id();
    assert.equal(reservar(terceiro, `${prefixo}${terceiro}-c.png`, 1000, 524288000, 1500), 'orcamento_excedido',
      'o orçamento do link conta os bytes da última hora');
    assert.equal(reservar(terceiro, `${prefixo}${terceiro}-c.png`, 10, 524288000, 209715200, 1), 'orcamento_excedido',
      'e o número de envios');
    assert.equal(reservar(terceiro, `${prefixo}${terceiro}-c.png`, 0), 'tamanho_invalido');

    const outroCliente = recusa(() => reservar(id(), `orgs/${orgB}/clientes/${clienteB}/arquivos/x.png`, 10));
    assert.ok(outroCliente && /no_prefixo/.test(outroCliente), outroCliente ?? 'reservou caminho de outro cliente');
    assert.match(recusa(() => reservar('nao-e-uuid', `${prefixo}x.png`, 10)) ?? '', /uuid/i);
    assert.match(
      recusa(() => publico(`SELECT core.contexto_link_registrar_arquivo('${link.hash}', gen_random_uuid(), 'marca', 'logo', NULL,
        '${prefixo}y.png', 'y.png', 'image/png', 10, '${'a'.repeat(64)}', 524288000)`)) ?? '',
      /permission denied/, 'o registro antigo, sem reserva, não está mais com o app');

    const semReserva = recusa(() => naOrg(orgA, `INSERT INTO core.client_context_files
      (id, organization_id, client_id, section, field_key, object_path, filename, mime, size_bytes, sha256, source)
      VALUES (gen_random_uuid(), '${orgA}', '${clienteA}', 'marca', 'logo', '${prefixo}z.png', 'z.png', 'image/png', 10, '${'a'.repeat(64)}', 'equipe')`));
    assert.ok(semReserva && /reserva/.test(semReserva), semReserva ?? 'gravou arquivo sem reserva');

    const liberada = id();
    assert.equal(reservar(liberada, `${prefixo}${liberada}-d.png`, 10), 'ok');
    assert.equal(umaLinha(publico(`SELECT core.contexto_link_liberar_reserva('${link.hash}', '${liberada}')`)), 't');
    assert.equal(confirmar(liberada, 10), 'reserva_invalida');
  });

  it('a equipe também reserva antes de gravar, sob a mesma cota', () => {
    const prefixo = `orgs/${orgA}/clientes/${clienteA}/arquivos/`;
    const novo = umaLinha(dono('SELECT gen_random_uuid()'));
    assert.equal(umaLinha(naOrg(orgA,
      `SELECT core.contexto_reservar_arquivo_da_equipe('${clienteA}', '${novo}', '${prefixo}${novo}-e.png', 10, 524288000)`)), 'ok');
    assert.equal(umaLinha(naOrg(orgA,
      `SELECT core.contexto_reservar_arquivo_da_equipe('${clienteA}', gen_random_uuid(), '${prefixo}f.png', 10, 5)`)), 'cota_excedida');
    assert.equal(umaLinha(naOrg(orgB,
      `SELECT core.contexto_reservar_arquivo_da_equipe('${clienteA}', gen_random_uuid(), '${prefixo}g.png', 10, 524288000)`)), 'recusado');
    naOrg(orgA, `INSERT INTO core.client_context_files
      (id, organization_id, client_id, section, field_key, object_path, filename, mime, size_bytes, sha256, source)
      VALUES ('${novo}', '${orgA}', '${clienteA}', 'marca', 'logo', '${prefixo}${novo}-e.png', 'e.png', 'image/png', 10, '${'a'.repeat(64)}', 'equipe')`);
    assert.equal(umaLinha(dono(`SELECT consumida_em IS NOT NULL FROM core.client_context_file_reservations WHERE id = '${novo}'`)), 't');
  });

  it('a varredura vê reserva vencida e não consumida e a trava do bucket só libera cliente excluído ou expurgado', () => {
    const prefixo = `orgs/${orgA}/clientes/${clienteA}/arquivos/`;
    const velha = umaLinha(dono('SELECT gen_random_uuid()'));
    dono(`INSERT INTO core.client_context_file_reservations (id, organization_id, client_id, object_path, size_bytes, criada_em, vence_em)
          VALUES ('${velha}', '${orgA}', '${clienteA}', '${prefixo}${velha}-velha.png', 10, now() - interval '2 hours', now() - interval '100 minutes')`);
    assert.match(recusa(() => comoApp(`SELECT count(*) FROM core.contexto_reservas_a_varrer(10, interval '1 hour')`)) ?? '',
      /permission denied/, 'a varredura atravessa inquilinos: só o worker executa');
    assert.ok(dono(`SELECT id FROM core.contexto_reservas_a_varrer(1000, interval '1 hour')`).includes(velha));
    assert.ok(!dono(`SELECT object_path FROM core.contexto_caminhos_conhecidos('${clienteA}')`).includes(`${velha}-velha.png`));
    dono(`SELECT core.contexto_reserva_varrida('${velha}')`);
    assert.ok(!dono(`SELECT id FROM core.contexto_reservas_a_varrer(1000, interval '1 hour')`).includes(velha));

    assert.equal(umaLinha(dono(`SELECT core.contexto_alvo_do_armazenamento('${orgA}', '${clienteA}')`)), 'ativo');
    assert.equal(umaLinha(dono(`SELECT core.contexto_alvo_do_armazenamento('${orgB}', '${clienteA}')`)), 'desconhecido');
  });

  it('itens: o teto da lista é conferido sob trava e vale também para a equipe', () => {
    const link = criarLink(orgA, clienteA, ['presenca_digital']);
    const salvar = (maximo) => umaLinha(publico(`SELECT resultado FROM core.contexto_link_salvar_item(
      '${link.hash}', 'presenca_digital', 'redes_sociais', NULL, '{"rede":"instagram","perfil":"@p"}', 'fato', 0, ${maximo})`));
    const atuais = Number(umaLinha(dono(`SELECT count(*) FROM core.client_context_items WHERE client_id = '${clienteA}' AND list_key = 'redes_sociais'`)));
    assert.equal(salvar(atuais + 1), 'ok');
    assert.equal(salvar(atuais + 1), 'limite');
    dono(`INSERT INTO core.client_context_items (organization_id, client_id, section, list_key, position, data)
          SELECT '${orgA}', '${clienteA}', 'presenca_digital', 'lotada', g, '{}'::jsonb FROM generate_series(1, 500) g`);
    const erro = recusa(() => dono(`INSERT INTO core.client_context_items (organization_id, client_id, section, list_key, position, data)
                                    VALUES ('${orgA}', '${clienteA}', 'presenca_digital', 'lotada', 501, '{}')`));
    assert.ok(erro && /limite/.test(erro), erro ?? 'passou de 500 itens');
  });

  it('abertura do formulário vai à trilha no máximo uma vez por hora', () => {
    const link = criarLink(orgA, clienteA, ['empresa']);
    assert.equal(umaLinha(publico(`SELECT core.contexto_link_registrar_abertura('${link.hash}')`)), 't');
    assert.equal(umaLinha(publico(`SELECT core.contexto_link_registrar_abertura('${link.hash}')`)), 'f');
    dono(`UPDATE core.client_context_links SET abertura_registrada_em = now() - interval '61 minutes' WHERE id = '${link.id}'`);
    assert.equal(umaLinha(publico(`SELECT core.contexto_link_registrar_abertura('${link.hash}')`)), 't');
  });

  it('o convite de integração leva ao link de contexto amarrado a ele', () => {
    const tokenConvite = randomBytes(24).toString('base64url');
    const convite = umaLinha(dono(`INSERT INTO integrations.connection_invites
      (organization_id, client_id, kind, token, expires_at)
      VALUES ('${orgA}', '${clienteA}', 'oauth_self_service', '${tokenConvite}', now() + interval '7 days') RETURNING id`));
    const link = criarLink(orgA, clienteA, ['empresa'], `connection_invite_id='${convite}'`);
    assert.equal(umaLinha(publico(`SELECT core.contexto_link_pelo_convite('${tokenConvite}')`)), link.hash);

    dono(`UPDATE integrations.connection_invites SET status = 'revoked', revoked_at = now() WHERE id = '${convite}'`);
    assert.equal(umaLinha(publico(`SELECT coalesce(core.contexto_link_pelo_convite('${tokenConvite}'), 'nulo')`)), 'nulo');
  });

  it('convite vencido pelo prazo não abre o formulário, e link vencido não bloqueia um novo para o mesmo convite', () => {
    const tokenConvite = randomBytes(24).toString('base64url');
    const convite = umaLinha(dono(`INSERT INTO integrations.connection_invites
      (organization_id, client_id, kind, token, expires_at)
      VALUES ('${orgA}', '${clienteA}', 'oauth_self_service', '${tokenConvite}', now() + interval '7 days') RETURNING id`));
    const vencido = criarLink(orgA, clienteA, ['empresa'], `connection_invite_id='${convite}'`);
    dono(`UPDATE core.client_context_links SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
          WHERE id = '${vencido.id}'`);
    const novo = criarLink(orgA, clienteA, ['empresa'], `connection_invite_id='${convite}'`);
    assert.equal(umaLinha(publico(`SELECT core.contexto_link_pelo_convite('${tokenConvite}')`)), novo.hash);

    const duplicado = recusa(() => criarLink(orgA, clienteA, ['empresa'], `connection_invite_id='${convite}'`));
    assert.ok(duplicado && /um_vivo_por_convite|link de contexto vivo/.test(duplicado), duplicado ?? 'aceitou dois links vivos');

    dono(`UPDATE integrations.connection_invites SET expires_at = now() - interval '1 second', created_at = now() - interval '2 days'
          WHERE id = '${convite}'`);
    assert.equal(umaLinha(publico(`SELECT coalesce(core.contexto_link_pelo_convite('${tokenConvite}'), 'nulo')`)), 'nulo');
  });

  it('cliente excluído some do contexto e os links dele são revogados', () => {
    naOrg(orgA, `INSERT INTO core.client_context_entries (organization_id, client_id, section, field_key, value)
                 VALUES ('${orgA}', '${clienteA2}', 'empresa', 'segmento', '"some"')`);
    const link = criarLink(orgA, clienteA2, ['empresa']);
    dono(`SELECT core.excluir_cliente('${clienteA2}', 'teste de contexto')`);

    assert.equal(umaLinha(naOrg(orgA, `SELECT count(*) FROM core.client_context_entries WHERE client_id = '${clienteA2}'`)), '0');
    assert.equal(umaLinha(naOrg(orgA, `SELECT count(*) FROM core.client_context_links WHERE client_id = '${clienteA2}'`)), '0');
    assert.equal(publico(`SELECT client_id FROM core.contexto_link_abrir('${link.hash}')`), '');
    assert.equal(umaLinha(dono(`SELECT count(*) FROM core.client_context_links WHERE client_id = '${clienteA2}' AND revoked_at IS NULL`)), '0');
  });

  it('o expurgo apaga todo o contexto do cliente em cascata', () => {
    dono(`SELECT core.expurgar_cliente('${clienteA}')`);
    for (const tabela of ['entries', 'items', 'revisions', 'files', 'links', 'brain']) {
      assert.equal(
        umaLinha(dono(`SELECT count(*) FROM core.client_context_${tabela} WHERE client_id = '${clienteA}'`)),
        '0',
        tabela,
      );
    }
  });
});

function enviarCru({ caminho, cabecalhos, pedacos = [], manterAberto = false, esperaMs = 8000 }) {
  return new Promise((resolver, rejeitar) => {
    const inicio = Date.now();
    const alvo = new URL(caminho, BASE);
    const pedido = pedidoHttp(
      { method: 'POST', hostname: alvo.hostname, port: alvo.port, path: alvo.pathname, headers: cabecalhos },
      (resposta) => {
        const partes = [];
        resposta.on('data', (p) => partes.push(p));
        resposta.on('end', () => {
          pedido.destroy();
          resolver({ status: resposta.statusCode, cabecalhos: resposta.headers, corpo: Buffer.concat(partes).toString('utf8'), ms: Date.now() - inicio });
        });
      },
    );
    pedido.on('error', (erro) => (erro.code === 'ECONNRESET' || erro.code === 'EPIPE' ? undefined : rejeitar(erro)));
    const relogio = setTimeout(() => {
      pedido.destroy();
      rejeitar(new Error(`sem resposta em ${esperaMs} ms: o servidor esperou o corpo`));
    }, esperaMs);
    pedido.on('close', () => clearTimeout(relogio));
    for (const pedaco of pedacos) pedido.write(pedaco);
    if (!manterAberto) pedido.end();
  });
}

describe('envio de arquivo pelo link público, pela camada HTTP (ADR 0033)', { concurrency: false }, () => {
  let org = '';
  let cliente = '';
  let origem = '';

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    origem = new URL(ambiente().TRIA_APP_BASE_URL).origin;
    org = umaLinha(dono(
      `INSERT INTO core.organizations (name, slug, type) VALUES ('Ctx HTTP', 'ctx-http-${marca}', 'agency') RETURNING id`));
    cliente = umaLinha(dono(
      `INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', 'Padaria HTTP', 'leads') RETURNING id`));
  });

  const cabecalhosDeEnvio = (extra = {}) => ({
    Origin: origem,
    'Content-Type': 'image/png',
    'x-campo': 'logo',
    'x-nome': 'logo.png',
    'Content-Length': '1024',
    ...extra,
  });
  const reservasDoCliente = () => umaLinha(dono(
    `SELECT count(*) FROM core.client_context_file_reservations WHERE client_id = '${cliente}'`));

  it('POST sem token válido responde sem ler o corpo, e a rota não passa pelo proxy que bufferiza o corpo', async () => {
    const resposta = await enviarCru({
      caminho: `/api/contexto/publico/${novoToken()}/arquivos`,
      cabecalhos: cabecalhosDeEnvio({ 'Content-Length': String(25 * 1024 * 1024) }),
      pedacos: [Buffer.alloc(1024)],
      manterAberto: true,
    });
    assert.equal(resposta.status, 404, resposta.corpo);
    assert.equal(resposta.cabecalhos['content-security-policy'], undefined, 'o proxy (que clona o corpo na memória) rodou na rota de envio');
  });

  it('origem estranha e envio sem tamanho declarado são recusados antes do corpo', async () => {
    const link = criarLink(org, cliente, ['marca']);
    const estranha = await enviarCru({
      caminho: `/api/contexto/publico/${link.token}/arquivos`,
      cabecalhos: cabecalhosDeEnvio({ Origin: 'https://mal.example' }),
      pedacos: [Buffer.alloc(10)],
      manterAberto: true,
    });
    assert.equal(estranha.status, 403);
    const { 'Content-Length': _semTamanho, ...semTamanho } = cabecalhosDeEnvio();
    const fragmentado = await enviarCru({
      caminho: `/api/contexto/publico/${link.token}/arquivos`,
      cabecalhos: { ...semTamanho, 'Transfer-Encoding': 'chunked' },
      pedacos: [Buffer.alloc(10)],
      manterAberto: true,
    });
    assert.equal(fragmentado.status, 411, fragmentado.corpo);
    assert.equal(reservasDoCliente(), '0');
  });

  it('x-item que não é UUID não chega ao banco nem ao bucket', async () => {
    const link = criarLink(org, cliente, ['produtos']);
    const resposta = await enviarCru({
      caminho: `/api/contexto/publico/${link.token}/arquivos`,
      cabecalhos: cabecalhosDeEnvio({ 'x-campo': 'foto', 'x-lista': 'produtos', 'x-item': "1' OR '1'='1" }),
      pedacos: [Buffer.alloc(10)],
      manterAberto: true,
    });
    assert.equal(resposta.status, 400, resposta.corpo);
    assert.equal(reservasDoCliente(), '0');
  });

  it('campo fora das seções do link é recusado pela rota (escopo) sem reservar', async () => {
    const link = criarLink(org, cliente, ['empresa']);
    const resposta = await enviarCru({
      caminho: `/api/contexto/publico/${link.token}/arquivos`,
      cabecalhos: cabecalhosDeEnvio(),
      pedacos: [Buffer.alloc(10)],
      manterAberto: true,
    });
    assert.equal(resposta.status, 403, resposta.corpo);
    assert.equal(reservasDoCliente(), '0');
  });

  it('sem bucket configurado, o envio dentro do escopo para antes de reservar ou ler o corpo', async () => {
    if (ambiente().CONTEXT_BUCKET) return;
    const link = criarLink(org, cliente, ['marca']);
    const resposta = await enviarCru({
      caminho: `/api/contexto/publico/${link.token}/arquivos`,
      cabecalhos: cabecalhosDeEnvio(),
      pedacos: [Buffer.alloc(10)],
      manterAberto: true,
    });
    assert.equal(resposta.status, 503, resposta.corpo);
    assert.equal(reservasDoCliente(), '0');
  });
});
