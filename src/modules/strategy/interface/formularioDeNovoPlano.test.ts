import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModeloDeCriacao } from '../application/estrategiaService.ts';
import { campoDoFormulario, errosPorCampo, formularioDeNovoPlano, previaNaTela } from './formularioDeNovoPlano.ts';
import { lerPedidoDePrevia } from './formulariosDaEstrategia.ts';

const CLIENTE = '22222222-2222-4222-8222-222222222222';
const PAGINA = '33333333-3333-4333-8333-333333333333';

const modelo = (sobrescrita: Partial<ModeloDeCriacao> = {}): ModeloDeCriacao => ({
  tipos: [
    { tipo: 'aquisicao', rotulo: 'Aquisição' },
    { tipo: 'marca', rotulo: 'Marca' },
  ],
  plataformas: [
    { plataforma: 'google', rotulo: 'Google' },
    { plataforma: 'meta', rotulo: 'Meta' },
  ],
  landingPages: [{ id: PAGINA, rotulo: 'Oferta', url: 'https://exemplo.com.br/oferta' }],
  whatsapp: '+5511999998888',
  whatsappAusente: false,
  podeCriar: true,
  chaveDeIdempotencia: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ...sobrescrita,
});

describe('formulário de novo plano', () => {
  it('só oferece as plataformas que o modelo devolve e marca os valores digitados', () => {
    const vm = formularioDeNovoPlano(modelo(), { tipoDePlano: 'marca', plataformas: 'meta', landingPageId: PAGINA, ousadia: 'ousado', objetivo: 'Mais leads' }, CLIENTE);
    assert.deepEqual(vm.plataformas.map((p) => [p.valor, p.marcada]), [['google', false], ['meta', true]]);
    assert.equal(vm.tipos.find((t) => t.marcada)?.valor, 'marca');
    assert.equal(vm.landingPages[0]?.marcada, true);
    assert.equal(vm.ousadias.find((o) => o.marcada)?.valor, 'ousado');
    assert.equal(vm.valores.objetivo, 'Mais leads');
  });

  it('começa em aquisição e ousadia moderada', () => {
    const vm = formularioDeNovoPlano(modelo(), {}, CLIENTE);
    assert.equal(vm.tipos.find((t) => t.marcada)?.valor, 'aquisicao');
    assert.equal(vm.ousadias.find((o) => o.marcada)?.valor, 'moderado');
  });

  it('WhatsApp ausente mostra mensagem e link para o cadastro do cliente; sem landing page, idem', () => {
    const vm = formularioDeNovoPlano(modelo({ whatsapp: null, whatsappAusente: true, landingPages: [], podeCriar: false }), {}, CLIENTE);
    assert.equal(vm.whatsapp.ausente, true);
    assert.equal(vm.whatsapp.link?.href, `/clientes/${CLIENTE}/contexto?secao=destino`);
    assert.equal(vm.semLandingPage?.link.href, `/clientes/${CLIENTE}/contexto?secao=destino`);
    assert.equal(vm.podeCriar, false);
  });

  it('WhatsApp cadastrado aparece como texto, sem link', () => {
    const vm = formularioDeNovoPlano(modelo(), {}, CLIENTE);
    assert.deepEqual(vm.whatsapp, { texto: '+5511999998888', ausente: false, link: null });
    assert.equal(vm.semLandingPage, null);
  });
});

describe('prévia de UTM na tela', () => {
  it('expõe a URL e os três parâmetros de cada plataforma', () => {
    const vista = previaNaTela({ itens: [{ plataforma: 'meta', rotulo: 'Meta', utm: { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'aq_2026-12_leads' }, url: 'https://exemplo.com.br/oferta?utm_source=meta' }] });
    assert.equal(vista.itens[0]?.rotulo, 'Meta');
    assert.deepEqual(vista.itens[0]?.parametros.map((p) => p.nome), ['utm_source', 'utm_medium', 'utm_campaign']);
  });

  it('pedido de prévia exige tipo, plataforma, landing page, objetivo e início', () => {
    const vazio = lerPedidoDePrevia({});
    assert.equal(vazio.ok, false);
    if (!vazio.ok) assert.deepEqual(Object.keys(vazio.error).sort(), ['inicio', 'landingPageId', 'objetivo', 'plataformas', 'tipoDePlano']);
    const ok = lerPedidoDePrevia({ tipoDePlano: 'aquisicao', plataformas: 'google,meta', landingPageId: PAGINA, objetivo: 'Mais leads', inicio: '2026-12-01' });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.deepEqual(ok.value.plataformas, ['google', 'meta']);
  });
});

describe('erros do servidor junto do campo', () => {
  it('traduz chaves do servidor para os campos do formulário', () => {
    assert.equal(campoDoFormulario('intencao.objetivo'), 'objetivo');
    assert.equal(campoDoFormulario('nomeDaCampanha'), 'objetivo');
    assert.equal(campoDoFormulario('intencao.horizonte.inicio'), 'inicio');
    assert.equal(campoDoFormulario('intencao.horizonte.fim'), 'fim');
    assert.equal(campoDoFormulario('intencao.verba.centavos'), 'verba');
    assert.equal(campoDoFormulario('intencao.retorno_esperado.descricao'), 'retorno');
    assert.equal(campoDoFormulario('plataformas.0'), 'plataformas');
    assert.equal(campoDoFormulario('landingPageId'), 'landingPageId');
    assert.equal(campoDoFormulario('codigo'), null);
  });

  it('descarta chaves sem campo e mantém a primeira mensagem de cada campo', () => {
    assert.deepEqual(errosPorCampo({ codigo: 'whatsapp_do_cliente_ausente', landingPageId: 'Landing page arquivada.', 'intencao.objetivo': 'Curto.', objetivo: 'Outra.' }), {
      landingPageId: 'Landing page arquivada.',
      objetivo: 'Curto.',
    });
  });

  it('a chave de idempotência vem do modelo e se mantém quando o formulário volta com erro', () => {
    assert.equal(formularioDeNovoPlano(modelo(), {}, CLIENTE).chaveDeIdempotencia, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(formularioDeNovoPlano(modelo({ chaveDeIdempotencia: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), { chaveDeIdempotencia: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, CLIENTE).chaveDeIdempotencia, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });
});
