import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../../brain/testes/ganchos.ts');
const { createCredencialService } = await import('./credencialService.ts');
const { hashDaCredencial, gerarCredencial, MAXIMO_DE_CREDENCIAIS_VIVAS } = await import('../domain/credencial.ts');

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA_ORG = '44444444-4444-4444-8444-444444444444';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const CLIENTE_DE_FORA = '33333333-3333-4333-8333-333333333333';
const ATOR = { userId: '55555555-5555-4555-8555-555555555555', requestId: 'req-12345678', sourceIp: null };
const FERRAMENTA = 'brain_consultar_catalogo';

type Guardada = { id: string; organizationId: string; tokenHash: string; clienteIds: readonly string[] | null; ferramentas: readonly string[]; revogada: boolean };

function montar(opcoes: { vivas?: number } = {}) {
  const guardadas: Guardada[] = [];
  const eventos: Record<string, unknown>[] = [];
  const repositorio = {
    async inserirSeCouber(nova: { organizationId: string; nome: string; tokenHash: string; rotulo: string; clienteIds: readonly string[] | null; ferramentas: readonly string[] }, teto: number) {
      if ((opcoes.vivas ?? 0) >= teto) return null;
      const id = `00000000-0000-4000-8000-00000000000${guardadas.length + 1}`;
      guardadas.push({ id, organizationId: nova.organizationId, tokenHash: nova.tokenHash, clienteIds: nova.clienteIds, ferramentas: nova.ferramentas, revogada: false });
      return { id, organizationId: nova.organizationId, nome: nova.nome, rotulo: nova.rotulo, clienteIds: nova.clienteIds, ferramentas: nova.ferramentas, venceEm: new Date(), revogadaEm: null, criadaEm: new Date(), ultimoUsoEm: null };
    },
    async listar() { return []; },
    async clientesVivos(_org: string, ids: readonly string[]) { return ids.filter((id) => id === CLIENTE); },
    async revogar(organizationId: string, id: string) {
      const achada = guardadas.find((g) => g.id === id && g.organizationId === organizationId && !g.revogada);
      if (!achada) return null;
      achada.revogada = true;
      return { id, organizationId, nome: 'x', rotulo: 'x', clienteIds: null, ferramentas: [], venceEm: new Date(), revogadaEm: new Date(), criadaEm: new Date(), ultimoUsoEm: null };
    },
    async resolver(tokenHash: string) {
      const achada = guardadas.find((g) => g.tokenHash === tokenHash && !g.revogada);
      return achada ? { credencialId: achada.id, organizationId: achada.organizationId, clienteIds: achada.clienteIds, ferramentas: achada.ferramentas } : null;
    },
  };
  const audit = { record: async (e: Record<string, unknown>) => { eventos.push(e); }, list: async () => [], search: async () => [] };
  const servico = createCredencialService(repositorio, { nomes: () => [FERRAMENTA] }, audit as never);
  return { servico, guardadas, eventos };
}

const admin = { organizationId: ORG, papelDeQuemAge: 'admin' as const };
const pedido = (extra: Record<string, unknown> = {}) => ({ nome: 'Agente de teste', clienteIds: null, ferramentas: [FERRAMENTA], validadeEmDias: 30, ...extra });
const ORIGEM = { requestId: 'req-87654321', sourceIp: null };

describe('serviço de credencial de agente', () => {
  it('admin cria, o segredo sai uma vez e o banco recebe só o hash', async () => {
    const { servico, guardadas, eventos } = montar();
    const r = await servico.criar(admin, pedido(), ATOR);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(guardadas[0]!.tokenHash, hashDaCredencial(r.value.segredo));
    assert.equal(JSON.stringify(guardadas).includes(r.value.segredo), false);
    assert.equal(JSON.stringify(r.value.credencial).includes(r.value.segredo), false);
    assert.equal(JSON.stringify(eventos).includes(r.value.segredo), false);
    assert.equal(eventos[0]!.action, 'ia.credencial_criada');
  });

  it('operador e leitor não criam, não listam e não revogam', async () => {
    for (const papel of ['operator', 'viewer'] as const) {
      const { servico, guardadas } = montar();
      const quem = { organizationId: ORG, papelDeQuemAge: papel };
      for (const r of [await servico.criar(quem, pedido(), ATOR), await servico.listar(quem), await servico.revogar(quem, '00000000-0000-4000-8000-000000000001', ATOR)]) {
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.error.code, 'forbidden');
      }
      assert.equal(guardadas.length, 0);
    }
  });

  it('recusa ferramenta desconhecida, cliente de outra organização e pedido malformado', async () => {
    const { servico, guardadas } = montar();
    for (const ruim of [pedido({ ferramentas: ['ferramenta_inexistente'] }), pedido({ clienteIds: [CLIENTE, CLIENTE_DE_FORA] }), pedido({ validadeEmDias: 365 }), 'texto', null]) {
      const r = await servico.criar(admin, ruim, ATOR);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error.code, 'validation');
    }
    assert.equal(guardadas.length, 0);
  });

  it('respeita o teto de credenciais ativas', async () => {
    const { servico } = montar({ vivas: MAXIMO_DE_CREDENCIAIS_VIVAS });
    const r = await servico.criar(admin, pedido(), ATOR);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'conflict');
  });

  it('autentica só o segredo certo e devolve o escopo da própria organização', async () => {
    const { servico } = montar();
    const criada = await servico.criar(admin, pedido({ clienteIds: [CLIENTE] }), ATOR);
    assert.ok(criada.ok);
    if (!criada.ok) return;
    const escopo = await servico.autenticar(criada.value.segredo, ORIGEM);
    assert.deepEqual(escopo, { credencialId: criada.value.credencial.id, organizationId: ORG, clienteIds: [CLIENTE], ferramentas: [FERRAMENTA], ...ORIGEM });
    assert.equal(await servico.autenticar(gerarCredencial(), ORIGEM), null);
    assert.equal(await servico.autenticar('formato-estranho', ORIGEM), null);
    assert.equal(await servico.autenticar('', ORIGEM), null);
  });

  it('revogada deixa de autenticar; outra organização não revoga', async () => {
    const { servico } = montar();
    const criada = await servico.criar(admin, pedido(), ATOR);
    assert.ok(criada.ok);
    if (!criada.ok) return;
    const deFora = await servico.revogar({ organizationId: OUTRA_ORG, papelDeQuemAge: 'owner' }, criada.value.credencial.id, ATOR);
    assert.equal(deFora.ok, false);
    assert.notEqual(await servico.autenticar(criada.value.segredo, ORIGEM), null);
    const revogada = await servico.revogar(admin, criada.value.credencial.id, ATOR);
    assert.ok(revogada.ok);
    assert.equal(await servico.autenticar(criada.value.segredo, ORIGEM), null);
  });

  it('ferramenta que saiu do registro some do escopo', async () => {
    const { servico, guardadas } = montar();
    const criada = await servico.criar(admin, pedido(), ATOR);
    assert.ok(criada.ok);
    if (!criada.ok) return;
    guardadas[0]!.ferramentas = [FERRAMENTA, 'ferramenta_removida'];
    const escopo = await servico.autenticar(criada.value.segredo, ORIGEM);
    assert.deepEqual(escopo?.ferramentas, [FERRAMENTA]);
  });
});
