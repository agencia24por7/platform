import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogoMeta } from './catalogo/meta.ts';
import { planoCompleto } from './fixturesDeTeste.ts';
import { parecer as fabricarParecer, ponto } from './comite/fixturesDeParecer.ts';
import {
  parecerSemDadoPessoal,
  planoSemDadoPessoal,
  problemasDoGateSemDadoPessoal,
  respostasDoAjusteSemDadoPessoal,
  sanitizarIntencao,
  secaoDoCaminho,
  textosDoPlano,
} from './privacidadeDoPlano.ts';

describe('textosDoPlano', () => {
  it('devolve todo texto com o caminho, inclusive em listas, e ignora números e booleanos', () => {
    const textos = textosDoPlano({ a: 'x', b: { c: ['y', { d: 'z' }], n: 3, f: true } });
    assert.deepEqual(textos, [
      { caminho: 'a', texto: 'x' },
      { caminho: 'b.c[0]', texto: 'y' },
      { caminho: 'b.c[1].d', texto: 'z' },
    ]);
    assert.equal(secaoDoCaminho('diagnostico.situacao.texto'), 'diagnostico');
    assert.equal(secaoDoCaminho('lacunas[0].descricao'), 'lacunas');
  });

  it('o plano completo tem texto em várias seções', () => {
    const secoes = new Set(textosDoPlano(planoCompleto()).map((t) => secaoDoCaminho(t.caminho)));
    assert.ok(secoes.has('resumo_executivo') && secoes.has('diagnostico') && secoes.has('campanhas'));
  });
});

describe('planoSemDadoPessoal', () => {
  it('aprova o plano de fixture', () => {
    assert.deepEqual(planoSemDadoPessoal(planoCompleto()), { ok: true, value: true });
  });

  it('acusa e-mail, telefone e CPF apontando a seção e o caminho, sem repetir o dado', () => {
    for (const dado of ['maria@exemplo.com', '(11) 98888-7777', '123.456.789-09']) {
      const plano = planoCompleto();
      plano.diagnostico.situacao.texto = `Falar com ${dado} sobre a conta.`;
      const resultado = planoSemDadoPessoal(plano);
      assert.equal(resultado.ok, false);
      if (resultado.ok) continue;
      assert.equal(resultado.error[0]!.secao, 'diagnostico');
      assert.match(resultado.error[0]!.caminho, /^diagnostico\.situacao/);
      assert.ok(!JSON.stringify(resultado.error).includes(dado));
    }
  });

  it('acha o dado em item de lista e em seção diferente', () => {
    const plano = planoCompleto();
    plano.lacunas.itens[0]!.descricao = 'Contato: joao@exemplo.com';
    const resultado = planoSemDadoPessoal(plano);
    assert.equal(!resultado.ok && resultado.error[0]!.secao, 'lacunas');
  });
});

describe('planoSemDadoPessoal: WhatsApp do papel whatsapp', () => {
  const comWhatsapp = (valor: string) => {
    const plano = planoCompleto();
    plano.plano_de_midia.plataformas = [
      { plataforma: 'meta', secoes: [{ secao: 'adset', campos: [{ campo: 'adset_po_whatsapp_phone', valor, justificativa: 'copiado da intenção', evidencias: [] }] }] },
    ];
    return plano;
  };

  it('isenta só o valor exato da intenção no campo de papel whatsapp', () => {
    const plano = comWhatsapp(planoCompleto().intencao.whatsapp!);
    assert.deepEqual(planoSemDadoPessoal(plano, [catalogoMeta]), { ok: true, value: true });
    assert.equal(planoSemDadoPessoal(plano).ok, false);
  });

  it('número de terceiro no campo real continua acusado', () => {
    assert.equal(planoSemDadoPessoal(comWhatsapp('+5511900000000'), [catalogoMeta]).ok, false);
  });

  it('o número na justificativa ou em campo de outro papel continua acusado', () => {
    const numero = planoCompleto().intencao.whatsapp!;
    const plano = comWhatsapp(numero);
    plano.plano_de_midia.plataformas[0]!.secoes[0]!.campos[0]!.justificativa = `Falar em ${numero}`;
    assert.equal(planoSemDadoPessoal(plano, [catalogoMeta]).ok, false);
    const outro = comWhatsapp(numero);
    outro.plano_de_midia.plataformas[0]!.secoes[0]!.campos[0]!.campo = 'creative_message';
    assert.equal(planoSemDadoPessoal(outro, [catalogoMeta]).ok, false);
  });
});

