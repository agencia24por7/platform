import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

await import('../../brain/testes/ganchos.ts');
const { criarPortaAiSdk, modeloDoFornecedor } = await import('./portaAiSdk.ts');
const { FORNECEDORES } = await import('../domain/tarefa.ts');

const CHAVE = 'chave-do-fornecedor-de-teste';
const modelo = { fornecedor: 'google' as const, modelo: 'modelo-x', chave: CHAVE };
const uso = { inputTokens: { total: 11, noCache: 11, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const parada = { unified: 'stop' as const, raw: 'stop' };
const texto = (conteudo: string) => ({ content: [{ type: 'text' as const, text: conteudo }], finishReason: parada, usage: uso, warnings: [] });

const pedido = (extra: Record<string, unknown> = {}) => ({
  modelo,
  sistema: 'Responda só com o objeto.',
  dados: '<dados>\n{}\n</dados>',
  saida: z.object({ ok: z.boolean(), nota: z.number().int() }),
  orcamento: { passos: 3, tokensDeSaida: 100, tempoMs: 5_000 },
  ferramentas: [],
  ...extra,
});

function porta(doGenerate: (opcoes: Record<string, unknown>) => Promise<unknown>) {
  const chamadas: Record<string, unknown>[] = [];
  const falso = new MockLanguageModelV4({ doGenerate: (async (opcoes: Record<string, unknown>) => { chamadas.push(opcoes); return doGenerate(opcoes); }) as never });
  return { porta: criarPortaAiSdk(() => falso as never), chamadas };
}

describe('adaptador do AI SDK (ADR 0063 §3)', () => {
  it('os cinco fornecedores constroem modelo só com a chave recebida', () => {
    for (const fornecedor of FORNECEDORES) {
      const construido = modeloDoFornecedor({ fornecedor, modelo: 'modelo-x', chave: CHAVE }) as { modelId: string };
      assert.equal(construido.modelId, 'modelo-x');
    }
  });

  it('devolve a saída validada pelo esquema e o uso de tokens', async () => {
    const { porta: p, chamadas } = porta(async () => texto('{"ok":true,"nota":7}'));
    const r = await p.gerar(pedido());
    assert.deepEqual(r, { ok: true, value: { saida: { ok: true, nota: 7 }, uso: { tokensDeEntrada: 11, tokensDeSaida: 5, passos: 1 } } });
    assert.equal(chamadas[0]!.maxOutputTokens, 100);
  });

  it('resposta fora do esquema vira falha de validação, sem devolver o texto do modelo', async () => {
    const { porta: p } = porta(async () => texto('{"ok":"talvez","conteudo":"texto livre do modelo"}'));
    const r = await p.gerar(pedido());
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, 'validation');
      assert.equal(JSON.stringify(r.error).includes('texto livre'), false);
    }
  });

  it('a falha de validação traz só caminho e tipo dos campos inválidos, nunca o valor do modelo', async () => {
    const { porta: q } = porta(async () => texto('{"ok":"SEGREDO-DO-CLIENTE","nota":1.5}'));
    const r2 = await q.gerar(pedido());
    assert.equal(r2.ok, false);
    if (!r2.ok) {
      assert.match(r2.error.message, /\[esquema:ok:invalid_type,nota:invalid_type\]$/);
      assert.equal(JSON.stringify(r2.error).includes('SEGREDO'), false);
    }
  });

  it('erro do fornecedor vira falha genérica por código e nunca carrega a chave nem o corpo', async () => {
    const casos: [number, string][] = [[401, 'unauthorized'], [403, 'unauthorized'], [404, 'not_found'], [429, 'rate_limited'], [400, 'unavailable'], [500, 'unavailable']];
    for (const [status, codigo] of casos) {
      const { porta: p } = porta(async () => {
        throw new APICallError({
          message: `API key ${CHAVE} inválida`,
          url: `https://fornecedor.test/v1?key=${CHAVE}`,
          requestBodyValues: { segredo: CHAVE },
          statusCode: status,
          responseBody: `corpo com ${CHAVE}`,
          isRetryable: false,
        });
      });
      const r = await p.gerar(pedido());
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.error.code, codigo);
        assert.equal(JSON.stringify(r.error).includes(CHAVE), false);
      }
    }
  });

  const esquemaRecusado = (mensagem = 'The specified schema produces a constraint that has too many states for serving.') =>
    new APICallError({ message: mensagem, url: 'https://fornecedor.test/v1', requestBodyValues: {}, statusCode: 400, responseBody: mensagem, isRetryable: false });

  it('repassa o nível de raciocínio da tarefa e não o envia quando a tarefa não o define', async () => {
    const com = porta(async () => texto('{"ok":true,"nota":1}'));
    await com.porta.gerar(pedido({ raciocinio: 'low' }));
    assert.equal(com.chamadas[0]!.reasoning, 'low');
    const sem = porta(async () => texto('{"ok":true,"nota":1}'));
    await sem.porta.gerar(pedido());
    assert.notEqual(sem.chamadas[0]!.reasoning, 'low');
  });

  it('esquema recusado pelo fornecedor: refaz em JSON livre com o esquema no sistema e valida a saída', async () => {
    let chamada = 0;
    const { porta: p, chamadas } = porta(async () => {
      chamada += 1;
      if (chamada === 1) throw esquemaRecusado();
      return texto('```json\n{"ok":true,"nota":4}\n```');
    });
    const r = await p.gerar(pedido());
    assert.equal(chamadas.length, 2);
    assert.deepEqual(r.ok && r.value.saida, { ok: true, nota: 4 });
    assert.match(JSON.stringify(chamadas[1]!.prompt), /JSON Schema/);
  });

  it('em JSON livre, saída que não valida no esquema vira falha de validação sem o texto do modelo', async () => {
    let chamada = 0;
    const { porta: p } = porta(async () => {
      chamada += 1;
      if (chamada === 1) throw esquemaRecusado();
      return texto('{"ok":"talvez","conteudo":"texto livre do modelo"}');
    });
    const r = await p.gerar(pedido());
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, 'validation');
      assert.equal(JSON.stringify(r.error).includes('texto livre'), false);
    }
  });

  it('em JSON livre, texto que não é JSON vira falha de validação', async () => {
    let chamada = 0;
    const { porta: p } = porta(async () => {
      chamada += 1;
      if (chamada === 1) throw esquemaRecusado();
      return texto('não sei responder');
    });
    const r = await p.gerar(pedido());
    assert.equal(!r.ok && r.error.code, 'validation');
  });

  it('400 que não é de esquema não é refeito', async () => {
    const { porta: p, chamadas } = porta(async () => { throw esquemaRecusado('requisição inválida'); });
    const r = await p.gerar(pedido());
    assert.equal(chamadas.length, 1);
    assert.equal(!r.ok && r.error.code, 'unavailable');
  });

  it('o recuo em JSON livre é uma só vez: segunda recusa do fornecedor vira falha, sem laço', async () => {
    const { porta: p, chamadas } = porta(async () => { throw esquemaRecusado(); });
    const r = await p.gerar(pedido());
    assert.equal(chamadas.length, 2);
    assert.equal(r.ok, false);
  });

  it('com ferramenta e mais de um passo, o último passo não deixa chamar ferramenta', async () => {
    let passo = 0;
    const { porta: p, chamadas } = porta(async () => {
      passo += 1;
      if (passo < 2) {
        return {
          content: [{ type: 'tool-call', toolCallId: `c-${passo}`, toolName: 'catalogo_ler', input: JSON.stringify({ clienteId: 'cliente-1' }) }],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: uso,
          warnings: [],
        };
      }
      return texto('{"ok":true,"nota":2}');
    });
    const r = await p.gerar(
      pedido({
        orcamento: { passos: 2, tokensDeSaida: 100, tempoMs: 5_000 },
        ferramentas: [{ nome: 'catalogo_ler', descricao: 'Lê.', entrada: z.object({ clienteId: z.string() }).strict(), executar: async () => ({ total: 1 }) }],
      }),
    );
    assert.ok(r.ok);
    assert.notDeepEqual(chamadas[0]!.toolChoice, { type: 'none' });
    assert.deepEqual(chamadas[1]!.toolChoice, { type: 'none' });
  });

  it('exceção qualquer vira indisponível, sem a mensagem original', async () => {
    const { porta: p } = porta(async () => { throw new Error(`falha interna com ${CHAVE}`); });
    const r = await p.gerar(pedido());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(JSON.stringify(r.error).includes(CHAVE), false);
  });

  it('laço com ferramenta: executa a ferramenta pedida e devolve a saída final', async () => {
    const execucoes: unknown[] = [];
    let passo = 0;
    const { porta: p } = porta(async () => {
      passo += 1;
      if (passo === 1) {
        return {
          content: [{ type: 'tool-call', toolCallId: 'chamada-1', toolName: 'catalogo_ler', input: JSON.stringify({ clienteId: 'cliente-1' }) }],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage: uso,
          warnings: [],
        };
      }
      return texto('{"ok":true,"nota":2}');
    });
    const r = await p.gerar(
      pedido({
        ferramentas: [{
          nome: 'catalogo_ler',
          descricao: 'Lê o catálogo.',
          entrada: z.object({ clienteId: z.string() }).strict(),
          executar: async (entrada: unknown) => { execucoes.push(entrada); return { total: 3 }; },
        }],
      }),
    );
    assert.deepEqual(execucoes, [{ clienteId: 'cliente-1' }]);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual({ saida: r.value.saida, passos: r.value.uso.passos }, { saida: { ok: true, nota: 2 }, passos: 2 });
  });

  it('o orçamento de passos corta um modelo que só pede ferramenta', async () => {
    let chamadasAoModelo = 0;
    const { porta: p } = porta(async () => {
      chamadasAoModelo += 1;
      return {
        content: [{ type: 'tool-call', toolCallId: `chamada-${chamadasAoModelo}`, toolName: 'catalogo_ler', input: '{"clienteId":"x"}' }],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: uso,
        warnings: [],
      };
    });
    const r = await p.gerar(
      pedido({
        orcamento: { passos: 2, tokensDeSaida: 100, tempoMs: 5_000 },
        ferramentas: [{ nome: 'catalogo_ler', descricao: 'Lê.', entrada: z.object({ clienteId: z.string() }).strict(), executar: async () => ({}) }],
      }),
    );
    assert.equal(chamadasAoModelo, 2);
    assert.equal(r.ok, false);
  });
});
