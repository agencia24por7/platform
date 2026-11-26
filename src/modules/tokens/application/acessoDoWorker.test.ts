import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { ContextoDaOrigem, RecifradorExtra } from './acessoDoWorker.ts';
import type { CofreDeTokens } from './cofreDeTokens.ts';

const { createAcessoDoWorker } = await import('./acessoDoWorker.ts');

const TOKEN = 'ya29.token-que-nunca-vai-para-a-auditoria';
const WORKER = { requestId: 'req-1', callerFingerprint: 'fp', sourceIp: null };
const VALIDO: ContextoDaOrigem = {
  organizationId: 'org-1',
  connectionId: 'con-1',
  platform: 'google',
  connectionStatus: 'active',
  origemEmExecucao: true,
  fonteAtiva: true,
  tenantAtivo: true,
  temToken: true,
};

function montar(contexto: ContextoDaOrigem | null, opcoes: { permitir?: boolean; cofre?: Partial<CofreDeTokens>; extras?: readonly RecifradorExtra[] } = {}) {
  const eventos: AuditEvent[] = [];
  let pedidosAoCofre = 0;
  const cofre: CofreDeTokens = {
    selar: async () => ({ ok: false, error: 'indisponivel' }),
    guardar: async () => ({ ok: true, value: undefined }),
    obterAcesso: async () => {
      pedidosAoCofre += 1;
      return { ok: true, value: { token: TOKEN, tipo: 'bearer', expiraEm: new Date('2026-11-20T13:00:00Z') } };
    },
    revogarEApagar: async () => ({ revogacao: 'sem_token', apagado: false }),
    renovarProativamente: async () => ({ avaliadas: 0, renovadas: 0, reautorizar: 0, falhas: 0 }),
    recifrarProativamente: async () => ({ versaoPrimaria: 'v1', avaliadas: 0, recifradas: 0, falhas: 0 }),
    esquecer: () => {},
    ...opcoes.cofre,
  };
  const servico = createAcessoDoWorker({
    resolvedor: { resolver: async () => contexto },
    cofre,
    audit: { record: async (evento) => void eventos.push(evento), list: async () => [], search: async () => [] },
    limitar: () => opcoes.permitir ?? true,
    ...(opcoes.extras ? { recifradoresExtras: opcoes.extras } : {}),
  });
  return { servico, eventos, pedidos: () => pedidosAoCofre };
}

describe('recifragem de segredos fora do cofre de conexões (ADR 0058)', () => {
  it('soma as contagens dos recifradores extras e passa a versão primária do cofre', async () => {
    const recebidos: [string, number][] = [];
    const t = montar(VALIDO, {
      cofre: { recifrarProativamente: async () => ({ versaoPrimaria: 'v2', avaliadas: 3, recifradas: 2, falhas: 1 }) },
      extras: [async (versao, limite) => { recebidos.push([versao, limite]); return { avaliadas: 4, recifradas: 4, falhas: 0 }; }],
    });
    const resultado = await t.servico.recifrarProativo({ limite: 10 }, WORKER);
    assert.deepEqual(resultado.ok && resultado.value, { versaoPrimaria: 'v2', avaliadas: 7, recifradas: 6, falhas: 1 });
    assert.deepEqual(recebidos, [['v2', 10]]);
    assert.deepEqual(t.eventos[0]!.metadata, { versaoPrimaria: 'v2', avaliadas: 7, recifradas: 6, falhas: 1, limite: 10 });
  });

  it('recifrador extra que quebra conta como falha: avaliadas zero nunca esconde segredo pendente', async () => {
    const t = montar(VALIDO, {
      cofre: { recifrarProativamente: async () => ({ versaoPrimaria: 'v2', avaliadas: 0, recifradas: 0, falhas: 0 }) },
      extras: [async () => { throw new Error('banco fora'); }],
    });
    const resultado = await t.servico.recifrarProativo({ limite: 10 }, WORKER);
    assert.deepEqual(resultado.ok && resultado.value, { versaoPrimaria: 'v2', avaliadas: 0, recifradas: 0, falhas: 1 });
  });

  it('sem chave primária os extras não rodam', async () => {
    let rodou = false;
    const t = montar(VALIDO, {
      cofre: { recifrarProativamente: async () => ({ versaoPrimaria: null, avaliadas: 0, recifradas: 0, falhas: 1 }) },
      extras: [async () => { rodou = true; return { avaliadas: 0, recifradas: 0, falhas: 0 }; }],
    });
    await t.servico.recifrarProativo({ limite: 10 }, WORKER);
    assert.equal(rodou, false);
  });
});