describe('sanitizarIntencao', () => {
  const base = () => planoCompleto().intencao;

  it('mantém o que está limpo e normaliza espaços', () => {
    const intencao = { ...base(), objetivo: '  Gerar   leads  qualificados ' };
    const resultado = sanitizarIntencao(intencao);
    assert.ok(resultado.ok);
    if (resultado.ok) assert.equal(resultado.value.objetivo, 'Gerar leads qualificados');
  });

  it('troca e-mail, telefone e CPF por [omitido] e preserva o resto da intenção', () => {
    const intencao = { ...base(), objetivo: 'Gerar leads e avisar maria@exemplo.com ou (11) 98888-7777 e 123.456.789-09' };
    const resultado = sanitizarIntencao(intencao);
    assert.ok(resultado.ok);
    if (!resultado.ok) return;
    assert.ok(!/maria@|98888|123\.456/.test(JSON.stringify(resultado.value)));
    assert.equal(resultado.value.ousadia, intencao.ousadia);
    assert.deepEqual(resultado.value.verba, intencao.verba);
    assert.deepEqual(resultado.value.horizonte, intencao.horizonte);
  });

  it('recusa campo que vira só o texto omitido', () => {
    const resultado = sanitizarIntencao({ ...base(), objetivo: 'maria@exemplo.com' });
    assert.equal(!resultado.ok && resultado.error[0]!.campo, 'objetivo');
    const descricao = sanitizarIntencao({ ...base(), retorno_esperado: { descricao: '123.456.789-09' } });
    assert.equal(!descricao.ok && descricao.error[0]!.campo, 'retorno_esperado.descricao');
  });
});

describe('texto livre do Comitê, do ajuste e do Gate por modelo', () => {
  const urn = 'orla:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:conhecimento:benchmark-b';

  it('parecer limpo passa; e-mail no motivo, telefone no problema ou CPF no ajuste pedido não', () => {
    assert.equal(parecerSemDadoPessoal(fabricarParecer('redator', 'aprova_com_ajuste', [ponto('p1', 'estrategia', [urn])])).ok, true);
    const motivo = { ...fabricarParecer('redator', 'aprova'), motivo: 'Falar com maria@exemplo.com' };
    const r = parecerSemDadoPessoal(motivo);
    assert.equal(r.ok, false);
    const comTelefone = fabricarParecer('redator', 'aprova_com_ajuste', [ponto('p1', 'estrategia', [urn])]);
    comTelefone.pontos[0]!.problema = 'Ligar (11) 98888-7777';
    assert.equal(parecerSemDadoPessoal(comTelefone).ok, false);
    const comCpf = fabricarParecer('redator', 'aprova_com_ajuste', [ponto('p1', 'estrategia', [urn])]);
    comCpf.pontos[0]!.ajustePedido = 'Cliente 123.456.789-09';
    assert.equal(parecerSemDadoPessoal(comCpf).ok, false);
  });

  it('respostas do ajuste e problemas do Gate', () => {
    assert.equal(respostasDoAjusteSemDadoPessoal([{ pontoId: 'p1', persona: 'redator', decisao: 'acatado', motivo: 'ok' }]).ok, true);
    assert.equal(respostasDoAjusteSemDadoPessoal([{ pontoId: 'p1', persona: 'redator', decisao: 'acatado', motivo: 'maria@exemplo.com' }]).ok, false);
    assert.equal(problemasDoGateSemDadoPessoal([{ trecho: 'campanhas', problema: 'Meta alta demais' }]).ok, true);
    assert.equal(problemasDoGateSemDadoPessoal([{ trecho: 'campanhas', problema: 'Ligar para (11) 98888-7777' }]).ok, false);
  });
});
