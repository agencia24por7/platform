import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { criarAgendadorEmMemoria } = await import('./contextoService.ts');
const { comoWorker, emChamadaDoWorker } = await import('@/shared/db/client.ts');

describe('Baixo: setTimeout do brain não herda o contexto assíncrono do chamador', () => {
  it('Baixo: a publicação adiada, agendada dentro de comoWorker, não roda como worker', async () => {
    const manterVivo = setTimeout(() => undefined, 2000);
    const observado = await new Promise<boolean>((resolver) => {
      const agendador = criarAgendadorEmMemoria(5)(async () => {
        resolver(emChamadaDoWorker());
      });
      void comoWorker(async () => {
        agendador.agendar({ organizationId: 'o', clientId: 'c' } as never);
      });
    });
    clearTimeout(manterVivo);
    assert.equal(observado, false);
  });
});
