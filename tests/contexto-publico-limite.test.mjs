import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp } from './helpers.mjs';
import { psqlDonoPrimeiraLinha as dono, sufixoUnico } from './apoio/psql.mjs';

const DESCONHECIDAS_POR_IP = 30;
const TOTAL_POR_IP = 300;
const LIMITE_POR_CREDENCIAL = 120;

const tokenDeLink = () => randomBytes(32).toString('base64url');
const ipProprio = () => `198.19.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`;

const ABERTO = 'Mapa de contexto';
const INVALIDO = 'Este link não vale mais';
const LIMITADO = 'Muitas tentativas';

async function abrir(token, ip) {
  const resposta = await fetch(`${BASE}/contexto/${token}`, { headers: { 'X-Forwarded-For': ip } });
  const texto = (await resposta.text()).replaceAll('<!-- -->', '');
  if (texto.includes(LIMITADO)) return LIMITADO;
  if (texto.includes(INVALIDO)) return INVALIDO;
  if (texto.includes(ABERTO)) return ABERTO;
  return `inesperado (${resposta.status})`;
}

describe('limite do contexto público pela rota real', { concurrency: false }, () => {
  let org = '';
  let cliente = '';

  const linkAtivo = () => {
    const token = tokenDeLink();
    const hash = createHash('sha256').update(token).digest('hex');
    dono(
      `INSERT INTO core.client_context_links (organization_id, client_id, token_hash, sections, expires_at)
       VALUES ('${org}', '${cliente}', '${hash}', ARRAY['empresa'], now() + interval '7 days') RETURNING id`,
    );
    return token;
  };

  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    const sufixo = sufixoUnico();
    org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Limite ${sufixo}', 'limite-${sufixo}', 'agency') RETURNING id`);
    cliente = dono(
      `INSERT INTO core.clients (organization_id, name, segment, business_model) VALUES ('${org}', 'Loja ${sufixo}', 'Varejo', 'ecommerce') RETURNING id`,
    );
  });

  it('tokens forjados de um IP passam a receber o limite, e o link válido já aberto segue abrindo', async () => {
    const ip = ipProprio();
    const valido = linkAtivo();
    assert.equal(await abrir(valido, ip), ABERTO);

    for (let i = 0; i < DESCONHECIDAS_POR_IP; i += 1) assert.equal(await abrir(tokenDeLink(), ip), INVALIDO, `forjado ${i + 1}`);
    assert.equal(await abrir(tokenDeLink(), ip), LIMITADO);
    assert.equal(await abrir(valido, ip), ABERTO, 'credencial já validada atravessa o IP saturado');
    assert.equal(await abrir(tokenDeLink(), ipProprio()), INVALIDO, 'outro IP não é afetado');
  });

  it('link revogado reaberto em sequência gasta uma tentativa só', async () => {
    const ip = ipProprio();
    const revogado = linkAtivo();
    dono(`UPDATE core.client_context_links SET revoked_at = now() WHERE token_hash = '${createHash('sha256').update(revogado).digest('hex')}'`);
    for (let i = 0; i < 50; i += 1) assert.equal(await abrir(revogado, ip), INVALIDO, `reabertura ${i + 1}`);
    for (let i = 0; i < DESCONHECIDAS_POR_IP - 1; i += 1) assert.equal(await abrir(tokenDeLink(), ip), INVALIDO, `forjado ${i + 1}`);
    assert.equal(await abrir(tokenDeLink(), ip), LIMITADO);
  });

  it('um IP tem teto total por janela, mesmo só com links válidos', async () => {
    const ip = ipProprio();
    const links = Array.from({ length: Math.ceil(TOTAL_POR_IP / (LIMITE_POR_CREDENCIAL - 20)) }, linkAtivo);
    for (let i = 0; i < TOTAL_POR_IP; i += 1) {
      assert.equal(await abrir(links[i % links.length], ip), ABERTO, `abertura ${i + 1}`);
    }
    assert.equal(await abrir(links[0], ip), LIMITADO);
    assert.equal(await abrir(links[0], ipProprio()), ABERTO, 'o teto é do IP, não do link');
  });
});
