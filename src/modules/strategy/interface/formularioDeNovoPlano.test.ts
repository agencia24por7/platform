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
  produtos: [
    { urn: 'orla:p1', rotulo: 'Tênis' },
    { urn: 'orla:p2', rotulo: 'Camiseta' },
  ],
  produtosIndisponiveis: false,
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
    assert.deepEqual(vm.selecionados, { tipo: 'marca', landingPage: PAGINA, ousadia: 'ousado' });
  });

  it('sem página escolhida o select de landing page fica no valor vazio', () => {
    assert.equal(formularioDeNovoPlano(modelo(), {}, CLIENTE).selecionados.landingPage, '');
    assert.equal(formularioDeNovoPlano(modelo(), { landingPageId: 'outra' }, CLIENTE).selecionados.landingPage, '');
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

describe('modo da verba no formulário', () => {
  it('começa em total do período e oferece período e mensal', () => {
    const vm = formularioDeNovoPlano(modelo(), {}, CLIENTE);
    assert.deepEqual(vm.modosDaVerba.map((m) => [m.valor, m.rotulo, m.marcada]), [['periodo', 'Total do período', true], ['mensal', 'Por mês', false]]);
    assert.equal(vm.valores.modoDaVerba, 'periodo');
  });

  it('mantém o modo escolhido quando o formulário volta e ignora modo inválido', () => {
    const mensal = formularioDeNovoPlano(modelo(), { modoDaVerba: 'mensal', verba: '1.000,00' }, CLIENTE);
    assert.deepEqual(mensal.modosDaVerba.map((m) => m.marcada), [false, true]);
    assert.equal(mensal.valores.modoDaVerba, 'mensal');
    assert.equal(formularioDeNovoPlano(modelo(), { modoDaVerba: 'x' }, CLIENTE).valores.modoDaVerba, 'periodo');
  });

  it('erro de verba continua mapeado para o campo verba', () => {
    assert.deepEqual(errosPorCampo({ verba: 'A verba precisa ser maior que zero.' }), { verba: 'A verba precisa ser maior que zero.' });
  });
});

describe('foco do plano no formulário', () => {
  it('lista os produtos do cliente e mantém a escolha depois de Ver links', () => {
    const vm = formularioDeNovoPlano(modelo(), { produtos: 'orla:p2' }, CLIENTE);
    assert.deepEqual(vm.foco.produtos.map((p) => [p.rotulo, p.marcada]), [['Tênis', false], ['Camiseta', true]]);
    assert.equal(vm.foco.marca.marcada, false);
    assert.equal(vm.foco.marca.rotulo, 'Campanha de marca');
    assert.equal(vm.foco.semProdutos, null);
  });

  it('campanha de marca marcada ignora produtos e muda a chave do grupo (remonta o componente)', () => {
    const marca = formularioDeNovoPlano(modelo(), { focoMarca: '1', produtos: 'orla:p1' }, CLIENTE);
    assert.equal(marca.foco.marca.marcada, true);
    assert.ok(marca.foco.produtos.every((p) => !p.marcada));
    const produtos = formularioDeNovoPlano(modelo(), { produtos: 'orla:p1' }, CLIENTE);
    assert.notEqual(marca.foco.chave, produtos.foco.chave);
  });

  it('cliente sem produto: lista vazia com aviso e link para o Contexto, e ainda pode criar campanha de marca', () => {
    const vm = formularioDeNovoPlano(modelo({ produtos: [] }), {}, CLIENTE);
    assert.equal(vm.foco.produtos.length, 0);
    assert.match(vm.foco.semProdutos?.texto ?? '', /ainda não tem produto cadastrado/);
    assert.equal(vm.foco.semProdutos?.link?.href, `/clientes/${CLIENTE}/contexto`);
    assert.equal(vm.podeCriar, true);
  });

  it('leitura dos produtos indisponível avisa e oferece só a marca', () => {
    const vm = formularioDeNovoPlano(modelo({ produtos: [], produtosIndisponiveis: true }), {}, CLIENTE);
    assert.match(vm.foco.semProdutos?.texto ?? '', /Não foi possível ler os produtos/);
    assert.equal(vm.foco.semProdutos?.link, null);
  });

  it('erro do servidor sobre o foco aparece no campo foco', () => {
    assert.equal(campoDoFormulario('foco.produtos'), 'foco');
    assert.deepEqual(errosPorCampo({ 'foco.produtos': 'Produto não encontrado neste cliente.' }), { foco: 'Produto não encontrado neste cliente.' });
  });
});
