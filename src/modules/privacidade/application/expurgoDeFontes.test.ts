import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { ExpurgoPendente, FilaDeExpurgo } from './expurgoDeFontes.ts';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createExpurgoDeFontesService } = await import('./expurgoDeFontes.ts');

const pendente = (id: string): ExpurgoPendente => ({ id, organizationId: 'org-1', platform: 'youtube', externalId: `UC${id}` });

function montar(opcoes: { falhaNoBigQuery?: Set<string>; disponivel?: boolean; daConexao?: ExpurgoPendente[]; vencidos?: ExpurgoPendente[] } = {}) {
  const resultados: [string, string | null][] = [];
  const expurgadas: string[] = [];
  const eventos: AuditEvent[] = [];
  const enfileiradas: string[] = [];
  const fila: FilaDeExpurgo = {
    async enfileirarDaConexao(_org, connectionId) {
      enfileiradas.push(connectionId);
      return opcoes.daConexao ?? [pendente('a')];
    },
    async prepararConformidadeDoYoutube() {
      return { nomesTrocadosPeloId: 2, enfileirados: 1, cancelados: 0 };
    },
    async vencidos() {
      return opcoes.vencidos ?? [];
    },
    async registrarResultado(_organizationId, id, erro) {
      resultados.push([id, erro]);
    },
  };
  const servico = createExpurgoDeFontesService(
    fila,
    {
      disponivel: opcoes.disponivel ?? true,
      async expurgarFonte(fonte) {
        if (opcoes.falhaNoBigQuery?.has(fonte.externalId)) throw new Error('quota');
        expurgadas.push(fonte.externalId);
      },
      async aplicarPrazoDoYoutube() {
        return 3;
      },
    },
    { async record(evento: AuditEvent) { eventos.push(evento); } } as never,
  );
  return { servico, resultados, expurgadas, eventos, enfileiradas };
}

describe('expurgo dos dados da conexão removida', () => {
  it('YouTube: enfileira, expurga na hora e marca concluído', async () => {
    const c = montar();
    assert.deepEqual(await c.servico.expurgarDadosDaConexao({ organizationId: 'org-1', connectionId: 'conn-1', platform: 'youtube' }), {
      enfileirados: 1,
      concluidos: 1,
    });
    assert.deepEqual(c.expurgadas, ['UCa']);
    assert.deepEqual(c.resultados, [['a', null]]);
  });

  it('falha no BigQuery fica na fila com o erro, para o job diário refazer', async () => {
    const c = montar({ falhaNoBigQuery: new Set(['UCa']) });
    assert.deepEqual(await c.servico.expurgarDadosDaConexao({ organizationId: 'org-1', connectionId: 'conn-1', platform: 'youtube' }), {
      enfileirados: 1,
      concluidos: 0,
    });
    assert.deepEqual(c.resultados, [['a', 'quota']]);
  });

  it('sem BigQuery fica na fila sem tentar', async () => {
    const c = montar({ disponivel: false });
    const resultado = await c.servico.expurgarDadosDaConexao({ organizationId: 'org-1', connectionId: 'conn-1', platform: 'youtube' });
    assert.deepEqual(resultado, { enfileirados: 1, concluidos: 0 });
    assert.deepEqual(c.resultados, []);
  });

  it('outras plataformas não enfileiram nada', async () => {
    const c = montar();
    assert.deepEqual(await c.servico.expurgarDadosDaConexao({ organizationId: 'org-1', connectionId: 'conn-1', platform: 'ga4' }), {
      enfileirados: 0,
      concluidos: 0,
    });
    assert.deepEqual(c.enfileiradas, []);
  });
});

describe('job diário do YouTube', () => {
  it('prepara no Postgres, refaz os vencidos, aplica o prazo de 30 dias e registra só contagens', async () => {
    const c = montar({ vencidos: [pendente('a'), pendente('b')], falhaNoBigQuery: new Set(['UCb']) });
    const resultado = await c.servico.aplicarConformidadeDoYoutube({ requestId: 'r', callerFingerprint: 'w', sourceIp: null });
    assert.ok(resultado.ok);
    assert.deepEqual(resultado.value, {
      nomesTrocadosPeloId: 2,
      enfileirados: 1,
      cancelados: 0,
      expurgosConcluidos: 1,
      expurgosComFalha: 1,
      passosDoPrazoDeTrintaDias: 3,
    });
    assert.equal(c.eventos.length, 1);
    assert.equal(c.eventos[0]!.action, 'privacidade.youtube_conformidade');
    assert.ok(!JSON.stringify(c.eventos[0]!.metadata).includes('UC'));
  });
});
