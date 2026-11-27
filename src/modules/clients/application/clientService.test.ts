import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { Client, NewClient } from '@/modules/clients/domain/client';
import type { ClientRepository } from '@/modules/clients/infrastructure/clientRepository';
import type { MemberRole } from '@/modules/identity/domain/user';
import type { OrganizationType } from '@/modules/organizations/domain/organization';

const { createClientService } = await import('./clientService.ts');

const ORG = '11111111-1111-4111-8111-111111111111';
const ator = { userId: 'user-1', requestId: 'req-1', sourceIp: null };

function montar(pais: Record<string, { parentClientId: string | null }> = {}, organizacaoDoPai = ORG) {
  const inseridos: NewClient[] = [];
  const eventos: AuditEvent[] = [];
  const repository = {
    async insert(input: NewClient): Promise<Client> {
      inseridos.push(input);
      return { id: '22222222-2222-4222-8222-222222222222', ...input, status: 'active', createdAt: new Date(0) } as unknown as Client;
    },
    async findById(organizationId: string, id: string) {
      if (organizationId !== organizacaoDoPai) return null;
      const pai = pais[id];
      return pai ? ({ id, organizationId, ...pai } as unknown as Client) : null;
    },
    async findByName() {
      return null;
    },
    async list() {
      return [];
    },
    async updateStatus() {
      return null;
    },
  } as unknown as ClientRepository;
  const servico = createClientService(repository, { record: async (e) => void eventos.push(e), list: async () => [], search: async () => [] });
  return { servico, inseridos, eventos };
}

function novo(tipoDaOrganizacao: OrganizationType, papelDeQuemAge: MemberRole, clientIdsDeQuemAge: readonly string[] | null = null, parentClientId: string | null = null) {
  return { organizationId: ORG, parentClientId, name: 'Padaria', segment: null, businessModel: 'leads' as const, tipoDaOrganizacao, papelDeQuemAge, clientIdsDeQuemAge };
}

describe('clientService.create autoriza no serviço', () => {
  it('anunciante: operador e leitor são recusados sem gravar nem auditar', async () => {
    for (const papel of ['operator', 'viewer'] as const) {
      const { servico, inseridos, eventos } = montar();
      const r = await servico.create(novo('advertiser', papel), ator);
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.error.code, 'forbidden');
      assert.match(!r.ok ? r.error.message : '', /negócio/);
      assert.equal(inseridos.length, 0);
      assert.equal(eventos.length, 0);
    }
  });

  it('anunciante: administrador e dono cadastram', async () => {
    for (const papel of ['admin', 'owner'] as const) {
      const { servico, inseridos, eventos } = montar();
      const r = await servico.create(novo('advertiser', papel), ator);
      assert.equal(r.ok, true);
      assert.equal(inseridos.length, 1);
      assert.deepEqual(Object.keys(inseridos[0]!).sort(), ['businessModel', 'name', 'organizationId', 'parentClientId', 'segment']);
      assert.equal(eventos[0]?.action, 'client.create');
    }
  });

  it('agência: operador cadastra e leitor é recusado', async () => {
    const operador = montar();
    assert.equal((await operador.servico.create(novo('agency', 'operator'), ator)).ok, true);
    const leitor = montar();
    const r = await leitor.servico.create(novo('agency', 'viewer'), ator);
    assert.equal(!r.ok && r.error.code, 'forbidden');
    assert.match(!r.ok ? r.error.message : '', /cliente/);
    assert.equal(leitor.inseridos.length, 0);
  });
});

describe('clientService.create exige organização inteira', () => {
  const PAI = '33333333-3333-4333-8333-333333333333';

  it('recorte restrito ou vazio nega o cadastro sem gravar nem auditar', async () => {
    for (const recorte of [[PAI], []]) {
      const { servico, inseridos, eventos } = montar({ [PAI]: { parentClientId: null } });
      const r = await servico.create(novo('agency', 'operator', recorte), ator);
      assert.equal(!r.ok && r.error.code, 'forbidden');
      assert.match(!r.ok ? r.error.message : '', /organização inteira/);
      assert.equal(inseridos.length, 0);
      assert.equal(eventos.length, 0);
    }
  });

  it('recorte restrito com pai fora do recorte nega', async () => {
    const { servico, inseridos } = montar({ [PAI]: { parentClientId: null } });
    const r = await servico.create(novo('agency', 'operator', ['44444444-4444-4444-8444-444444444444'], PAI), ator);
    assert.equal(!r.ok && r.error.code, 'forbidden');
    assert.equal(inseridos.length, 0);
  });

  it('organização inteira com pai válido cadastra a filial', async () => {
    const { servico, inseridos } = montar({ [PAI]: { parentClientId: null } });
    const r = await servico.create(novo('agency', 'operator', null, PAI), ator);
    assert.equal(r.ok, true);
    assert.equal(inseridos[0]?.parentClientId, PAI);
  });

  it('pai de outra organização nega', async () => {
    const { servico, inseridos } = montar({ [PAI]: { parentClientId: null } }, '99999999-9999-4999-8999-999999999999');
    const r = await servico.create(novo('agency', 'operator', null, PAI), ator);
    assert.equal(!r.ok && r.error.code, 'validation');
    assert.equal(inseridos.length, 0);
  });
});
