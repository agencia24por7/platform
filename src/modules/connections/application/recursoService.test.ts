import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { Platform } from '@/modules/connections/domain/connection';
import type { StoredDiscovery } from '@/modules/connections/infrastructure/discoveredAccountRepository';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createRecursoService } = await import('./recursoService.ts');
const { PLATAFORMAS_COM_RECURSO } = await import('@/modules/connections/domain/connection.ts');

const ORGANIZACAO = 'org-1';
const ator = { userId: 'user-1', requestId: 'req-1', sourceIp: null };

function montar(platform: Platform, inicial: { state: StoredDiscovery['state']; clientId: string | null }) {
  const eventos: AuditEvent[] = [];
  const avisos: string[] = [];
  let recurso = {
    id: 'rec-1',
    connectionId: 'conn-1',
    platform,
    externalId: 'ext-1',
    name: 'Recurso',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    managerExternalId: null,
    inactive: false,
    spendingLast30Days: null,
    ...inicial,
  } as StoredDiscovery;

  const clientes = new Map([
    ['cli-a', { id: 'cli-a', name: 'Credaz', status: 'active' as const }],
    ['cli-b', { id: 'cli-b', name: 'Outro', status: 'active' as const }],
    ['cli-arquivado', { id: 'cli-arquivado', name: 'Arquivado', status: 'archived' as const }],
  ]);

  const servico = createRecursoService(
    {
      async findById() {
        return recurso;
      },
      async markLinkedToClient(_o: string, _id: string, clientId: string) {
        recurso = { ...recurso, state: 'linked', clientId };
      },
      async reassignClient(_o: string, _id: string, clientId: string) {
        if (recurso.state !== 'linked') return null;
        recurso = { ...recurso, clientId };
        return recurso;
      },
      async unlinkFromClient() {
        if (recurso.state !== 'linked') return null;
        recurso = { ...recurso, state: 'discovered', clientId: null };
        return recurso;
      },
      async listByClient(_o: string, clientId: string) {
        return recurso.state === 'linked' && recurso.clientId === clientId ? [recurso] : [];
      },
    } as never,
    { findById: async (_o: string, id: string) => clientes.get(id) ?? null },
    {
      async record(evento: AuditEvent) {
        eventos.push(evento);
      },
    } as never,
    { posseMudou: (motivo: string) => void avisos.push(motivo) },
  );

  return { servico, eventos, avisos, atual: () => recurso };
}

const pedido = (clientId: string, papel: 'owner' | 'operator' | 'viewer' = 'operator') => ({
  organizationId: ORGANIZACAO,
  papelDeQuemAge: papel,
  recursoId: 'rec-1',
  clientId,
});

