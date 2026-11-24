import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import { decisao, definicao } from '../domain/regras/fixturesDeTeste.ts';
import { failure } from '../../../shared/result/failure.ts';
import { err, ok } from '../../../shared/result/result.ts';
import type { PortaDeRegrasDoWorker } from './regrasDoWorker.ts';

const { EntradaDoAgenteSchema } = await import('../application/regrasEntradas.ts');
const { clienteDaRota, etagDoConjunto, lerRegrasParaAgente, projetarDecisao, registrarDecisaoDoAgente } = await import(
  './regrasDoWorker.ts'
);

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const worker = { requestId: 'req-w', callerFingerprint: 'fp', sourceIp: null };
const base = { agenteId: 'agente-1', execucaoId: 'exec-1', idempotencyKey: 'chave-1', categoria: 'processo', natureza: 'decisao', titulo: 'Pausar' };

function porta(sobrescrita: Partial<PortaDeRegrasDoWorker['regras']> = {}, cliente: { organizationId: string; clienteId: string } | null = { organizationId: ORG, clienteId: CLIENTE }) {
  const chamadas: unknown[][] = [];
  const resultado: PortaDeRegrasDoWorker = {
    resolverCliente: async () => cliente,
    regras: {
      conjuntoParaAgente: async () => {
        chamadas.push(['conjunto']);
        return ok({ decisoes: [], conflitos: [], definicoes: [], hash: 'h'.repeat(64), geradoEm: new Date() });
      },
      registrarPorAgente: async (escopo, entrada, origem) => {
        chamadas.push([escopo, entrada, origem]);
        return ok({ decisao: decisao({ origem: 'agente', agentId: 'agente-1', agentRunId: 'exec-1' }), repetida: false });
      },
      ...sobrescrita,
    },
  };
  return { resultado, chamadas };
}

describe('corpo da decisão do agente', () => {
  it('aceita o corpo mínimo e exige agente, execução e chave de idempotência', () => {
    assert.ok(EntradaDoAgenteSchema.safeParse(base).success);
    for (const campo of ['agenteId', 'execucaoId', 'idempotencyKey'] as const) {
      const { [campo]: _omitido, ...resto } = base;
      assert.ok(!EntradaDoAgenteSchema.safeParse(resto).success, campo);
    }
  });

  it('recusa origem, status, organização e campos de autoria vindos do corpo', () => {
    for (const extra of [{ origem: 'agencia' }, { origem: 'agente' }, { status: 'vigente' }, { organizationId: ORG }, { decididoPor: 'x' }]) {
      assert.ok(!EntradaDoAgenteSchema.safeParse({ ...base, ...extra }).success, JSON.stringify(extra));
    }
  });
});

