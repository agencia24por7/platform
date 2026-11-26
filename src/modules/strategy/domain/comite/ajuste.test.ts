import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TAMANHO_MAXIMO_DO_AJUSTE_BYTES, esquemaAjuste, tamanhoDoAjuste, validarAjuste, type Ajuste, type RespostaDoAjuste } from './ajuste.ts';
import { parecer, ponto } from './fixturesDeParecer.ts';
import { MAXIMO_DE_PONTOS_POR_PARECER } from './parecer.ts';
import { PERSONAS } from './personas.ts';

const VERSAO = '55555555-5555-4555-8555-555555555555';

const resposta = (persona: string, pontoId: string, decisao: RespostaDoAjuste['decisao'] = 'acatado'): RespostaDoAjuste => ({
  persona,
  pontoId,
  decisao,
  motivo: 'Motivo.',
});

const pareceres = [
  parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas'), ponto('p2', 'criativos')]),
  parecer('risco_legal', 'reprova', [ponto('p1', 'riscos_e_regras')]),
];

const codigos = (ajuste: Ajuste) => {
  const r = validarAjuste(pareceres, ajuste);
  return r.ok ? [] : r.error.map((e) => e.codigo);
};

describe('esquemaAjuste', () => {
  it('exige responde_a como uuid', () => {
    assert.equal(esquemaAjuste.safeParse({ respostas: [] }).success, false);
    assert.equal(esquemaAjuste.safeParse({ responde_a: 'v0', respostas: [] }).success, false);
  });

  it('aceita respostas válidas e recusa decisão fora da lista, motivo vazio e chave extra', () => {
    assert.equal(esquemaAjuste.safeParse({ responde_a: VERSAO, respostas: [resposta('redator', 'p1')] }).success, true);
    assert.equal(esquemaAjuste.safeParse({ responde_a: VERSAO, respostas: [{ ...resposta('redator', 'p1'), decisao: 'ignorado' }] }).success, false);
    assert.equal(esquemaAjuste.safeParse({ responde_a: VERSAO, respostas: [{ ...resposta('redator', 'p1'), motivo: '' }] }).success, false);
    assert.equal(esquemaAjuste.safeParse({ responde_a: VERSAO, respostas: [], extra: 1 }).success, false);
  });

  it('motivo acima de 160 caracteres é recusado', () => {
    assert.equal(esquemaAjuste.safeParse({ responde_a: VERSAO, respostas: [{ ...resposta('redator', 'p1'), motivo: 'm'.repeat(161) }] }).success, false);
  });

  it('o ajuste máximo (9 personas × 5 pontos, tudo no limite) cabe em 16 KB', () => {
    const respostas: RespostaDoAjuste[] = PERSONAS.flatMap((persona) =>
      Array.from({ length: MAXIMO_DE_PONTOS_POR_PARECER }, (_, i) => ({
        persona: persona.chave,
        pontoId: `p${i}`.padEnd(32, 'x'),
        decisao: 'nao_acatado' as const,
        motivo: 'm'.repeat(160),
      })),
    );
    assert.equal(respostas.length, 45);
    const maximo = { responde_a: VERSAO, respostas };
    assert.ok(tamanhoDoAjuste(maximo) < TAMANHO_MAXIMO_DO_AJUSTE_BYTES, String(tamanhoDoAjuste(maximo)));
    assert.equal(esquemaAjuste.safeParse(maximo).success, true);
  });

  it('acima de 16 KB o esquema recusa', () => {
    const respostas = Array.from({ length: 80 }, (_, i) => ({ ...resposta('representante_do_cliente', `p${i}`.padEnd(32, 'x')), motivo: 'm'.repeat(160) }));
    assert.ok(tamanhoDoAjuste({ responde_a: VERSAO, respostas }) > TAMANHO_MAXIMO_DO_AJUSTE_BYTES);
    assert.equal(esquemaAjuste.safeParse({ responde_a: VERSAO, respostas }).success, false);
  });
});

describe('validarAjuste', () => {
  it('aceita quando todo ponto tem resposta e a pendência obrigatória é acatada', () => {
    const ajuste = { responde_a: VERSAO, respostas: [resposta('redator', 'p1', 'nao_acatado'), resposta('redator', 'p2'), resposta('risco_legal', 'p1')] };
    assert.deepEqual(codigos(ajuste), []);
  });

  it('o mesmo pontoId de personas diferentes são pontos diferentes', () => {
    assert.deepEqual(codigos({ responde_a: VERSAO, respostas: [resposta('redator', 'p1'), resposta('redator', 'p2')] }), ['ponto_sem_resposta']);
  });

  it('recusa ponto sem resposta', () => {
    assert.deepEqual(codigos({ responde_a: VERSAO, respostas: [resposta('redator', 'p1'), resposta('risco_legal', 'p1')] }), ['ponto_sem_resposta']);
  });

  it('recusa pendência obrigatória não acatada', () => {
    const ajuste = { responde_a: VERSAO, respostas: [resposta('redator', 'p1'), resposta('redator', 'p2'), resposta('risco_legal', 'p1', 'nao_acatado')] };
    assert.deepEqual(codigos(ajuste), ['pendencia_obrigatoria_nao_acatada']);
  });

  it('recusa resposta duplicada e resposta a ponto inexistente', () => {
    const ajuste = {
      responde_a: VERSAO,
      respostas: [resposta('redator', 'p1'), resposta('redator', 'p1'), resposta('redator', 'p2'), resposta('risco_legal', 'p1'), resposta('sdr', 'p7')],
    };
    assert.deepEqual(codigos(ajuste).sort(), ['resposta_duplicada', 'resposta_sem_ponto']);
  });

  it('sem pareceres, ajuste vazio vale', () => {
    assert.equal(validarAjuste([], { responde_a: VERSAO, respostas: [] }).ok, true);
  });
});
