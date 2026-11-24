import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { BASE, appIsUp } from './helpers.mjs';
import { psqlDonoPrimeiraLinha as dono } from './apoio/psql.mjs';

const sufixo = randomBytes(4).toString('hex');
let org;
let cliente;

function convite(status, { expirado = false, itens = [['google', 'pending'], ['meta', 'pending']] } = {}) {
  const token = `cv-${randomBytes(12).toString('hex')}`;
  const id = dono(
    `INSERT INTO integrations.connection_invites (organization_id, client_id, kind, token, status, expires_at)
     VALUES ('${org}', '${cliente}', 'oauth_self_service', '${token}', '${status}', now() ${expirado ? '-' : '+'} interval '3 days') RETURNING id`,
  );
  for (const [plataforma, situacao] of itens) {
    dono(`INSERT INTO integrations.connection_invite_items (invite_id, organization_id, platform, status) VALUES ('${id}', '${org}', '${plataforma}', '${situacao}')`);
  }
  return token;
}

async function pagina(token, busca = '') {
  const resposta = await fetch(`${BASE}/convite/${token}${busca}`);
  const texto = (await resposta.text()).replaceAll('<!-- -->', '').replace(/<script[\s\S]*?<\/script>/g, '');
  return { status: resposta.status, texto, texto_simples: texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
}

const ocorrencias = (texto, trecho) => texto.split(trecho).length - 1;

describe('convite público: volta do OAuth, "não uso", erros e convite encerrado', { concurrency: false }, () => {
  before(async () => {
    if (!(await appIsUp())) throw new Error('App não está no ar');
    org = dono(`INSERT INTO core.organizations (name, slug, type) VALUES ('Convite ${sufixo}', 'convite-${sufixo}', 'agency') RETURNING id`);
    cliente = dono(`INSERT INTO core.clients (organization_id, name, business_model) VALUES ('${org}', 'Loja ${sufixo}', 'ecommerce') RETURNING id`);
  });

  it('"não uso" marca a plataforma e viaja no link que inicia a autorização das outras', async () => {
    const token = convite('pending');
    const { texto, texto_simples } = await pagina(token, '?nao=meta');
    assert.ok(texto_simples.includes('Dispensada'));
    assert.ok(texto.includes(`/api/convite/${token}/oauth/google/start?nao=meta`), 'o google leva o nao no início do fluxo');
    assert.ok(!texto.includes(`/api/convite/${token}/oauth/meta/start`), 'a plataforma dispensada não oferece conectar');
    assert.ok(texto.includes('Desfazer'));
  });

  it('erro de autorização volta com a plataforma: só a linha dela oferece "Tentar de novo"', async () => {
    const token = convite('pending');
    const { texto_simples } = await pagina(token, '?erroConexao=autorizacao_negada&plataforma=meta');
    assert.equal(ocorrencias(texto_simples, 'Tentar de novo'), 1);
    assert.ok(texto_simples.includes('Você cancelou'));
    const semPlataforma = await pagina(token, '?erro=convite_invalido');
    assert.ok(!semPlataforma.texto_simples.includes('Tentar de novo'));
    for (const codigo of ['app_indisponivel', 'sessao_expirada', 'sessao_trocada']) {
      assert.ok((await pagina(token, `?erroConexao=${codigo}&plataforma=google`)).texto_simples.length > 0, codigo);
    }
  });

  it('"autorizado" só mostra sucesso se o item está concluído', async () => {
    const token = convite('pending', { itens: [['google', 'completed'], ['meta', 'pending']] });
    assert.ok((await pagina(token, '?autorizado=google')).texto_simples.includes('Google Ads conectada.'));
    assert.ok(!(await pagina(token, '?autorizado=meta')).texto_simples.includes('Meta Ads conectada.'));
    assert.ok(!(await pagina(token, '?autorizado=inexistente')).texto_simples.includes('conectada.'));
  });

  it('convite expirado, revogado, concluído ou desconhecido dá a mesma mensagem genérica', async () => {
    const casos = [
      await pagina(convite('pending', { expirado: true })),
      await pagina(convite('revoked')),
      await pagina(convite('completed', { itens: [['google', 'completed'], ['meta', 'pending']] })),
      await pagina('cv-inexistente-000000000000'),
    ];
    for (const caso of casos) {
      assert.ok(caso.texto_simples.includes('Convite indisponível'));
      for (const proibido of ['Pendente', 'Expirada', 'Revogada', 'Encerrada']) {
        assert.ok(!caso.texto_simples.includes(proibido), `vazou o estado: ${proibido}`);
      }
      assert.ok(!caso.texto.includes('/oauth/'), 'sem botão de conectar');
    }
  });
});
