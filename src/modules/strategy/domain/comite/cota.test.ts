import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TAMANHO_MAXIMO_DO_AJUSTE_BYTES, ajustarRespostasAoTamanho, esquemaAjuste, tamanhoDoAjuste, type RespostaDoAjuste } from './ajuste.ts';
import { COMITES, type Comite } from './comites.ts';
import { repartirCotaDoJuiz, sintetizarComitesComCota, type EntradaDaSintese } from './cota.ts';
import { parecer, ponto } from './fixturesDeParecer.ts';
import { MAXIMO_DE_PONTOS_NO_JUIZ, pontosParaJulgar } from './juiz.ts';
import { mesaQueConcorda } from './fixturesDoComite.ts';
import type { Parecer, Veredito } from './parecer.ts';

const pontos = (prefixo: string, quantos: number) => Array.from({ length: quantos }, (_, i) => ponto(`${prefixo}${i}`, 'campanhas'));

function entrada(comite: Comite, veredito: Veredito, quantos: number): EntradaDaSintese {
  const relatora = comite.membros.find((membro) => membro.relatora)!;
  const pareceres = comite.membros.map((membro) =>
    membro.chave === relatora.chave ? parecer(membro.chave, veredito, veredito === 'aprova' ? [] : pontos(`p${membro.chave.slice(0, 6)}`, quantos)) : parecer(membro.chave, 'aprova'),
  );
  return { comite, pareceres, mesa2: mesaQueConcorda(comite, 2) };
}

function pareceresDosComites(comites: readonly Comite[], riscoLegal: Veredito, veredito: Veredito = 'aprova_com_ajuste', quantos = 5): Parecer[] {
  const entradas = comites.map((comite) => entrada(comite, comite.obrigaAjuste ? riscoLegal : veredito, quantos));
  const sinteses = sintetizarComitesComCota(entradas);
  assert.ok(sinteses.ok);
  return comites.map((comite) => sinteses.value.get(comite.chave)!.parecer);
}

const noJuiz = (pareceres: readonly Parecer[]) => pontosParaJulgar(pareceres).length;
const total = (pareceres: readonly Parecer[]) => pareceres.reduce((soma, p) => soma + p.pontos.length, 0);

