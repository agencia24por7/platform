import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp, sqlDeConexao } from './helpers.mjs';
import { psqlDonoPrimeiraLinha as dono, sufixoUnico } from './apoio/psql.mjs';

const TENTATIVAS_DESCONHECIDAS_POR_IP = 600;
const REENVIOS_DA_REVOGADA = 180;
const LIMITE_POR_TOKEN = 60;

const tokenDeWebhook = () => randomBytes(24).toString('base64url');
const ipProprio = () => `198.18.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`;

function organizacao(nome) {
  return dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('${nome}', 'zapi-${sufixoUnico()}', 'agency') RETURNING id`);
}

function conexaoZapi(organizationId, { status = 'active' } = {}) {
  const { id, sql } = sqlDeConexao({
    organizationId,
    platform: 'zapi',
    grantType: 'api_key',
    label: `Z-API ${sufixoUnico()}`,
    externalId: `zapi-${sufixoUnico()}`,
    status,
  });
  dono(sql);
  const token = tokenDeWebhook();
  dono(`UPDATE integrations.connections SET webhook_token = '${token}' WHERE id = '${id}'`);
  return { id, token };
}

const eventosDa = (connectionId) =>
  Number(dono(`SELECT count(*) FROM integrations.whatsapp_inbound_events WHERE connection_id = '${connectionId}'`));

const eventosDaOrganizacao = (organizationId) =>
  Number(
    dono(
      `SELECT count(*) FROM integrations.whatsapp_inbound_events e
         JOIN integrations.connections c ON c.id = e.connection_id
        WHERE c.organization_id = '${organizationId}'`,
    ),
  );

const enviar = (token, ip, corpo = JSON.stringify({ phone: 'teste', text: { message: 'oi' } })) =>
  fetch(`${BASE}/api/webhooks/zapi/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: corpo,
  });

describe('webhook da Z-API pela rota real', { concurrency: false }, () => {
  let orgA = '';
  let orgB = '';
  let conexaoA = { id: '', token: '' };
  let conexaoB = { id: '', token: '' };

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    orgA = organizacao('Z-API A');
    orgB = organizacao('Z-API B');
    conexaoA = conexaoZapi(orgA);
    conexaoB = conexaoZapi(orgB);
  });

  it('token válido com corpo válido é aceito e grava um evento só da conexão dele', async () => {
    const antesA = eventosDa(conexaoA.id);
    const antesB = eventosDaOrganizacao(orgB);
    const resposta = await enviar(conexaoA.token, ipProprio());
    assert.equal(resposta.status, 200);
    assert.deepEqual(await resposta.json(), { recebido: true });
    assert.equal(eventosDa(conexaoA.id), antesA + 1);
    assert.equal(eventosDaOrganizacao(orgB), antesB, 'o evento de A não aparece na organização B');
  });

  it('token desconhecido responde 404 e não grava nada', async () => {
    const antes = Number(dono('SELECT count(*) FROM integrations.whatsapp_inbound_events'));
    const resposta = await enviar(tokenDeWebhook(), ipProprio());
    assert.equal(resposta.status, 404);
    assert.equal(Number(dono('SELECT count(*) FROM integrations.whatsapp_inbound_events')), antes);
  });

  it('corpo acima do limite responde 413 antes de qualquer coisa', async () => {
    const antes = eventosDa(conexaoA.id);
    const resposta = await enviar(conexaoA.token, ipProprio(), JSON.stringify({ texto: 'x'.repeat(500_001) }));
    assert.equal(resposta.status, 413);
    assert.equal(eventosDa(conexaoA.id), antes);
  });

  it('IP que estoura as tentativas com token desconhecido recebe 429, e o token válido já conhecido segue aceito', async () => {
    const ip = ipProprio();
    const conhecida = conexaoZapi(orgA);
    assert.equal((await enviar(conhecida.token, ip)).status, 200);

    for (let i = 0; i < TENTATIVAS_DESCONHECIDAS_POR_IP; i += 1) {
      assert.equal((await enviar(tokenDeWebhook(), ip)).status, 404, `tentativa ${i + 1}`);
    }
    const barrada = await enviar(tokenDeWebhook(), ip);
    assert.equal(barrada.status, 429);
    assert.ok(Number(barrada.headers.get('retry-after')) > 0);

    const antes = eventosDa(conhecida.id);
    assert.equal((await enviar(conhecida.token, ip)).status, 200, 'o token conhecido atravessa o IP saturado');
    assert.equal(eventosDa(conhecida.id), antes + 1);
    assert.equal((await enviar(tokenDeWebhook(), ipProprio())).status, 404, 'outro IP não é afetado');
  });

  it('o limite por token devolve 429 com Retry-After', async () => {
    const conexao = conexaoZapi(orgA);
    const ip = ipProprio();
    for (let i = 0; i < LIMITE_POR_TOKEN; i += 1) {
      assert.equal((await enviar(conexao.token, ip)).status, 200, `entrega ${i + 1}`);
    }
    const barrada = await enviar(conexao.token, ipProprio());
    assert.equal(barrada.status, 429, 'o limite é do token, de qualquer IP');
    assert.ok(Number(barrada.headers.get('retry-after')) > 0);
    assert.equal(eventosDa(conexao.id), LIMITE_POR_TOKEN);
  });

  it('conexão revogada pelo caminho real (token zerado) responde 404, não grava, e o reenvio não esgota a cota do IP', async () => {
    const conexao = conexaoZapi(orgA);
    const ip = ipProprio();
    assert.equal((await enviar(conexao.token, ip)).status, 200);
    dono(`UPDATE integrations.connections SET status = 'revoked', webhook_token = NULL WHERE id = '${conexao.id}'`);
    const antes = eventosDa(conexao.id);

    for (let i = 0; i < REENVIOS_DA_REVOGADA; i += 1) {
      assert.equal((await enviar(conexao.token, ip)).status, 404, `reenvio ${i + 1}`);
    }
    assert.equal(eventosDa(conexao.id), antes);

    for (let i = 0; i < TENTATIVAS_DESCONHECIDAS_POR_IP - 2; i += 1) {
      assert.equal((await enviar(tokenDeWebhook(), ip)).status, 404, `distinto ${i + 1}`);
    }
    const nova = conexaoZapi(orgA);
    assert.equal((await enviar(nova.token, ip)).status, 200, 'a revogada repetida gastou uma cobrança só: sobra cota para descobrir a nova');
    assert.equal((await enviar(tokenDeWebhook(), ip)).status, 404);
    assert.equal((await enviar(tokenDeWebhook(), ip)).status, 429);
  });

  it('conexão de cliente excluído (status revogado, token mantido) responde 410 e não grava o evento', async () => {
    const revogada = conexaoZapi(orgA, { status: 'revoked' });
    const resposta = await enviar(revogada.token, ipProprio());
    assert.equal(resposta.status, 410);
    assert.equal(eventosDa(revogada.id), 0);
  });

  it('o evento de cada conexão fica só na organização dela', async () => {
    const antesA = eventosDaOrganizacao(orgA);
    const antesB = eventosDaOrganizacao(orgB);
    assert.equal((await enviar(conexaoB.token, ipProprio())).status, 200);
    assert.equal(eventosDaOrganizacao(orgB), antesB + 1);
    assert.equal(eventosDaOrganizacao(orgA), antesA);
  });
});
