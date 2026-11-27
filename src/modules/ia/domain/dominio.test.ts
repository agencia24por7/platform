import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

await import('../../brain/testes/ganchos.ts');
const { criarRegistro, definirFerramenta, clienteNoEscopo, executarFerramenta } = await import('./ferramenta.ts');
const credencial = await import('./credencial.ts');
const { ok } = await import('../../../shared/result/result.ts');

const ferramenta = (extra: Record<string, unknown> = {}) =>
  definirFerramenta({
    nome: 'brain_teste',
    descricao: 'Ferramenta de teste.',
    classe: 'leitura' as const,
    entrada: z.object({}).strict(),
    executar: async () => ok({}),
    ...extra,
  });

describe('registro de ferramentas (ADR 0063 §4)', () => {
  it('só entrega as ferramentas que o escopo lista, em ordem estável', () => {
    const registro = criarRegistro([ferramenta({ nome: 'zeta_ler' }), ferramenta({ nome: 'alfa_ler' })]);
    assert.deepEqual(registro.nomes(), ['alfa_ler', 'zeta_ler']);
    assert.deepEqual(registro.permitidas({ ferramentas: ['zeta_ler', 'inexistente'] }).map((f) => f.nome), ['zeta_ler']);
    assert.deepEqual(registro.permitidas({ ferramentas: [] }), []);
  });

  it('recusa classe que não é leitura, nome fora do padrão, descrição vazia e nome repetido', () => {
    assert.throws(() => criarRegistro([ferramenta({ classe: 'reversivel_dentro_do_teto' })]), /ainda não é liberada/);
    assert.throws(() => criarRegistro([ferramenta({ classe: 'irreversivel_ou_gasto_novo' })]), /ainda não é liberada/);
    assert.throws(() => criarRegistro([ferramenta({ nome: 'Nome Ruim' })]), /fora do padrão/);
    assert.throws(() => criarRegistro([ferramenta({ descricao: '' })]), /descrição/);
    assert.throws(() => criarRegistro([ferramenta(), ferramenta()]), /duas vezes/);
  });

  it('a ferramenta nunca roda com entrada fora do esquema, venha de onde vier', async () => {
    const recebidas: unknown[] = [];
    const estrita = definirFerramenta({
      nome: 'cliente_ler',
      descricao: 'Lê um cliente.',
      classe: 'leitura' as const,
      entrada: z.object({ clienteId: z.uuid(), limite: z.number().int().max(50).default(10) }).strict(),
      executar: async (entrada: unknown) => { recebidas.push(entrada); return ok({}); },
    });
    const escopo = { credencialId: 'c', organizationId: 'o', clienteIds: null, ferramentas: ['cliente_ler'], requestId: 'r', sourceIp: null };
    for (const ruim of [{}, { clienteId: 'x' }, { clienteId: '22222222-2222-4222-8222-222222222222', organizationId: 'outra' }, null, 'texto']) {
      const r = await executarFerramenta(estrita, ruim, escopo);
      assert.equal(!r.ok && r.error.code, 'validation');
    }
    assert.equal(recebidas.length, 0);
    await executarFerramenta(estrita, { clienteId: '22222222-2222-4222-8222-222222222222' }, escopo);
    assert.deepEqual(recebidas, [{ clienteId: '22222222-2222-4222-8222-222222222222', limite: 10 }]);
  });

  it('lista nula de clientes vale a organização inteira; lista explícita só os listados', () => {
    assert.equal(clienteNoEscopo({ clienteIds: null }, 'a'), true);
    assert.equal(clienteNoEscopo({ clienteIds: ['a'] }, 'a'), true);
    assert.equal(clienteNoEscopo({ clienteIds: ['a'] }, 'b'), false);
  });
});

describe('credencial de agente (ADR 0063 §5)', () => {
  it('gera segredo único no formato esperado e guarda só o SHA-256', () => {
    const a = credencial.gerarCredencial();
    const b = credencial.gerarCredencial();
    assert.notEqual(a, b);
    assert.equal(credencial.formatoDeCredencial(a), true);
    assert.match(credencial.hashDaCredencial(a), /^[0-9a-f]{64}$/);
    assert.notEqual(credencial.hashDaCredencial(a), credencial.hashDaCredencial(b));
  });

  it('o rótulo não revela o segredo', () => {
    const segredo = credencial.gerarCredencial();
    const rotulo = credencial.rotuloDaCredencial(segredo);
    assert.equal(rotulo.endsWith(segredo.slice(-4)), true);
    assert.equal(rotulo.length < 24, true);
    assert.equal(rotulo.includes(segredo.slice(8, 20)), false);
  });

  it('formato estranho não é credencial', () => {
    for (const candidata of ['', 'orla_ag_curta', 'Bearer x', `${credencial.gerarCredencial()} `, credencial.gerarCredencial().replace('orla_ag_', 'outro_xx_')]) {
      assert.equal(credencial.formatoDeCredencial(candidata), false);
    }
  });

  it('pedido exige validade de 1 a 90 dias, ao menos uma ferramenta e lista de clientes não vazia', () => {
    const base = { nome: 'Agente', clienteIds: null, ferramentas: ['brain_consultar_catalogo'], validadeEmDias: 30 };
    assert.equal(credencial.pedidoDeCredencial.safeParse(base).success, true);
    for (const ruim of [
      { ...base, validadeEmDias: 0 },
      { ...base, validadeEmDias: 91 },
      { ...base, ferramentas: [] },
      { ...base, clienteIds: [] },
      { ...base, clienteIds: ['nao-e-uuid'] },
      { ...base, nome: '   ' },
      { ...base, extra: true },
    ]) {
      assert.equal(credencial.pedidoDeCredencial.safeParse(ruim).success, false);
    }
  });

  it('situação: revogada vence sobre o prazo', () => {
    const agora = new Date('2026-11-25T12:00:00Z');
    const depois = new Date('2026-12-25T12:00:00Z');
    const antes = new Date('2026-11-01T12:00:00Z');
    assert.equal(credencial.situacaoDaCredencial({ venceEm: depois, revogadaEm: null }, agora), 'ativa');
    assert.equal(credencial.situacaoDaCredencial({ venceEm: antes, revogadaEm: null }, agora), 'vencida');
    assert.equal(credencial.situacaoDaCredencial({ venceEm: depois, revogadaEm: antes }, agora), 'revogada');
  });
});
