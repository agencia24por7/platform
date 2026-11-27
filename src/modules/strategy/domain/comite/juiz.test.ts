import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Ajuste } from './ajuste.ts';
import { parecer, ponto } from './fixturesDeParecer.ts';
import {
  argumentosParaAplicar,
  chaveDoPontoDoJuiz,
  conferirAjusteContraOJuiz,
  conferirVereditos,
  destinosDosPontos,
  esquemaSaidaDoJuiz,
  pontosParaJulgar,
  respostasDeRecusaDoJuiz,
  vereditosDoEvento,
  type VereditoDoJuiz,
} from './juiz.ts';
import { consolidarPareceres } from './consolidacao.ts';

const URN = 'urn:orla:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:conhecimento:benchmark-b';
const veredito = (persona: string, pontoId: string, v: 'aceito' | 'rejeitado', prova: string[] = []): VereditoDoJuiz => ({ persona, pontoId, veredito: v, motivo: `Motivo ${pontoId}.`, prova });
const pareceres = () => [
  parecer('redator', 'aprova_com_ajuste', [ponto('p1', 'campanhas', [URN]), ponto('p2', 'criativos')]),
  parecer('risco_legal', 'reprova', [ponto('p1', 'riscos_e_regras')]),
  parecer('sdr', 'aprova'),
];

describe('juiz do Comitê', () => {
  it('só os pontos que não são reprovação obrigatória vão ao juiz, todos num lote', () => {
    const pontos = pontosParaJulgar(pareceres());
    assert.deepEqual(pontos.map((p) => chaveDoPontoDoJuiz(p.persona, p.pontoId)), ['redator/p1', 'redator/p2']);
    assert.deepEqual(pontos[0]?.fontes, [URN]);
  });

  it('confere um veredito por ponto, sem duplicado nem estranho, e descarta prova fora do pacote', () => {
    const pontos = pontosParaJulgar(pareceres());
    const bom = conferirVereditos(pontos, { vereditos: [veredito('redator', 'p1', 'aceito', [URN, 'urn:orla:x:y:conhecimento:fora']), veredito('redator', 'p2', 'rejeitado')] }, new Set([URN]));
    assert.ok(bom.ok);
    assert.deepEqual(bom.ok && bom.value[0]?.prova, [URN]);
    const faltando = conferirVereditos(pontos, { vereditos: [veredito('redator', 'p1', 'aceito')] }, new Set([URN]));
    assert.deepEqual(!faltando.ok && faltando.error.map((e) => e.codigo), ['ponto_sem_veredito']);
    const duplicado = conferirVereditos(pontos, { vereditos: [veredito('redator', 'p1', 'aceito'), veredito('redator', 'p1', 'rejeitado'), veredito('redator', 'p2', 'aceito')] }, new Set());
    assert.deepEqual(!duplicado.ok && duplicado.error.map((e) => e.codigo), ['veredito_duplicado']);
    const estranho = conferirVereditos(pontos, { vereditos: [veredito('redator', 'p1', 'aceito'), veredito('redator', 'p2', 'aceito'), veredito('sdr', 'p9', 'aceito')] }, new Set());
    assert.deepEqual(!estranho.ok && estranho.error.map((e) => e.codigo), ['veredito_sem_ponto']);
  });

  it('aceito vira acatado, rejeitado vira não acatado com o motivo do juiz, e a obrigatória é sempre acatada', () => {
    const destinos = destinosDosPontos(pareceres(), [veredito('redator', 'p1', 'aceito'), veredito('redator', 'p2', 'rejeitado'), veredito('risco_legal', 'p1', 'rejeitado')]);
    assert.ok(destinos.ok);
    if (!destinos.ok) return;
    assert.deepEqual(destinos.value.get('redator/p1'), { decisao: 'acatado', origem: 'juiz' });
    assert.deepEqual(destinos.value.get('redator/p2'), { decisao: 'nao_acatado', origem: 'juiz', motivo: 'Juiz: Motivo p2.' });
    assert.deepEqual(destinos.value.get('risco_legal/p1'), { decisao: 'acatado', origem: 'obrigatoria' });
    assert.deepEqual(respostasDeRecusaDoJuiz(destinos.value), [{ persona: 'redator', pontoId: 'p2', decisao: 'nao_acatado', motivo: 'Juiz: Motivo p2.' }]);
  });

  it('sem veredito de um ponto não obrigatório falha fechado', () => {
    const destinos = destinosDosPontos(pareceres(), undefined);
    assert.equal(destinos.ok, false);
  });

  it('o agente de ajuste só recebe os pontos a aplicar, sem os rejeitados', () => {
    const lista = pareceres();
    const destinos = destinosDosPontos(lista, [veredito('redator', 'p1', 'aceito'), veredito('redator', 'p2', 'rejeitado')]);
    assert.ok(destinos.ok);
    if (!destinos.ok) return;
    const aplicar = argumentosParaAplicar(consolidarPareceres(lista).argumentos, destinos.value);
    const chaves = aplicar.flatMap((a) => a.pontos.map((p) => chaveDoPontoDoJuiz(p.persona, p.pontoId))).sort();
    assert.deepEqual(chaves, ['redator/p1', 'risco_legal/p1']);
  });

  it('o ajuste que deixa um aceito sem acatar, ou acata um rejeitado, é recusado', () => {
    const lista = pareceres();
    const vereditos = [veredito('redator', 'p1', 'aceito'), veredito('redator', 'p2', 'rejeitado')];
    const resposta = (persona: string, pontoId: string, decisao: 'acatado' | 'nao_acatado') => ({ persona, pontoId, decisao, motivo: 'm' });
    const bom: Ajuste = { responde_a: 'a', respostas: [resposta('redator', 'p1', 'acatado'), resposta('redator', 'p2', 'nao_acatado'), resposta('risco_legal', 'p1', 'acatado')] };
    assert.deepEqual(conferirAjusteContraOJuiz(lista, bom, vereditos), []);
    const mau: Ajuste = { responde_a: 'a', respostas: [resposta('redator', 'p1', 'nao_acatado'), resposta('redator', 'p2', 'acatado'), resposta('risco_legal', 'p1', 'acatado')] };
    assert.deepEqual(conferirAjusteContraOJuiz(lista, mau, vereditos).map((e) => e.codigo), ['aceito_nao_acatado', 'rejeitado_acatado']);
  });

  it('o esquema recusa veredito fora do formato e o evento só vale se o esquema passar', () => {
    assert.equal(esquemaSaidaDoJuiz.safeParse({ vereditos: [{ persona: 'redator', pontoId: 'p1', veredito: 'talvez', motivo: 'm', prova: [] }] }).success, false);
    assert.equal(esquemaSaidaDoJuiz.safeParse({ vereditos: [{ persona: 'redator', pontoId: 'p1', veredito: 'aceito', motivo: 'x'.repeat(161), prova: [] }] }).success, false);
    assert.equal(vereditosDoEvento({ vereditos: [] })?.length, 0);
    assert.equal(vereditosDoEvento({ lixo: true }), undefined);
  });
});
