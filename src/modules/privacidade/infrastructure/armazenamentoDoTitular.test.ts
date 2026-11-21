import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { etapasDoExpurgo, expurgarArmazenamento } from '../../../../scripts/lib/armazenamentoDoTitular.mjs';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';

function rotaFalsa(objetos: Set<string>, opcoes: { desativado?: boolean } = {}) {
  const pedidos: { url: string; corpo: unknown; autorizacao: string | null }[] = [];
  const buscar = async (url: string, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body)) as { organizationId: string; clientId: string; modo: string };
    pedidos.push({ url, corpo, autorizacao: new Headers(init.headers).get('authorization') });
    const prefixo = `orgs/${corpo.organizationId}/clientes/${corpo.clientId}/`;
    let apagados = 0;
    for (const caminho of [...objetos]) {
      if (!caminho.startsWith(prefixo)) continue;
      objetos.delete(caminho);
      apagados += 1;
    }
    return new Response(JSON.stringify({ apagados, modo: corpo.modo, alvo: 'excluido', desativado: opcoes.desativado ?? false }), { status: 200 });
  };
  return { buscar, pedidos };
}

describe('expurgo do bucket pelo titular.mjs', () => {
  it('o bucket é apagado depois do BigQuery e antes do Postgres, e repete-se quando o cliente já sumiu', () => {
    const completo = etapasDoExpurgo({ existe: true, local: false });
    assert.ok(completo.indexOf('bigquery') < completo.indexOf('armazenamento'));
    assert.ok(completo.indexOf('armazenamento') < completo.indexOf('postgres'));
    assert.equal(etapasDoExpurgo({ existe: false, local: false })[0], 'armazenamento');
    assert.deepEqual(etapasDoExpurgo({ existe: true, local: false, somenteArmazenamento: true }), ['armazenamento']);
    assert.ok(etapasDoExpurgo({ existe: true, local: true }).indexOf('armazenamento') < etapasDoExpurgo({ existe: true, local: true }).indexOf('postgres'));
  });

  it('apaga o prefixo do cliente pela rota de manutenção e é idempotente', async () => {
    const objetos = new Set([
      `orgs/${ORG}/clientes/${CLIENTE}/arquivos/a.png`,
      `orgs/${ORG}/clientes/${CLIENTE}/contexto/brain/perfil.md`,
      `orgs/${ORG}/clientes/${CLIENTE}/brain/catalogo.md`,
      `orgs/${ORG}/clientes/33333333-3333-4333-8333-333333333333/arquivos/b.png`,
    ]);
    const rota = rotaFalsa(objetos);
    const pedir = () =>
      expurgarArmazenamento({ base: 'http://app', token: 't', organizationId: ORG, clientId: CLIENTE, modo: 'tudo', local: false, buscar: rota.buscar });
    const primeira = await pedir();
    assert.deepEqual(primeira, { ok: true, apagados: 3, alvo: 'excluido', desativado: false });
    assert.equal(objetos.size, 1);
    const segunda = await pedir();
    assert.ok(segunda.ok && segunda.apagados === 0);
    assert.equal(rota.pedidos[0]?.url, 'http://app/api/v0/manutencao/expurgar-armazenamento');
    assert.equal(rota.pedidos[0]?.autorizacao, 'Bearer t');
  });

  it('em produção, bucket desativado ou organização desconhecida é falha (nada a confirmar)', async () => {
    const rota = rotaFalsa(new Set(), { desativado: true });
    const desativado = await expurgarArmazenamento({ base: 'b', token: 't', organizationId: ORG, clientId: CLIENTE, modo: 'tudo', local: false, buscar: rota.buscar });
    assert.equal(desativado.ok, false);
    const local = await expurgarArmazenamento({ base: 'b', token: 't', organizationId: ORG, clientId: CLIENTE, modo: 'tudo', local: true, buscar: rota.buscar });
    assert.equal(local.ok, true);
    const semOrg = await expurgarArmazenamento({ base: 'b', token: 't', organizationId: null, clientId: CLIENTE, modo: 'tudo', local: false, buscar: rota.buscar });
    assert.equal(semOrg.ok, false);
    assert.equal(rota.pedidos.length, 2);
  });

  it('erro HTTP da rota (cliente ativo, por exemplo) não conta como apagado', async () => {
    const buscar = async () => new Response('{"title":"conflict"}', { status: 409 });
    const r = await expurgarArmazenamento({ base: 'b', token: 't', organizationId: ORG, clientId: CLIENTE, modo: 'tudo', local: false, buscar });
    assert.equal(r.ok, false);
  });
});