describe('cota do juiz', () => {
  it('17 comitês pedindo 5 pontos cada, risco_legal reprovando: o juiz recebe exatamente 45 e o risco_legal vai direto ao ajuste', () => {
    assert.equal(COMITES.length, 17);
    const pareceres = pareceresDosComites(COMITES, 'reprova');
    assert.equal(noJuiz(pareceres), MAXIMO_DE_PONTOS_NO_JUIZ);
    assert.equal(pareceres.find((p) => p.persona === 'risco_legal')!.pontos.length, 5);
    assert.ok(total(pareceres) <= 80);
  });

  it('17 comitês, risco_legal sem reprovar: os 17 dividem a cota e o juiz nunca passa de 45', () => {
    for (const veredito of ['aprova_com_ajuste', 'aprova'] as const) {
      const pareceres = pareceresDosComites(COMITES, veredito);
      assert.ok(noJuiz(pareceres) <= MAXIMO_DE_PONTOS_NO_JUIZ);
    }
    assert.equal(noJuiz(pareceresDosComites(COMITES, 'aprova_com_ajuste')), MAXIMO_DE_PONTOS_NO_JUIZ);
  });

  it('17 comitês com todos reprovando: o teto do juiz e o do ajuste se mantêm', () => {
    const pareceres = pareceresDosComites(COMITES, 'reprova', 'reprova');
    assert.ok(noJuiz(pareceres) <= MAXIMO_DE_PONTOS_NO_JUIZ);
    assert.ok(total(pareceres) <= 80);
  });

  it('a sobra vai na ordem: veredito mais severo, depois mais pontos pedidos, depois ordem do catálogo', () => {
    const pedidos = Array.from({ length: 16 }, (_, i) => ({ chave: `c${i}`, obrigaAjuste: false, veredito: 'aprova_com_ajuste' as Veredito, pontosPedidos: 5 }));
    const cotas = repartirCotaDoJuiz(pedidos);
    assert.deepEqual(pedidos.map((p) => cotas.get(p.chave)), [5, 5, 5, 5, 3, ...Array(11).fill(2)]);
    const comSevero = [...pedidos.slice(0, 15), { ...pedidos[15]!, veredito: 'reprova' as Veredito }];
    const cotas2 = repartirCotaDoJuiz(comSevero);
    assert.equal(cotas2.get('c15'), 5);
    assert.equal(cotas2.get('c0'), 5);
    const menosPedidos = [{ ...pedidos[0]!, pontosPedidos: 2 }, ...pedidos.slice(1)];
    assert.equal(repartirCotaDoJuiz(menosPedidos).get('c0'), 2);
    assert.equal([...repartirCotaDoJuiz(menosPedidos).values()].reduce((a, b) => a + b, 0), 45);
  });

  it('cada comitê recebe no mínimo floor(45/n) quando pede tanto', () => {
    const pedidos = Array.from({ length: 17 }, (_, i) => ({ chave: `c${i}`, obrigaAjuste: false, veredito: 'aprova_com_ajuste' as Veredito, pontosPedidos: 5 }));
    assert.ok([...repartirCotaDoJuiz(pedidos).values()].every((cota) => cota >= 2));
  });

  it('5 comitês: ninguém é cortado', () => {
    const cinco = COMITES.slice(0, 5);
    const pareceres = pareceresDosComites(cinco, 'reprova');
    assert.equal(total(pareceres), cinco.filter((c) => !c.obrigaAjuste).length * 5 + cinco.filter((c) => c.obrigaAjuste).length * 5);
    const comRisco = [...COMITES.slice(0, 4), COMITES.find((c) => c.obrigaAjuste)!];
    const p2 = pareceresDosComites(comRisco, 'reprova');
    assert.equal(noJuiz(p2), 20);
    assert.equal(total(p2), 25);
  });

  it('1 comitê: recebe os 45 e mantém os 5 pontos, com ou sem ser o risco_legal reprovando', () => {
    assert.equal(total(pareceresDosComites([COMITES[0]!], 'reprova')), 5);
    const risco = COMITES.find((c) => c.obrigaAjuste)!;
    assert.equal(noJuiz(pareceresDosComites([risco], 'reprova')), 0);
    assert.equal(noJuiz(pareceresDosComites([risco], 'aprova_com_ajuste')), 5);
  });
});

describe('teto de bytes do ajuste', () => {
  const resposta = (i: number, motivo: string): RespostaDoAjuste => ({ pontoId: `${'p'.repeat(20)}${i}`, persona: 'a'.repeat(30), decisao: 'nao_acatado', motivo });

  it('50 respostas com motivos de 160 caracteres multibyte são reduzidas para caber em 16 KB', () => {
    const respostas = Array.from({ length: 50 }, (_, i) => resposta(i, '漢'.repeat(160)));
    assert.ok(tamanhoDoAjuste({ responde_a: 'x', respostas }) > TAMANHO_MAXIMO_DO_AJUSTE_BYTES);
    const ajustadas = ajustarRespostasAoTamanho('9f1c2a4e-1b6d-4c3a-8e5f-0a1b2c3d4e5f', respostas);
    const ajuste = { responde_a: '9f1c2a4e-1b6d-4c3a-8e5f-0a1b2c3d4e5f', respostas: ajustadas };
    assert.ok(esquemaAjuste.safeParse(ajuste).success);
    assert.ok(ajustadas.every((r) => r.motivo.length > 0 && r.decisao === 'nao_acatado'));
  });

  it('o que já cabe não muda', () => {
    const respostas = [resposta(1, 'curto')];
    assert.deepEqual(ajustarRespostasAoTamanho('x', respostas), respostas);
  });

  it('o pior caso do motor (45 do juiz + 5 do risco) cabe com ids e personas máximos', () => {
    const respostas = Array.from({ length: 50 }, (_, i) => ({ pontoId: `a${String(i).padStart(2, '0')}${'z'.repeat(28)}`, persona: 'b'.repeat(47), decisao: 'acatado' as const, motivo: '😀'.repeat(80) }));
    const ajustadas = ajustarRespostasAoTamanho('9f1c2a4e-1b6d-4c3a-8e5f-0a1b2c3d4e5f', respostas);
    assert.ok(esquemaAjuste.safeParse({ responde_a: '9f1c2a4e-1b6d-4c3a-8e5f-0a1b2c3d4e5f', respostas: ajustadas }).success);
  });
});
