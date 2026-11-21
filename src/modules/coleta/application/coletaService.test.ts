import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as modulo from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Resolver = (especificador: string, contexto: { parentURL?: string }, proximo: (especificador: string, contexto: unknown) => unknown) => unknown;
type ComGanchos = { registerHooks: (ganchos: { resolve: Resolver }) => void };

const RAIZ = process.cwd();
const arquivoTs = (base: string): string | null =>
  [base, `${base}.ts`, `${base}/index.ts`].find((candidato) => candidato.endsWith('.ts') && existsSync(candidato)) ?? null;

(modulo as unknown as ComGanchos).registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador.startsWith('@/')) {
      const alvo = arquivoTs(resolve(RAIZ, 'src', especificador.slice(2)));
      if (alvo) return proximo(pathToFileURL(alvo).href, contexto);
    }
    if (especificador.startsWith('.') && contexto.parentURL?.endsWith('.ts') && !/\.\w+$/.test(especificador)) {
      const alvo = arquivoTs(resolve(dirname(fileURLToPath(contexto.parentURL)), especificador));
      if (alvo) return proximo(pathToFileURL(alvo).href, contexto);
    }
    return proximo(especificador, contexto);
  },
});

const { createColetaService } = await import('./coletaService.ts');

type Fonte = { fonteTipo: 'ad_account'; fonteId: string; platform: string };

function fonte(fonteId: string, platform = 'google'): Fonte & Record<string, unknown> {
  return {
    fonteTipo: 'ad_account', fonteId, organizationId: 'o', clientId: 'c', clientName: 'C', platform, externalId: fonteId,
    managerExternalId: null, nome: fonteId, currency: 'BRL', timezone: 'America/Sao_Paulo', connectionId: 'n', temToken: true,
  };
}

const HOJE = new Date();
const diaIso = (deslocamento: number) => new Date(HOJE.getTime() + deslocamento * 86_400_000).toISOString().slice(0, 10);

function montar(opcoes: { fontes: ReturnType<typeof fonte>[]; historicos?: Map<string, unknown>; abrir?: unknown; fechada?: Record<string, unknown> }) {
  const chamadas: Record<string, unknown[]> = { expirar: [], pausa: [] };
  const repositorio = {
    fontes: async () => opcoes.fontes,
    historicos: async () => opcoes.historicos ?? new Map(),
    expirarColetasRunning: async (horas: number) => { chamadas.expirar!.push(horas); return 0; },
    registrarPausa: async (...args: unknown[]) => { chamadas.pausa!.push(args); },
    resolveFonte: async () => ({ organizationId: 'o', clientId: 'c', platform: 'google' }),
    resolveContextoDeGravacao: async () => null,
    findByIdempotencyKey: async () => null,
    abrir: async () => opcoes.abrir,
    fechar: async () => opcoes.fechada ?? null,
    marcarFalhaDeAuth: async () => undefined,
    marcarColetaConcluida: async () => undefined,
  };
  const auditoria = { record: async () => undefined, list: async () => [], search: async () => [] };
  const bigQuery = { available: true, gravar: async () => ({ ok: true }), registrarQc: async () => undefined };
  const servico = createColetaService(repositorio as never, auditoria as never, bigQuery as never);
  return { servico, chamadas };
}

const WORKER = { requestId: 'r', callerFingerprint: 'f', sourceIp: null };

describe('fontes incrementais', () => {
  it('expira running abandonada, pula fonte ocupada ou em dia, ordena pela mais atrasada e corta no limit', async () => {
    const historicos = new Map<string, unknown>([
      ['ad_account:em-dia', { ultimaJanelaSucesso: diaIso(-1), ultimaJanelaParcialRepetida: null, ultimaIncrementalEm: HOJE }],
      ['ad_account:ocupada', { ultimaJanelaSucesso: diaIso(-30), ultimaJanelaParcialRepetida: null, ultimaIncrementalEm: null, emExecucaoDesde: new Date(HOJE.getTime() - 60_000) }],
      ['ad_account:pouco-atrasada', { ultimaJanelaSucesso: diaIso(-3), ultimaJanelaParcialRepetida: null, ultimaIncrementalEm: null }],
      ['ad_account:muito-atrasada', { ultimaJanelaSucesso: diaIso(-40), ultimaJanelaParcialRepetida: null, ultimaIncrementalEm: null }],
    ]);
    const { servico, chamadas } = montar({
      fontes: ['em-dia', 'ocupada', 'pouco-atrasada', 'muito-atrasada', 'nova'].map((id) => fonte(id)),
      historicos,
    });
    const fontes = await servico.fontes(2, 'incremental', WORKER);
    assert.deepEqual(chamadas.expirar, [8]);
    assert.deepEqual(fontes.map((item) => item.fonteId), ['nova', 'muito-atrasada']);
    assert.ok(fontes.every((item) => typeof item.comDimensoes === 'boolean' && item.marcaPorParcial === false));
  });
});

describe('abrir', () => {
  it('segunda running da mesma fonte vira 409 com motivo fonte_ocupada', async () => {
    const { servico } = montar({ fontes: [], abrir: 'fonte_ocupada' });
    const resultado = await servico.abrir({
      fonteTipo: 'ad_account', fonteId: 'x', mode: 'incremental', window: { start: diaIso(-3), end: diaIso(-1) }, idempotencyKey: 'chave-da-coleta', n8nExecutionId: null,
    }, WORKER);
    assert.equal(resultado.ok, false);
    if (resultado.ok) return;
    assert.equal(resultado.error.code, 'conflict');
    assert.equal(resultado.error.details?.motivo, 'fonte_ocupada');
  });
});

describe('fechar com limite de uso', () => {
  const fechada = {
    id: 'k', organizationId: 'o', clientId: 'c', platform: 'google', fonteTipo: 'ad_account', adAccountId: 'x', connectionAccountId: null,
    mode: 'incremental', status: 'failed', window: { start: diaIso(-3), end: diaIso(-1) }, qualidadeResumo: null, errorCode: 'limite_de_uso', finishedAt: HOJE,
  };

  it('cota diária do Google Ads grava pausa estruturada no escopo da plataforma', async () => {
    const { servico, chamadas } = montar({ fontes: [], fechada });
    await servico.fechar({
      coletaId: 'k', status: 'failed', requestCount: 1, rowsReceived: 0, rowsWritten: 0, qualidadeResumo: null,
      errorCode: 'limite_de_uso', errorMessage: 'cota', pausa: { motivo: 'cota_diaria', minutos: null },
    }, WORKER);
    assert.equal(chamadas.pausa!.length, 1);
    const [coletaId, ate, motivo, escopo] = chamadas.pausa![0] as [string, Date, string, string];
    assert.equal(coletaId, 'k');
    assert.ok(ate.getTime() > HOJE.getTime());
    assert.equal(motivo, 'cota_diaria');
    assert.equal(escopo, 'plataforma');
  });

  it('sem pausa pedida não grava nada', async () => {
    const { servico, chamadas } = montar({ fontes: [], fechada });
    await servico.fechar({
      coletaId: 'k', status: 'failed', requestCount: 1, rowsReceived: 0, rowsWritten: 0, qualidadeResumo: null, errorCode: 'limite_de_uso', errorMessage: 'x',
    }, WORKER);
    assert.equal(chamadas.pausa!.length, 0);
  });
});
