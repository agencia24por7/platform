import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { PedidosDeExclusaoRepository } from './pedidosDeExclusao.ts';

const { createPedidosDeExclusaoService } = await import('./pedidosDeExclusao.ts');

const SEGREDO = 'segredo-do-app-da-meta';
const AGORA = 1_795_000_000;

function assinar(carga: Record<string, unknown>): string {
  const cargaCodificada = Buffer.from(JSON.stringify(carga)).toString('base64url');
  return `${createHmac('sha256', SEGREDO).update(cargaCodificada).digest('base64url')}.${cargaCodificada}`;
}

function montar(segredoDoApp: string | null = SEGREDO) {
  const abertos = new Map<string, string>();
  const chamadas: { usuarioHash: string; usuarioExterno: string }[] = [];
  let sequencia = 0;
  const repositorio: PedidosDeExclusaoRepository = {
    async registrarDaMeta(input) {
      chamadas.push({ usuarioHash: input.usuarioHash, usuarioExterno: input.usuarioExterno });
      const existente = abertos.get(input.usuarioHash);
      if (existente) return { codigo: existente, situacao: 'pendente', novo: false };
      abertos.set(input.usuarioHash, input.codigo);
      return { codigo: input.codigo, situacao: 'pendente', novo: true };
    },
    async situacao() {
      return null;
    },
    async abertosDaOrganizacao() {
      return [];
    },
  };
  const servico = createPedidosDeExclusaoService(repositorio, {
    segredoDoApp: segredoDoApp ?? undefined,
    pimenta: 'pimenta',
    enderecoPublico: 'https://platform.exemplo.test',
    agoraEmSegundos: () => AGORA,
    novoCodigo: () => `CODIGO${String(++sequencia).padStart(12, '0')}`,
  });
  return { servico, chamadas };
}

describe('pedidos de exclusão da Meta', () => {
  it('devolve url da situação e o código de confirmação, sem gravar o id da Meta no pseudônimo', async () => {
    const { servico, chamadas } = montar();
    const registro = await servico.registrarDaMeta(assinar({ algorithm: 'HMAC-SHA256', issued_at: AGORA, user_id: '42' }));
    assert.ok(registro.ok);
    assert.deepEqual(registro.resposta, {
      url: 'https://platform.exemplo.test/exclusao-de-dados/status/CODIGO000000000001',
      confirmation_code: 'CODIGO000000000001',
    });
    assert.match(chamadas[0]!.usuarioHash, /^[0-9a-f]{64}$/);
    assert.ok(!chamadas[0]!.usuarioHash.includes('42'));
  });

  it('é idempotente por usuário: o mesmo usuário recebe o mesmo código', async () => {
    const { servico } = montar();
    const pedido = assinar({ algorithm: 'HMAC-SHA256', issued_at: AGORA, user_id: '42' });
    const primeiro = await servico.registrarDaMeta(pedido);
    const segundo = await servico.registrarDaMeta(assinar({ algorithm: 'HMAC-SHA256', issued_at: AGORA - 5, user_id: '42' }));
    const outro = await servico.registrarDaMeta(assinar({ algorithm: 'HMAC-SHA256', issued_at: AGORA, user_id: '43' }));
    assert.ok(primeiro.ok && segundo.ok && outro.ok);
    assert.equal(segundo.resposta.confirmation_code, primeiro.resposta.confirmation_code);
    assert.equal(primeiro.novo, true);
    assert.equal(segundo.novo, false);
    assert.notEqual(outro.resposta.confirmation_code, primeiro.resposta.confirmation_code);
  });

  it('assinatura inválida não chega ao banco', async () => {
    const { servico, chamadas } = montar();
    const [, carga] = assinar({ algorithm: 'HMAC-SHA256', issued_at: AGORA, user_id: '42' }).split('.');
    const registro = await servico.registrarDaMeta(`AAAA.${carga}`);
    assert.deepEqual(registro, { ok: false, motivo: 'assinatura_invalida' });
    assert.equal(chamadas.length, 0);
  });

  it('sem META_APP_SECRET responde app_nao_configurado', async () => {
    const { servico } = montar(null);
    assert.deepEqual(await servico.registrarDaMeta('a.b'), { ok: false, motivo: 'app_nao_configurado' });
  });

  it('situação recusa código fora do formato sem consultar', async () => {
    const { servico } = montar();
    assert.equal(await servico.situacao("x' OR 1=1"), null);
  });
});
