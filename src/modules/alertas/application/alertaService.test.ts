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

const { createAlertaService } = await import('./alertaService.ts');
type AlertaRepository = import('../infrastructure/alertaRepository.ts').AlertaRepository;
type AuditEvent = import('../../audit/domain/auditEvent.ts').AuditEvent;

const trabalhador = { requestId: 'r1', callerFingerprint: 'fp', sourceIp: null };
const recebido = { workflowId: 'wf', workflowNome: 'ORLA · coleta', no: 'Abrir', mensagem: 'erro com access_token=SEGREDO12345 e maria@x.com' };

function montar(opcoes: { deduplicado?: boolean; podeCriar?: boolean; operadores?: string[] } = {}) {
  const auditoria: AuditEvent[] = [];
  const notificacoes: string[] = [];
  const repositorio: AlertaRepository = {
    registrar: async () => ({ id: 'id-1', deduplicado: opcoes.deduplicado === true }),
    contarAbertos: async () => 2,
  };
  const servico = createAlertaService(
    repositorio,
    { record: async (evento: AuditEvent) => void auditoria.push(evento), list: async () => [], search: async () => [] },
    async (texto) => void notificacoes.push(texto),
    () => opcoes.podeCriar !== false,
    async (userId) => (opcoes.operadores ?? []).includes(userId),
  );
  return { servico, auditoria, notificacoes };
}

describe('serviço de alertas de falha', () => {
  it('alerta novo grava auditoria plataforma.alerta sem segredo e notifica', async () => {
    const { servico, auditoria, notificacoes } = montar();
    const resultado = await servico.registrar(recebido, trabalhador);
    assert.deepEqual(resultado.ok && resultado.value, { id: 'id-1', deduplicado: false, limitado: false });
    assert.equal(auditoria.length, 1);
    assert.equal(auditoria[0]!.action, 'plataforma.alerta');
    assert.equal(auditoria[0]!.organizationId, null);
    const serializado = JSON.stringify([auditoria, notificacoes]);
    assert.ok(!serializado.includes('SEGREDO12345') && !serializado.includes('maria@'));
    assert.equal(notificacoes.length, 1);
  });

  it('repetição na janela só incrementa: sem auditoria nem notificação', async () => {
    const { servico, auditoria, notificacoes } = montar({ deduplicado: true });
    const resultado = await servico.registrar(recebido, trabalhador);
    assert.deepEqual(resultado.ok && resultado.value, { id: 'id-1', deduplicado: true, limitado: false });
    assert.equal(auditoria.length + notificacoes.length, 0);
  });

  it('enxurrada de alertas distintos é limitada e nada é gravado', async () => {
    const { servico, auditoria } = montar({ podeCriar: false });
    const resultado = await servico.registrar(recebido, trabalhador);
    assert.deepEqual(resultado.ok && resultado.value, { id: null, deduplicado: false, limitado: true });
    assert.equal(auditoria.length, 0);
  });

  it('contagem de alertas só vale para quem o serviço confirma como operador', async () => {
    const { servico } = montar({ operadores: ['op-1'] });
    assert.equal(await servico.contarAbertosParaOperador('op-1'), 2);
    assert.equal(await servico.contarAbertosParaOperador('admin-2'), 0);
  });
});
