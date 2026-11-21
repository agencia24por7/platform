import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { criarSemaforo, lerAteOLimite, lerPedidoDeEnvio, type CabecalhosBrutos } from './envio.ts';

const BASE: CabecalhosBrutos = {
  campo: 'logo',
  lista: null,
  item: null,
  nome: encodeURIComponent('Logo Final.png'),
  tipo: 'image/png',
  tamanho: '1024',
};

const motivo = (extra: Partial<CabecalhosBrutos>) => {
  const lido = lerPedidoDeEnvio({ ...BASE, ...extra });
  return lido.ok ? 'ok' : lido.motivo;
};

function corpo(...pedacos: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controle) {
      for (const p of pedacos) controle.enqueue(p);
      controle.close();
    },
  });
}

describe('cabeçalhos do envio de arquivo', () => {
  it('aceita o pedido bem formado', () => {
    const lido = lerPedidoDeEnvio(BASE);
    assert.ok(lido.ok);
    assert.equal(lido.pedido.nome, 'Logo Final.png');
    assert.equal(lido.pedido.tamanhoDeclarado, 1024);
  });

  it('x-item que não é UUID, chave fora do padrão e lista sem item são recusados antes de qualquer leitura', () => {
    assert.equal(motivo({ lista: 'produtos', item: "1' OR '1'='1" }), 'invalido');
    assert.equal(motivo({ lista: 'produtos', item: 'nao-e-uuid' }), 'invalido');
    assert.equal(motivo({ lista: 'produtos', item: '6666666-6666-4666-8666-666666666661' }), 'invalido');
    assert.equal(motivo({ lista: 'produtos' }), 'invalido');
    assert.equal(motivo({ item: '66666666-6666-4666-8666-666666666661' }), 'invalido');
    assert.equal(motivo({ campo: '../logo' }), 'invalido');
    assert.equal(motivo({ lista: 'Produtos', item: '66666666-6666-4666-8666-666666666661' }), 'invalido');
    assert.equal(motivo({ lista: 'produtos', item: '66666666-6666-4666-8666-666666666661' }), 'ok');
  });

  it('exige tamanho declarado dentro do limite e nome sem caracteres de controle', () => {
    assert.equal(motivo({ tamanho: null }), 'tamanho_ausente');
    assert.equal(motivo({ tamanho: '-1' }), 'tamanho_ausente');
    assert.equal(motivo({ tamanho: '0' }), 'vazio');
    assert.equal(motivo({ tamanho: String(26 * 1024 * 1024) }), 'acima_do_limite');
    assert.equal(motivo({ nome: encodeURIComponent('a\nb.png') }), 'invalido');
    assert.equal(motivo({ nome: null }), 'incompleto');
    assert.equal(motivo({ tipo: 'image/png; charset=binary' }), 'ok');
    assert.equal(motivo({ tipo: 'nada' }), 'invalido');
  });
});

describe('leitura do corpo com teto', () => {
  it('lê exatamente o declarado', async () => {
    const lido = await lerAteOLimite(corpo(new Uint8Array([1, 2]), new Uint8Array([3])), 3);
    assert.ok(lido.ok);
    assert.deepEqual([...lido.conteudo], [1, 2, 3]);
  });

  it('corta no primeiro byte além do declarado e recusa corpo curto, sem confiar no Content-Length', async () => {
    const acima = await lerAteOLimite(corpo(new Uint8Array(2), new Uint8Array(2)), 3);
    assert.equal(acima.ok ? 'ok' : acima.motivo, 'acima_do_declarado');
    const curto = await lerAteOLimite(corpo(new Uint8Array(2)), 3);
    assert.equal(curto.ok ? 'ok' : curto.motivo, 'incompleto');
  });
});

describe('vagas de envio por réplica', () => {
  it('recusa além do limite e devolve a vaga uma vez só', () => {
    const semaforo = criarSemaforo(2);
    const a = semaforo.tentar();
    const b = semaforo.tentar();
    assert.ok(a && b);
    assert.equal(semaforo.tentar(), null);
    a();
    a();
    assert.equal(semaforo.emUso(), 1);
    assert.ok(semaforo.tentar());
  });
});
