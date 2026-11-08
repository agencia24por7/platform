import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decidirConvite, normalizarCustomerId } from './convite.ts';

const MCC = '602-780-1803';

describe('identificador de conta do Google', () => {
  it('aceita com e sem hífen', () => {
    assert.equal(normalizarCustomerId('3466336997'), '346-633-6997');
    assert.equal(normalizarCustomerId('346-633-6997'), '346-633-6997');
  });

  it('tolera espaço e ponto que a pessoa cola do painel', () => {
    assert.equal(normalizarCustomerId(' 346 633 6997 '), '346-633-6997');
    assert.equal(normalizarCustomerId('346.633.6997'), '346-633-6997');
  });

  it('recusa quantidade errada de dígitos', () => {
    assert.equal(normalizarCustomerId('12345'), null);
    assert.equal(normalizarCustomerId('12345678901'), null);
    assert.equal(normalizarCustomerId(''), null);
  });

  it('recusa texto que não é identificador', () => {
    assert.equal(normalizarCustomerId('conta do cliente'), null);
  });
});

describe('decisão do convite', () => {
  const alcancadas = ['346-633-6997'];

  it('aceita conta nova sob a administradora', () => {
    const decisao = decidirConvite({ bruto: '1234567890', administradora: MCC, jaAlcancadas: alcancadas });
    assert.deepEqual(decisao, { ok: true, alvo: '123-456-7890' });
  });

  it('recusa convidar a própria administradora', () => {
    const decisao = decidirConvite({ bruto: MCC, administradora: MCC, jaAlcancadas: alcancadas });
    assert.deepEqual(decisao, { ok: false, motivo: 'igual_a_administradora' });
  });

  it('recusa conta que a autorização já alcança', () => {
    const decisao = decidirConvite({
      bruto: '346-633-6997',
      administradora: MCC,
      jaAlcancadas: alcancadas,
    });

    assert.deepEqual(decisao, { ok: false, motivo: 'ja_alcancada' });
  });

  it('recusa quando a autorização não passa por administradora', () => {
    const decisao = decidirConvite({ bruto: '1234567890', administradora: null, jaAlcancadas: [] });
    assert.deepEqual(decisao, { ok: false, motivo: 'sem_administradora' });
  });

  it('a falta de administradora pesa mais que o formato errado', () => {
    const decisao = decidirConvite({ bruto: 'lixo', administradora: null, jaAlcancadas: [] });
    assert.deepEqual(decisao, { ok: false, motivo: 'sem_administradora' });
  });

  it('recusa formato inválido mesmo com administradora', () => {
    const decisao = decidirConvite({ bruto: 'lixo', administradora: MCC, jaAlcancadas: [] });
    assert.deepEqual(decisao, { ok: false, motivo: 'formato' });
  });
});