describe('projeção e leitura para o agente', () => {
  it('marca cada decisão como conteúdo não confiável e não vaza autoria nem idempotência', () => {
    const projetada = projetarDecisao(decisao({ decididoPor: 'u-1', emNomeDe: 'Fulano', viaLinkId: 'l-1', chaveDeIdempotencia: 'k' }));
    assert.equal(projetada.conteudoNaoConfiavel, true);
    const texto = JSON.stringify(projetada);
    for (const proibido of ['u-1', 'Fulano', 'l-1', 'decididoPor', 'emNomeDe', 'chaveDeIdempotencia']) assert.ok(!texto.includes(proibido), proibido);
    assert.match(projetada.vigenciaInicio, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('passa título, contexto e texto pelo mesmo textoSeguro do Brain e não expõe a evidência', () => {
    const projetada = projetarDecisao(
      decisao({
        titulo: 'Falar com ana@exemplo.com',
        contexto: 'CPF 123.456.789-00 pediu',
        texto: 'Ligar (11) 98765-4321   amanhã',
        evidencia: 'print do zap de joao@exemplo.com',
      }),
    );
    const texto = JSON.stringify(projetada);
    for (const proibido of ['ana@exemplo.com', '123.456.789-00', '98765-4321', 'joao@exemplo.com', 'evidencia']) {
      assert.ok(!texto.includes(proibido), proibido);
    }
    assert.match(projetada.titulo, /\[omitido\]/);
    assert.equal(projetada.texto, 'Ligar [omitido] amanhã');
    assert.equal(projetarDecisao(decisao({ contexto: null, texto: null })).contexto, null);
  });

  it('o ETag vem do hash do conjunto e das definições, e é estável', () => {
    const d = [{ ...definicao(), tiposDeEscopo: ['cliente' as const] }];
    assert.equal(etagDoConjunto('a', d), etagDoConjunto('a', d));
    assert.notEqual(etagDoConjunto('a', d), etagDoConjunto('b', d));
    assert.notEqual(etagDoConjunto('a', d), etagDoConjunto('a', []));
    assert.match(etagDoConjunto('a', d), /^"[0-9a-f]{32}"$/);
  });

  it('devolve hashDoConjunto, aviso global e só as definições dos limites do conjunto', async () => {
    const limite = decisao({ natureza: 'limite', chave: 'investimento.teto_mensal' });
    const { resultado } = porta({
      conjuntoParaAgente: async () =>
        ok({
          decisoes: [limite],
          conflitos: [],
          definicoes: [
            { ...definicao(), tiposDeEscopo: ['cliente'] },
            { ...definicao({ key: 'eficiencia.cac_maximo', categoria: 'eficiencia' }), tiposDeEscopo: ['cliente'] },
          ],
          hash: 'f'.repeat(64),
          geradoEm: new Date(),
        }),
    });
    const lida = await lerRegrasParaAgente(resultado, CLIENTE);
    assert.ok(lida.ok);
    assert.equal(lida.value.corpo.hashDoConjunto, 'f'.repeat(64));
    assert.equal(lida.value.corpo.conteudoNaoConfiavel, true);
    assert.deepEqual(lida.value.corpo.definicoesDeLimite.map((x) => x.key), ['investimento.teto_mensal']);
    assert.equal(lida.value.etag, etagDoConjunto('f'.repeat(64), lida.value.corpo.definicoesDeLimite));
  });

  it('cliente que não resolve ou invisível vira not_found sem chamar o serviço', async () => {
    const semCliente = porta({}, null);
    const a = await lerRegrasParaAgente(semCliente.resultado, CLIENTE);
    assert.ok(!a.ok && a.error.code === 'not_found');
    assert.equal(semCliente.chamadas.length, 0);
    const invisivel = porta({ conjuntoParaAgente: async () => err(failure('not_found', 'Cliente não encontrado.')) });
    const b = await lerRegrasParaAgente(invisivel.resultado, CLIENTE);
    assert.ok(!b.ok && b.error.code === 'not_found' && b.error.message === 'Recurso não encontrado.');
  });
});

describe('registro pelo agente', () => {
  const entrada = EntradaDoAgenteSchema.parse(base);

  it('repassa o escopo resolvido (não o corpo) e o x-request-id', async () => {
    const { resultado, chamadas } = porta();
    const r = await registrarDecisaoDoAgente(resultado, CLIENTE, entrada, worker);
    assert.ok(r.ok);
    assert.deepEqual(chamadas[0]![0], { organizationId: ORG, clientId: CLIENTE });
    assert.deepEqual(chamadas[0]![2], { requestId: 'req-w' });
    assert.equal(r.value.repetida, false);
    assert.equal(r.value.decisao.origem, 'agente');
  });

  it('propaga repetida, e mapeia os códigos de falha do serviço sem alterá-los', async () => {
    const repetida = porta({ registrarPorAgente: async () => ok({ decisao: decisao(), repetida: true }) });
    const r = await registrarDecisaoDoAgente(repetida.resultado, CLIENTE, entrada, worker);
    assert.ok(r.ok && r.value.repetida);
    for (const codigo of ['validation', 'forbidden', 'conflict', 'rate_limited'] as const) {
      const { resultado } = porta({ registrarPorAgente: async () => err(failure(codigo, 'x')) });
      const falha = await registrarDecisaoDoAgente(resultado, CLIENTE, entrada, worker);
      assert.ok(!falha.ok && falha.error.code === codigo);
    }
  });

  it('cliente inválido ou inexistente é not_found e não chega ao serviço', async () => {
    const { resultado, chamadas } = porta({}, null);
    const a = await registrarDecisaoDoAgente(resultado, CLIENTE, entrada, worker);
    const b = await registrarDecisaoDoAgente(porta().resultado, null, entrada, worker);
    assert.ok(!a.ok && a.error.code === 'not_found');
    assert.ok(!b.ok && b.error.code === 'not_found');
    assert.equal(chamadas.length, 0);
  });

  it('clienteDaRota só aceita uuid', () => {
    assert.equal(clienteDaRota({ clienteId: CLIENTE }), CLIENTE);
    assert.equal(clienteDaRota({ clienteId: 'abc' }), null);
    assert.equal(clienteDaRota({}), null);
  });
});
