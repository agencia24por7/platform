import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URN_BENCHMARK_B, URN_REGRA_LEGAL, hashDeTeste, pacoteDeTeste } from './fixturesDeTeste.ts';
import { entradaDoPacote, entradasDeRegraLegalObrigatoria, esquemaPacoteDeLeitura, hashesDoPacote, indicePorUrn } from './pacote.ts';

describe('pacote de leitura', () => {
  it('o pacote de teste é válido no esquema', () => {
    assert.equal(esquemaPacoteDeLeitura.safeParse(pacoteDeTeste()).success, true);
  });

  it('recusa hash que não é sha256 hex, nota inválida e chave extra', () => {
    const hashRuim = pacoteDeTeste();
    hashRuim.entradas[0]!.hash = 'xyz';
    assert.equal(esquemaPacoteDeLeitura.safeParse(hashRuim).success, false);
    const notaRuim = JSON.parse(JSON.stringify(pacoteDeTeste()));
    notaRuim.entradas[1].evidencia.nota = 'E';
    assert.equal(esquemaPacoteDeLeitura.safeParse(notaRuim).success, false);
    const extra = JSON.parse(JSON.stringify(pacoteDeTeste()));
    extra.entradas[0].segredo = 'x';
    assert.equal(esquemaPacoteDeLeitura.safeParse(extra).success, false);
  });

  it('consulta por URN', () => {
    const pacote = pacoteDeTeste();
    assert.equal(indicePorUrn(pacote).get(URN_BENCHMARK_B)?.hash, hashDeTeste(2));
    assert.equal(entradaDoPacote(pacote, URN_BENCHMARK_B)?.tipo, 'conhecimento');
    assert.equal(entradaDoPacote(pacote, 'orla:nada'), undefined);
    assert.equal(hashesDoPacote(pacote).size, pacote.entradas.length);
  });

  it('acha as regras legais obrigatórias', () => {
    assert.deepEqual(entradasDeRegraLegalObrigatoria(pacoteDeTeste()).map((e) => e.urn), [URN_REGRA_LEGAL]);
  });
});
