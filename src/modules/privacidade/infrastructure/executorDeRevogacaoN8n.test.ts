import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { WorkflowTemplate } from '@/shared/n8n/workflowComCredencial';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createExecutorDeRevogacaoN8n } = await import('./executorDeRevogacaoN8n.ts');
const { MODELO_DE_REVOGACAO, WEBHOOK_DE_REVOGACAO } = await import('@/shared/n8n/modelos.ts');

const modelo = (caminho: string) => JSON.parse(readFileSync(caminho, 'utf8')) as WorkflowTemplate;
const silencioso = { info() {}, warn() {}, error() {} };

function montar(resposta: () => Promise<Response>, opcoes: { criar?: string | null; remover?: boolean } = {}) {
  const criados: WorkflowTemplate[] = [];
  const removidos: string[] = [];
  const chamadas: { url: string; init: RequestInit }[] = [];
  const executor = createExecutorDeRevogacaoN8n({
    disponivel: true,
    modelos: { google: modelo(MODELO_DE_REVOGACAO.google!), meta: modelo(MODELO_DE_REVOGACAO.meta!) },
    workflows: {
      async criar(corpo) {
        criados.push(corpo);
        return opcoes.criar === undefined ? 'wfTemporario123' : opcoes.criar;
      },
      async remover(id) {
        removidos.push(id);
        return opcoes.remover ?? true;
      },
    },
    urlDoN8n: 'http://n8n:5678',
    tokenDoWorker: 'token-do-worker',
    chamar: (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return resposta();
    }) as typeof fetch,
    logger: silencioso,
  });
  return { executor, criados, removidos, chamadas };
}

const json = (corpo: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } }));

describe('executor de revogação no n8n', () => {
  it('cria o workflow temporário com a credencial da conexão, chama o webhook autenticado e apaga o temporário', async () => {
    const c = montar(() => json({ revogado: true, status: 200 }));
    const desfecho = await c.executor.executar({ provedor: 'google', credentialId: 'credGoogle1', connectionId: '11111111-1111-4111-8111-111111111111' });

    assert.equal(desfecho, 'revogado');
    const no = c.criados[0]!.nodes.find((n) => n.credentials?.['googleOAuth2Api'])!;
    assert.equal(no.credentials!['googleOAuth2Api']!.id, 'credGoogle1');
    assert.equal(c.chamadas[0]!.url, `http://n8n:5678/webhook/${WEBHOOK_DE_REVOGACAO}`);
    assert.equal((c.chamadas[0]!.init.headers as Record<string, string>).Authorization, 'Bearer token-do-worker');
    assert.deepEqual(JSON.parse(String(c.chamadas[0]!.init.body)), {
      workflowId: 'wfTemporario123',
      connectionId: '11111111-1111-4111-8111-111111111111',
    });
    assert.deepEqual(c.removidos, ['wfTemporario123']);
  });

  it('Meta usa a credencial facebookGraphApi', async () => {
    const c = montar(() => json({ revogado: true }));
    await c.executor.executar({ provedor: 'meta', credentialId: 'credMeta01', connectionId: 'c' });
    const no = c.criados[0]!.nodes.find((n) => n.credentials?.['facebookGraphApi'])!;
    assert.equal(no.credentials!['facebookGraphApi']!.id, 'credMeta01');
  });

  it('provedor que não confirma vira recusado; HTTP de erro ou exceção vira falhou; o temporário sai sempre', async () => {
    assert.equal(await montar(() => json({ revogado: false })).executor.executar({ provedor: 'google', credentialId: 'x1', connectionId: 'c' }), 'recusado');

    const http = montar(() => json({}, 500));
    assert.equal(await http.executor.executar({ provedor: 'google', credentialId: 'x1', connectionId: 'c' }), 'falhou');
    assert.deepEqual(http.removidos, ['wfTemporario123']);

    const excecao = montar(() => Promise.reject(new Error('timeout')));
    assert.equal(await excecao.executor.executar({ provedor: 'meta', credentialId: 'x1', connectionId: 'c' }), 'falhou');
    assert.deepEqual(excecao.removidos, ['wfTemporario123']);
  });

  it('se o n8n não cria o temporário, não chama o webhook', async () => {
    const c = montar(() => json({ revogado: true }), { criar: null });
    assert.equal(await c.executor.executar({ provedor: 'google', credentialId: 'x1', connectionId: 'c' }), 'falhou');
    assert.equal(c.chamadas.length, 0);
  });
});