for (const plataforma of PLATAFORMAS_COM_RECURSO) {
  describe(`recurso ${plataforma}: vincular, mover e desvincular`, () => {
    it('vincula ao cliente, audita com cliente e avisa a posse; aparece na lista do cliente', async () => {
      const c = montar(plataforma, { state: 'discovered', clientId: null });
      const resultado = await c.servico.vincular(pedido('cli-a'), ator);

      assert.ok(resultado.ok);
      assert.equal(c.atual().state, 'linked');
      assert.equal(c.atual().clientId, 'cli-a');
      assert.equal((await c.servico.listarPorCliente(ORGANIZACAO, 'cli-a')).length, 1);

      const [evento] = c.eventos;
      assert.equal(evento!.action, 'connection_account.link');
      assert.equal(evento!.targetType, 'connection_account');
      assert.equal(evento!.metadata?.platform, plataforma);
      assert.equal(evento!.metadata?.connectionId, 'conn-1');
      assert.equal(evento!.metadata?.cliente, 'Credaz');
      assert.deepEqual(c.avisos, ['connection_account.link']);
    });

    it('recurso que já tem dono não é vinculado de novo; cliente arquivado ou inexistente não recebe', async () => {
      const dono = montar(plataforma, { state: 'linked', clientId: 'cli-a' });
      const jaVinculado = await dono.servico.vincular(pedido('cli-b'), ator);
      assert.ok(!jaVinculado.ok && jaVinculado.error.code === 'conflict');
      assert.equal(dono.atual().clientId, 'cli-a');

      for (const destino of ['cli-arquivado', 'cli-fantasma']) {
        const livre = montar(plataforma, { state: 'discovered', clientId: null });
        const resultado = await livre.servico.vincular(pedido(destino), ator);
        assert.ok(!resultado.ok && resultado.error.code === 'validation');
        assert.equal(livre.atual().state, 'discovered');
        assert.equal(livre.eventos.length, 0);
        assert.equal(livre.avisos.length, 0);
      }
    });

    it('move para outro cliente registrando "de" e "para" e fechando a posse no SCD2', async () => {
      const c = montar(plataforma, { state: 'linked', clientId: 'cli-a' });
      const resultado = await c.servico.mover(pedido('cli-b'), ator);

      assert.ok(resultado.ok);
      assert.equal(c.atual().clientId, 'cli-b');
      assert.equal(c.atual().state, 'linked');
      const [evento] = c.eventos;
      assert.equal(evento!.action, 'connection_account.reassigned');
      assert.equal(evento!.metadata?.de, 'Credaz');
      assert.equal(evento!.metadata?.para, 'Outro');
      assert.equal(evento!.metadata?.historico, 'scd2');
      assert.deepEqual(c.avisos, ['connection_account.reassigned']);
      assert.equal((await c.servico.listarPorCliente(ORGANIZACAO, 'cli-a')).length, 0);
    });

    it('mover para o mesmo cliente não audita nem avisa; mover recurso sem dono é recusado', async () => {
      const igual = montar(plataforma, { state: 'linked', clientId: 'cli-a' });
      assert.ok((await igual.servico.mover(pedido('cli-a'), ator)).ok);
      assert.equal(igual.eventos.length, 0);
      assert.equal(igual.avisos.length, 0);

      const solto = montar(plataforma, { state: 'discovered', clientId: null });
      const recusado = await solto.servico.mover(pedido('cli-b'), ator);
      assert.ok(!recusado.ok && recusado.error.code === 'conflict');
      assert.equal(solto.eventos.length, 0);
    });

    it('desvincula devolvendo o recurso a descoberto, com o cliente anterior em "de"', async () => {
      const c = montar(plataforma, { state: 'linked', clientId: 'cli-a' });
      const resultado = await c.servico.desvincular(
        { organizationId: ORGANIZACAO, papelDeQuemAge: 'operator', recursoId: 'rec-1' },
        ator,
      );

      assert.ok(resultado.ok);
      assert.equal(c.atual().state, 'discovered');
      assert.equal(c.atual().clientId, null);
      assert.equal((await c.servico.listarPorCliente(ORGANIZACAO, 'cli-a')).length, 0);
      const [evento] = c.eventos;
      assert.equal(evento!.action, 'connection_account.unlink');
      assert.equal(evento!.metadata?.de, 'Credaz');
      assert.deepEqual(c.avisos, ['connection_account.unlink']);

      const repetida = await c.servico.desvincular(
        { organizationId: ORGANIZACAO, papelDeQuemAge: 'operator', recursoId: 'rec-1' },
        ator,
      );
      assert.ok(!repetida.ok);
      assert.equal(c.eventos.length, 1);
    });

    it('quem só enxerga não vincula, move nem desvincula', async () => {
      const c = montar(plataforma, { state: 'linked', clientId: 'cli-a' });
      const base = { organizationId: ORGANIZACAO, papelDeQuemAge: 'viewer' as const, recursoId: 'rec-1' };

      for (const resultado of [
        await c.servico.vincular({ ...base, clientId: 'cli-b' }, ator),
        await c.servico.mover({ ...base, clientId: 'cli-b' }, ator),
        await c.servico.desvincular(base, ator),
      ]) {
        assert.ok(!resultado.ok && resultado.error.code === 'forbidden');
      }
      assert.equal(c.atual().clientId, 'cli-a');
      assert.equal(c.eventos.length, 0);
    });
  });
}

describe('plataformas sem recurso próprio', () => {
  for (const plataforma of ['google', 'meta', 'whatsapp'] as const) {
    it(`${plataforma} não passa pelo vínculo de recurso`, async () => {
      const c = montar(plataforma, { state: 'discovered', clientId: null });
      const resultado = await c.servico.vincular(pedido('cli-a'), ator);

      assert.ok(!resultado.ok);
      assert.equal(c.atual().state, 'discovered');
      assert.equal(c.eventos.length, 0);
    });
  }
});
