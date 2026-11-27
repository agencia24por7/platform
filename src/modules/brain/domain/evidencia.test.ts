import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../testes/ganchos.ts');
const fx = await import('../testes/fixtures.ts');
const { provedorDeExemplo } = await import('../infrastructure/provedores/exemplo.ts');
const { contextoDeDescoberta } = await import('./provedor.ts');
const { entradaSemSelo, selar } = await import('./entrada.ts');

const HASH_DA_ENTRADA_DE_EXEMPLO_ANTES_DO_CAMPO_EVIDENCIA = '10a091eccf143d1eedb4821a35fdcb47a0730e16b9f4e40fdf86ee0298aa1c33';

const entradaDeExemplo = async () => {
  const ctx = contextoDeDescoberta({
    organizationId: fx.ORG,
    clienteId: fx.CLIENTE,
    agora: fx.AGORA,
    conjuntoDeDados: 'tria_dw',
    bytesMaximosPorConsulta: 1,
    inventario: fx.inventario(),
    contexto: null,
  });
  return (await provedorDeExemplo.descobrir(ctx))[0]!;
};

const EVIDENCIA = {
  categoria: 'benchmark' as const,
  nota: 'A' as const,
  fonte: 'Fonte de teste',
  mercado: 'global',
  jurisdicao: 'global',
  dataDaFonte: '2026-11-24',
  obrigatoria: false,
  replicada: true,
};

describe('campo opcional evidencia', () => {
  it('o hash de entrada sem o campo não mudou (valor fixado antes da mudança)', async () => {
    assert.equal(selar(await entradaDeExemplo()).hash, HASH_DA_ENTRADA_DE_EXEMPLO_ANTES_DO_CAMPO_EVIDENCIA);
  });

  it('evidencia ausente, undefined ou passada pelo esquema dão o mesmo hash', async () => {
    const base = await entradaDeExemplo();
    const analisada = entradaSemSelo.parse(base);
    assert.ok(!('evidencia' in analisada));
    assert.equal(selar({ ...base, evidencia: undefined }).hash, selar(base).hash);
    assert.equal(selar(analisada).hash, selar(base).hash);
  });

  it('com evidência o hash é outro e muda quando a nota muda', async () => {
    const base = await entradaDeExemplo();
    const com = selar({ ...base, evidencia: EVIDENCIA });
    assert.notEqual(com.hash, selar(base).hash);
    assert.notEqual(selar({ ...base, evidencia: { ...EVIDENCIA, nota: 'B' } }).hash, com.hash);
  });

  it('o esquema recusa nota, jurisdição e datas inválidas', async () => {
    const base = await entradaDeExemplo();
    for (const ruim of [{ nota: 'E' }, { jurisdicao: 'BR' }, { dataDaFonte: '24/11/2026' }, { fonte: 'x'.repeat(301) }, { maturidade: 'maduro' }]) {
      assert.equal(entradaSemSelo.safeParse({ ...base, evidencia: { ...EVIDENCIA, ...ruim } }).success, false, JSON.stringify(ruim));
    }
  });
});
