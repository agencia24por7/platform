import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { semParametrosDeAviso, temParametroDeAviso } from './avisos.ts';

describe('avisos da página do cliente', () => {
  it('remove erro e feito e preserva os demais parâmetros e o hash', () => {
    assert.equal(
      semParametrosDeAviso('/clientes/1/conexoes?secao=pedir&feito=Convite%20revogado.&erro=x#topo'),
      '/clientes/1/conexoes?secao=pedir#topo',
    );
  });

  it('devolve só o caminho quando não sobra parâmetro', () => {
    assert.equal(semParametrosDeAviso('/clientes/1/regras?feito=Ok'), '/clientes/1/regras');
  });

  it('detecta a presença de aviso na busca', () => {
    assert.equal(temParametroDeAviso('?secao=hoje&feito=Ok'), true);
    assert.equal(temParametroDeAviso('?erro=Falhou'), true);
    assert.equal(temParametroDeAviso('?secao=hoje'), false);
    assert.equal(temParametroDeAviso(''), false);
  });
});
