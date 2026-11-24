import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../../testes/ganchos.ts');
const { AGORA, CLIENTE, ORG, OUTRO_CLIENTE, contexto, inventario, regras } = await import('../../testes/fixtures.ts');
const { PROVEDORES } = await import('./index.ts');
const { provedorDeExemplo } = await import('./exemplo.ts');
const { contextoDeDescoberta } = await import('../../domain/provedor.ts');
const { entradaSemSelo, selar, TIPOS_NATIVOS } = await import('../../domain/entrada.ts');
const { lerUrn } = await import('../../domain/urn.ts');
const { piiNaEntrada, procurarPii } = await import('../../domain/privacidade.ts');
type Provedor = (typeof PROVEDORES)[number];
type Entrada = ReturnType<typeof selar>;

function ctx(comContexto = true, entradasPrimarias: readonly Entrada[] = []) {
  return contextoDeDescoberta({
    organizationId: ORG,
    clienteId: CLIENTE,
    agora: AGORA,
    conjuntoDeDados: 'tria_dw',
    bytesMaximosPorConsulta: 10_000_000_000,
    inventario: inventario(),
    contexto: comContexto ? contexto() : null,
    regras: comContexto ? regras() : null,
    entradasPrimarias,
  });
}

async function primarias(): Promise<Entrada[]> {
  const todas = await Promise.all(PROVEDORES.filter((p) => p.fase === 'primaria').map((p) => p.descobrir(ctx())));
  return todas.flat().map((e) => selar(e));
}

async function descobrir(provedor: Provedor, comContexto = true) {
  const base = provedor.fase === 'derivada' ? await primarias() : [];
  return provedor.descobrir(ctx(comContexto, base));
}

const TODOS: readonly Provedor[] = [...PROVEDORES, provedorDeExemplo];

describe('contrato de todo provedor registrado (e do de exemplo)', () => {
  for (const provedor of TODOS) {
    describe(provedor.id, () => {
      it('declara id, versão, descrição e tipos', () => {
        assert.match(provedor.id, /^[a-z][a-z0-9_]{1,47}$/);
        assert.ok(provedor.versao >= 1);
        assert.ok(provedor.descricao.length > 20);
        assert.ok(provedor.tiposDeclarados.length > 0);
      });

      it('emite entradas válidas no esquema, do próprio cliente, com tipo declarado', async () => {
        const entradas = await descobrir(provedor);
        assert.ok(entradas.length > 0, 'o fixture rico deve produzir entradas');
        for (const entrada of entradas) {
          const analise = entradaSemSelo.safeParse(entrada);
          assert.ok(analise.success, `${entrada.urn}: ${analise.success ? '' : JSON.stringify(analise.error.issues[0])}`);
          const partes = lerUrn(entrada.urn);
          assert.equal(partes?.organizationId, ORG);
          assert.equal(partes?.clienteId, CLIENTE);
          assert.equal(partes?.tipo, entrada.tipo);
          assert.equal(partes?.id, entrada.id);
          assert.equal(entrada.provedor, provedor.id);
          assert.ok(provedor.tiposDeclarados.includes(entrada.tipo));
          assert.ok(entrada.descricao.trim().length >= 20, `${entrada.urn} sem descrição útil`);
          assert.equal(entrada.versao, provedor.versao);
        }
      });

      it('URNs únicas e saída determinística', async () => {
        const a = await descobrir(provedor);
        const b = await descobrir(provedor);
        assert.equal(new Set(a.map((e) => e.urn)).size, a.length);
        assert.deepEqual(a.map((e) => selar(e).hash), b.map((e) => selar(e).hash));
      });

      it('sem dado pessoal nem segredo no texto e nenhum id de outro cliente', async () => {
        for (const entrada of await descobrir(provedor)) {
          const selada = selar(entrada);
          assert.deepEqual(piiNaEntrada(selada), [], selada.urn);
          const serializada = JSON.stringify(selada);
          assert.ok(!serializada.includes(OUTRO_CLIENTE), selada.urn);
          assert.deepEqual(procurarPii(serializada), [], selada.urn);
        }
      });

      it('saúde coerente e sem quebrar quando o contexto falta', async () => {
        assert.ok(['ok', 'degradado', 'indisponivel'].includes(provedor.saude(ctx()).status));
        await assert.doesNotReject(async () => descobrir(provedor, false));
      });
    });
  }

  it('todo tipo emitido pelos provedores de produção é nativo ou declarado', () => {
    const declarados = new Set(PROVEDORES.flatMap((p) => p.tiposDeclarados));
    for (const tipo of TIPOS_NATIVOS) assert.ok(declarados.has(tipo), `tipo nativo ${tipo} sem provedor`);
  });
});