describe('emissão de token para o worker', () => {
  it('emite para coleta em execução e audita sem o token', async () => {
    const t = montar(VALIDO);
    const resultado = await t.servico.emitir({ coletaId: 'col-1' }, WORKER);
    assert.deepEqual(resultado, { ok: true, value: { token: TOKEN, tipo: 'bearer', expiraEm: '2026-11-20T13:00:00.000Z' } });
    assert.equal(t.eventos[0]?.action, 'tokens.acesso.emitido');
    assert.equal(t.eventos[0]?.targetId, 'con-1');
    assert.ok(!JSON.stringify(t.eventos).includes(TOKEN));
  });

  it('recusa sem abrir o cofre: origem encerrada, fonte inativa, conexão reauth_pending ou sem token', async () => {
    const casos: [Partial<ContextoDaOrigem>, string][] = [
      [{ origemEmExecucao: false }, 'origem_encerrada'],
      [{ tenantAtivo: false }, 'fonte_inativa'],
      [{ fonteAtiva: false }, 'fonte_inativa'],
      [{ connectionStatus: 'reauth_pending' }, 'reauth_pending'],
      [{ connectionStatus: 'revoked' }, 'conexao_revogada'],
      [{ temToken: false }, 'sem_token'],
    ];
    for (const [mudanca, motivo] of casos) {
      const t = montar({ ...VALIDO, ...mudanca });
      const resultado = await t.servico.emitir({ tarefaId: 'tar-1' }, WORKER);
      assert.equal(resultado.ok, false);
      if (!resultado.ok) {
        assert.equal(resultado.error.code, 'conflict');
        assert.equal(resultado.error.details?.motivo, motivo);
      }
      assert.equal(t.pedidos(), 0);
      assert.equal(t.eventos[0]?.metadata?.motivo, motivo);
    }
  });

  it('Meta: devolve a appsecret_proof (HMAC-SHA256 do token com o segredo do app) e não a audita', async () => {
    const { createHmac } = await import('node:crypto');
    const eventos: AuditEvent[] = [];
    const servico = createAcessoDoWorker({
      resolvedor: { resolver: async () => ({ ...VALIDO, platform: 'meta' }) },
      cofre: {
        selar: async () => ({ ok: false, error: 'indisponivel' }),
        guardar: async () => ({ ok: true, value: undefined }),
        obterAcesso: async () => ({ ok: true, value: { token: TOKEN, tipo: 'bearer', expiraEm: null } }),
        revogarEApagar: async () => ({ revogacao: 'sem_token', apagado: false }),
        renovarProativamente: async () => ({ avaliadas: 0, renovadas: 0, reautorizar: 0, falhas: 0 }),
        recifrarProativamente: async () => ({ versaoPrimaria: 'v1', avaliadas: 0, recifradas: 0, falhas: 0 }),
        esquecer: () => {},
      },
      audit: { record: async (evento) => void eventos.push(evento), list: async () => [], search: async () => [] },
      limitar: () => true,
      provaDoSegredoDoApp: (platform, token) => (platform === 'meta' ? createHmac('sha256', 'segredo-do-app').update(token).digest('hex') : null),
    });
    const resultado = await servico.emitir({ coletaId: 'col-1' }, WORKER);
    assert.ok(resultado.ok);
    assert.equal(resultado.value.appsecretProof, createHmac('sha256', 'segredo-do-app').update(TOKEN).digest('hex'));
    assert.ok(!JSON.stringify(eventos).includes(resultado.value.appsecretProof!));
    const google = await montar(VALIDO).servico.emitir({ coletaId: 'col-1' }, WORKER);
    assert.ok(google.ok && !('appsecretProof' in google.value));
  });

  it('origem desconhecida é 404 e limite estourado é 429', async () => {
    const desconhecida = await montar(null).servico.emitir({ coletaId: 'x' }, WORKER);
    assert.equal(!desconhecida.ok && desconhecida.error.code, 'not_found');
    const limitada = await montar(VALIDO, { permitir: false }).servico.emitir({ coletaId: 'x' }, WORKER);
    assert.equal(!limitada.ok && limitada.error.code, 'rate_limited');
  });

  it('traduz a recusa do provedor em reauth_pending', async () => {
    const t = montar(VALIDO, { cofre: { obterAcesso: async () => ({ ok: false, error: 'reautorizar' }) } });
    const resultado = await t.servico.emitir({ coletaId: 'col-1' }, WORKER);
    assert.equal(!resultado.ok && resultado.error.details?.motivo, 'reauth_pending');
  });
});

describe('recifragem proativa pelo worker', () => {
  it('audita só contagens e a versão da chave, sem segredo', async () => {
    const t = montar(VALIDO, {
      cofre: { recifrarProativamente: async () => ({ versaoPrimaria: 'v2', avaliadas: 3, recifradas: 2, falhas: 1 }) },
    });
    const resultado = await t.servico.recifrarProativo({ limite: 10 }, WORKER);
    assert.deepEqual(resultado.ok && resultado.value, { versaoPrimaria: 'v2', avaliadas: 3, recifradas: 2, falhas: 1 });
    assert.equal(t.eventos.length, 1);
    assert.equal(t.eventos[0]!.action, 'tokens.recifragem');
    assert.deepEqual(t.eventos[0]!.metadata, { versaoPrimaria: 'v2', avaliadas: 3, recifradas: 2, falhas: 1, limite: 10 });
  });
});
