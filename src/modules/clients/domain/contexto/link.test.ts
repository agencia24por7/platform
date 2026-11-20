import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXPIRACAO_PADRAO_EM_DIAS,
  estadoDoLink,
  gerarTokenDeContexto,
  hashDoToken,
  tokenBemFormado,
  validarPedidoDeLink,
} from './link.ts';

const agora = new Date('2026-11-20T12:00:00.000Z');

describe('token do link de contexto', () => {
  it('tem 256 bits em base64url e é sempre diferente', () => {
    const a = gerarTokenDeContexto();
    const b = gerarTokenDeContexto();
    assert.notEqual(a, b);
    assert.equal(Buffer.from(a, 'base64url').length, 32);
    assert.ok(tokenBemFormado(a));
    assert.equal(tokenBemFormado('curto'), false);
    assert.equal(tokenBemFormado(`${a.slice(0, 42)}/`), false);
  });

  it('o hash é SHA-256 hex, determinístico e não contém o token', () => {
    const token = gerarTokenDeContexto();
    const hash = hashDoToken(token);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, hashDoToken(token));
    assert.ok(!hash.includes(token));
    assert.notEqual(hash, hashDoToken(gerarTokenDeContexto()));
  });
});

describe('estado do link', () => {
  it('revogado vence expirado; expira no instante exato', () => {
    const expiraEm = new Date(agora.getTime() + 1000);
    assert.equal(estadoDoLink({ expiraEm, revogadoEm: null }, agora), 'ativo');
    assert.equal(estadoDoLink({ expiraEm, revogadoEm: null }, expiraEm), 'expirado');
    assert.equal(estadoDoLink({ expiraEm: agora, revogadoEm: agora }, agora), 'revogado');
  });
});

describe('pedido de link', () => {
  it('padrão de 30 dias, seções em ordem do catálogo e nota aparada', () => {
    const r = validarPedidoDeLink({ secoes: ['marca', 'empresa'], nota: '  oi  ' }, agora);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.secoes, ['empresa', 'marca']);
    assert.equal(r.nota, 'oi');
    assert.equal(r.expiraEm.getTime() - agora.getTime(), EXPIRACAO_PADRAO_EM_DIAS * 86_400_000);
  });

  it('recusa vazio, repetido, seção inexistente, prazo fora da faixa e nota longa', () => {
    const motivo = (p: Parameters<typeof validarPedidoDeLink>[0]) => {
      const r = validarPedidoDeLink(p, agora);
      return r.ok ? 'ok' : r.motivo;
    };
    assert.equal(motivo({ secoes: [] }), 'sem_secoes');
    assert.equal(motivo({ secoes: ['marca', 'marca'] }), 'secao_duplicada');
    assert.equal(motivo({ secoes: ['senhas'] }), 'secao_invalida');
    assert.equal(motivo({ secoes: ['marca'], expiraEmDias: 0 }), 'prazo_invalido');
    assert.equal(motivo({ secoes: ['marca'], expiraEmDias: 91 }), 'prazo_invalido');
    assert.equal(motivo({ secoes: ['marca'], expiraEmDias: 1.5 }), 'prazo_invalido');
    assert.equal(motivo({ secoes: ['marca'], nota: 'x'.repeat(501) }), 'nota_longa');
  });
});
