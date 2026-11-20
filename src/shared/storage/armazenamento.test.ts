import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArmazenamentoGcs, type BucketMinimo } from './armazenamentoGcs.ts';
import { criarArmazenamentoDeContexto } from './criarArmazenamentoDeContexto.ts';
import { ArmazenamentoIndisponivelError, CaminhoInvalidoError } from './tipos.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const BASE = `orgs/${ORG}/clientes/${CLIENTE}/`;

type GeracaoFalsa = { name: string; generation: string };

function bucketFalso(geracoes: GeracaoFalsa[]) {
  const apagadas: string[] = [];
  const consultas: Record<string, unknown>[] = [];
  const arquivo = (name: string, opcoes?: { generation?: string }) => ({
    name,
    metadata: { generation: opcoes?.generation, size: '3', updated: 'agora', contentType: 'text/plain' },
    delete: async () => {
      apagadas.push(`${name}#${opcoes?.generation ?? 'atual'}`);
    },
  });
  const bucket = {
    file: arquivo,
    getFiles: async (consulta: Record<string, unknown>) => {
      consultas.push(consulta);
      const prefixo = String(consulta.prefix ?? '');
      const achadas = geracoes.filter((g) => g.name.startsWith(prefixo)).map((g) => arquivo(g.name, { generation: g.generation }));
      return [achadas, null];
    },
  };
  return { bucket: bucket as unknown as BucketMinimo, apagadas, consultas };
}

describe('criarArmazenamentoDeContexto', () => {
  it('usa o adaptador nulo sem CONTEXT_BUCKET e o GCS com ele', async () => {
    const nulo = criarArmazenamentoDeContexto({});
    assert.equal(nulo.disponivel, false);
    assert.equal(await nulo.saudavel(), false);
    await assert.rejects(nulo.get(`${BASE}contexto/a`), ArmazenamentoIndisponivelError);
    await assert.rejects(nulo.deletePrefix(BASE), ArmazenamentoIndisponivelError);

    let recebido = '';
    const real = criarArmazenamentoDeContexto({ CONTEXT_BUCKET: ' meu-bucket ' }, (nome) => {
      recebido = nome;
      return nulo;
    });
    assert.equal(recebido, 'meu-bucket');
    assert.ok(real);
    assert.equal(criarArmazenamentoDeContexto({ CONTEXT_BUCKET: '  ' }).disponivel, false);
  });
});

describe('ArmazenamentoGcs', () => {
  it('deletePrefix apaga todas as gerações, uma a uma, só dentro do prefixo', async () => {
    const { bucket, apagadas, consultas } = bucketFalso([
      { name: `${BASE}arquivos/a`, generation: '1' },
      { name: `${BASE}arquivos/a`, generation: '2' },
      { name: `${BASE}contexto/b`, generation: '7' },
      { name: `orgs/${ORG}/clientes/44444444-4444-4444-8444-444444444444/arquivos/c`, generation: '9' },
    ]);
    const armazenamento = new ArmazenamentoGcs(bucket);
    const resultado = await armazenamento.deletePrefix(BASE);
    assert.equal(resultado.deleted, 3);
    assert.deepEqual([...apagadas].sort(), [`${BASE}arquivos/a#1`, `${BASE}arquivos/a#2`, `${BASE}contexto/b#7`]);
    assert.equal(consultas[0]?.versions, true);
  });

  it('delete com todasAsVersoes não toca em objeto de nome parecido', async () => {
    const { bucket, apagadas } = bucketFalso([
      { name: `${BASE}arquivos/a`, generation: '1' },
      { name: `${BASE}arquivos/a2`, generation: '1' },
    ]);
    await new ArmazenamentoGcs(bucket).delete(`${BASE}arquivos/a`, { todasAsVersoes: true });
    assert.deepEqual(apagadas, [`${BASE}arquivos/a#1`]);
  });

  it('recusa caminhos e prefixos inseguros antes de falar com o bucket', async () => {
    const { bucket, consultas } = bucketFalso([]);
    const armazenamento = new ArmazenamentoGcs(bucket);
    await assert.rejects(armazenamento.deletePrefix(`orgs/${ORG}/`), CaminhoInvalidoError);
    await assert.rejects(armazenamento.deletePrefix(`${BASE}arquivos`), CaminhoInvalidoError);
    await assert.rejects(armazenamento.get(`${BASE}../x`), CaminhoInvalidoError);
    await assert.rejects(armazenamento.put('qualquer/coisa', Buffer.from('x'), { contentType: 'text/plain' }), CaminhoInvalidoError);
    await assert.rejects(armazenamento.list('orgs/'), CaminhoInvalidoError);
    assert.equal(consultas.length, 0);
  });

  it('list limita maxResults e devolve o token da próxima página', async () => {
    const consultas: Record<string, unknown>[] = [];
    const bucket = {
      file: () => ({}),
      getFiles: async (consulta: Record<string, unknown>) => {
        consultas.push(consulta);
        return [[{ name: `${BASE}contexto/a`, metadata: { size: '5', updated: 'x', contentType: 'text/plain' } }], { pageToken: 'proxima' }];
      },
    } as unknown as BucketMinimo;
    const pagina = await new ArmazenamentoGcs(bucket).list(BASE, { maxResults: 50_000 });
    assert.equal(consultas[0]?.maxResults, 1000);
    assert.equal(pagina.nextPageToken, 'proxima');
    assert.deepEqual(pagina.items, [{ path: `${BASE}contexto/a`, size: 5, updatedAt: 'x', contentType: 'text/plain' }]);
  });

  it('get devolve null quando o objeto não existe', async () => {
    const bucket = {
      file: () => ({
        getMetadata: async () => {
          throw Object.assign(new Error('não achou'), { code: 404 });
        },
      }),
      getFiles: async () => [[], null],
    } as unknown as BucketMinimo;
    assert.equal(await new ArmazenamentoGcs(bucket).get(`${BASE}contexto/a`), null);
  });

  it('saudavel vira false quando o bucket falha', async () => {
    const bucket = {
      file: () => ({}),
      getFiles: async () => {
        throw new Error('sem permissão');
      },
    } as unknown as BucketMinimo;
    assert.equal(await new ArmazenamentoGcs(bucket).saudavel(), false);
  });
});
