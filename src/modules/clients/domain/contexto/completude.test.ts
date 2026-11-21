import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGO } from './catalogo.ts';
import { calcularCompletude, proximosCampos } from './completude.ts';
import { anexo, entrada, item } from './fixturesDeTeste.ts';

const vazio = { campos: [], itens: [], arquivos: [] };

describe('completude', () => {
  it('contexto vazio é zero em tudo e o próximo campo é o primeiro essencial', () => {
    const completude = calcularCompletude(vazio);
    assert.equal(completude.geral, 0);
    assert.equal(completude.essenciaisCompletos, false);
    assert.equal(completude.secoes.length, CATALOGO.length);
    assert.equal(proximosCampos(vazio, 1)[0]?.fieldKey, 'nome_empresa');
  });

  it('essencial pesa mais que aprofundar', () => {
    const comEssencial = calcularCompletude({ ...vazio, campos: [entrada('segmento', 'moda')] });
    const comAprofundar = calcularCompletude({ ...vazio, campos: [entrada('missao', 'servir')] });
    const empresa = (c: typeof comEssencial) => c.secoes.find((s) => s.secao === 'empresa')!.percentual;
    assert.ok(empresa(comEssencial) > empresa(comAprofundar));
  });

  it('sugestão da IA não conta até ser confirmada', () => {
    const sugerido = calcularCompletude({ ...vazio, campos: [entrada('segmento', 'moda', { fonte: 'ia', revisao: 'sugerido' })] });
    assert.equal(sugerido.geral, 0);
    const falta = proximosCampos({ ...vazio, campos: [entrada('nome_empresa', 'X'), entrada('segmento', 'moda', { revisao: 'sugerido' })] }, 1);
    assert.deepEqual([falta[0]?.fieldKey, falta[0]?.motivo], ['segmento', 'sugestao_pendente']);
  });

  it('lista fica completa com o mínimo de itens confirmados e conta parcial antes disso', () => {
    const dois = calcularCompletude({
      ...vazio,
      itens: [item('diferenciais', { diferencial: 'a' }), item('diferenciais', { diferencial: 'b' })],
    });
    const tres = calcularCompletude({
      ...vazio,
      itens: [
        item('diferenciais', { diferencial: 'a' }),
        item('diferenciais', { diferencial: 'b' }),
        item('diferenciais', { diferencial: 'c' }),
      ],
    });
    const empresa = (c: typeof dois) => c.secoes.find((s) => s.secao === 'empresa')!;
    assert.equal(empresa(dois).essenciaisPreenchidos, 0);
    assert.equal(empresa(tres).essenciaisPreenchidos, 1);
    assert.ok(empresa(dois).percentual > 0 && empresa(dois).percentual < empresa(tres).percentual);

    const falta = proximosCampos({ ...vazio, itens: [item('diferenciais', { diferencial: 'a' })] }, 20, ['empresa']);
    assert.equal(falta.find((f) => f.fieldKey === 'diferenciais')?.faltamItens, 2);
  });

  it('arquivo anexado conta o campo de arquivo', () => {
    const c = calcularCompletude({ ...vazio, arquivos: [anexo('logo', 'logo.png')] });
    assert.equal(c.secoes.find((s) => s.secao === 'marca')!.preenchidos, 1);
  });

  it('notas internas não contam', () => {
    const c = calcularCompletude({ ...vazio, campos: [entrada('notas_internas_empresa', 'segredo')] });
    assert.equal(c.geral, 0);
  });

  it('seção com todos os essenciais fica marcada como pronta para começar', () => {
    const c = calcularCompletude({
      ...vazio,
      campos: [
        entrada('processo_de_venda', 'consultivo'),
        entrada('atendimento_do_lead', 'em 5 minutos pelo WhatsApp'),
      ],
    });
    const comercial = c.secoes.find((s) => s.secao === 'comercial')!;
    assert.equal(comercial.essenciaisCompletos, true);
    assert.ok(comercial.percentual < 100);
  });

  it('próximos campos respeitam o limite e o filtro de seções, essenciais primeiro', () => {
    const falta = proximosCampos(vazio, 50, ['comercial']);
    assert.ok(falta.every((f) => f.secao === 'comercial'));
    const primeiroAprofundar = falta.findIndex((f) => f.nivel === 'aprofundar');
    assert.ok(falta.slice(0, primeiroAprofundar).every((f) => f.nivel === 'essencial'));
    assert.equal(proximosCampos(vazio, 3).length, 3);
  });
});
