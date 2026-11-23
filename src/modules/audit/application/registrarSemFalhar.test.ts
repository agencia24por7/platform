import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registrarSemFalhar } from './registrarSemFalhar.ts';

type Chamada = { mensagem: string; contexto: Record<string, unknown> | undefined };

function logEspiao() {
  const erros: Chamada[] = [];
  return {
    erros,
    log: {
      error: (mensagem: string, contexto?: Record<string, unknown>) => {
        erros.push({ mensagem, contexto });
      },
    },
  };
}

const evento = {
  organizationId: 'org-1',
  actorType: 'user',
  actorId: 'u-1',
  action: 'cliente.leitura',
  requestId: 'req-12345678',
  metadata: { segredo: 'conteudo-sensivel-123' },
} as const;

describe('registrarSemFalhar', () => {
  it('grava o evento quando o recorder funciona', async () => {
    const gravados: unknown[] = [];
    const { log, erros } = logEspiao();
    await registrarSemFalhar({ record: async (e) => void gravados.push(e) }, evento, log);
    assert.deepEqual(gravados, [evento]);
    assert.equal(erros.length, 0);
  });

  it('não propaga a falha e loga só action, requestId e o tipo do erro', async () => {
    const { log, erros } = logEspiao();
    const recorder = {
      record: async () => {
        throw new TypeError('duplicate key value (email)=(fulano@exemplo.com) conteudo-sensivel-123');
      },
    };
    await registrarSemFalhar(recorder, evento, log);
    assert.equal(erros.length, 1);
    assert.equal(erros[0]?.mensagem, 'auditoria.falhou');
    assert.deepEqual(erros[0]?.contexto, { action: 'cliente.leitura', requestId: 'req-12345678', erro: 'TypeError' });
    const serializado = JSON.stringify(erros);
    assert.ok(!serializado.includes('conteudo-sensivel-123'));
    assert.ok(!serializado.includes('fulano@exemplo.com'));
  });

  it('trata rejeição que não é Error', async () => {
    const { log, erros } = logEspiao();
    await registrarSemFalhar({ record: () => Promise.reject('texto cru com dado') }, evento, log);
    assert.deepEqual(erros[0]?.contexto, { action: 'cliente.leitura', requestId: 'req-12345678', erro: 'desconhecido' });
  });

  it('trata falha síncrona do recorder', async () => {
    const { log, erros } = logEspiao();
    const recorder = {
      record: (): Promise<void> => {
        throw new Error('boom');
      },
    };
    await registrarSemFalhar(recorder, evento, log);
    assert.equal(erros.length, 1);
  });

  it('não lança nem se o log falhar', async () => {
    const log = {
      error: () => {
        throw new Error('log quebrado');
      },
    };
    await registrarSemFalhar({ record: () => Promise.reject(new Error('x')) }, evento, log);
  });
});
