import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { abreviarUrnsParaCodigos, codigosDoPacote, esquemaQueAceitaCodigos, traduzirCodigosParaUrn } from './codigosCurtos.ts';
import { pacoteDeTeste, urnDeTeste } from './fixturesDeTeste.ts';
import { esquemaEvidencia } from './plano.ts';

const pacote = pacoteDeTeste();
const codigos = codigosDoPacote(pacote);
const urnA = pacote.entradas[0]!.urn;
const urnB = pacote.entradas[1]!.urn;

describe('códigos curtos das entradas', () => {
  it('numera na ordem do catálogo e depois das entradas, sem repetir', () => {
    const extra = urnDeTeste('regra', 'so-no-catalogo');
    const c = codigosDoPacote({ entradas: pacote.entradas, catalogo: [{ urn: extra, tipo: 'regra', titulo: 'x', incluida: false }, { urn: urnA, tipo: 'regra', titulo: 'y', incluida: true }] });
    assert.equal(c.codigoDaUrn.get(extra), 'e1');
    assert.equal(c.codigoDaUrn.get(urnA), 'e2');
    assert.equal(c.urnDoCodigo.get('e1'), extra);
    assert.equal(new Set(c.codigoDaUrn.values()).size, c.codigoDaUrn.size);
  });

  it('é determinístico para o mesmo pacote', () => {
    assert.deepEqual([...codigosDoPacote(pacote).codigoDaUrn], [...codigos.codigoDaUrn]);
  });

  it('traduz só os campos urn e fontes, e só código conhecido', () => {
    const entrada = { evidencias: [{ urn: 'e1', papel: 'favor' }, { urn: 'e999', papel: 'favor' }, { urn: urnB, papel: 'premissa' }], fontes: ['e2', 'texto'], descricao: 'e1', nome: 'e2' };
    const saida = traduzirCodigosParaUrn(entrada, codigos) as typeof entrada;
    assert.equal(saida.evidencias[0]!.urn, urnA);
    assert.equal(saida.evidencias[1]!.urn, 'e999');
    assert.equal(saida.evidencias[2]!.urn, urnB);
    assert.deepEqual(saida.fontes, [urnB, 'texto']);
    assert.equal(saida.descricao, 'e1');
    assert.equal(saida.nome, 'e2');
  });

  it('não altera o objeto de entrada', () => {
    const entrada = { evidencias: [{ urn: 'e1', papel: 'favor' }] };
    const copia = JSON.stringify(entrada);
    traduzirCodigosParaUrn(entrada, codigos);
    assert.equal(JSON.stringify(entrada), copia);
  });

  it('abreviar é o inverso, e URN desconhecida fica como está', () => {
    const desconhecida = urnDeTeste('regra', 'desconhecida');
    const saida = abreviarUrnsParaCodigos({ evidencias: [{ urn: urnA }, { urn: desconhecida }], fontes: [urnB] }, codigos) as { evidencias: { urn: string }[]; fontes: string[] };
    assert.equal(saida.evidencias[0]!.urn, 'e1');
    assert.equal(saida.evidencias[1]!.urn, desconhecida);
    assert.deepEqual(saida.fontes, ['e2']);
  });

  it('o esquema aceita código, aceita URN inteira e recusa código que não existe', () => {
    const esquema = esquemaQueAceitaCodigos(esquemaEvidencia, codigos);
    const doCodigo = esquema.safeParse({ urn: 'e1', papel: 'favor' });
    assert.ok(doCodigo.success && doCodigo.data.urn === urnA);
    assert.ok(esquema.safeParse({ urn: urnB, papel: 'favor' }).success);
    assert.equal(esquema.safeParse({ urn: 'e999', papel: 'favor' }).success, false);
    assert.equal(esquema.safeParse({ urn: 'qualquer coisa', papel: 'favor' }).success, false);
  });

  it('o esquema com códigos continua gerando JSON Schema nos dois modos', () => {
    const esquema = esquemaQueAceitaCodigos(z.strictObject({ evidencias: z.array(esquemaEvidencia) }), codigos);
    for (const io of ['input', 'output'] as const) assert.doesNotThrow(() => z.toJSONSchema(esquema, { io }));
  });
});
