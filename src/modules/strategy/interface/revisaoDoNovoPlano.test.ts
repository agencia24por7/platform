import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { ModeloDeCriacao } from '../application/estrategiaService.ts';
import { formularioDeNovoPlano } from './formularioDeNovoPlano.ts';
import { revisaoDoNovoPlano } from './revisaoDoNovoPlano.ts';

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

const COMPLETOS = {
  tipoDePlano: 'marca',
  plataformas: 'google,meta',
  produtos: 'orla:p2',
  landingPageId: PAGINA,
  objetivo: 'Mais leads',
  inicio: '2026-12-01',
  fim: '2027-02-28',
  ousadia: 'ousado',
  modoDaVerba: 'mensal',
  verba: '1.000,00',
  retorno: '300 leads por mês',
};

const normalizar = (texto: string) => texto.replace(/\s/g, ' ');

describe('revisão do novo plano', () => {
  it('resume o que foi escolhido, com rótulos e sem pendências', () => {
    const vm = formularioDeNovoPlano(modelo(), COMPLETOS, CLIENTE);
    const revisao = revisaoDoNovoPlano(vm, COMPLETOS);
    assert.equal(revisao.pendencias, 0);
    assert.equal(revisao.bloqueio, null);
    assert.deepEqual(revisao.grupos.map((g) => [g.chave, g.passo]), [['tipo', 0], ['destino', 1], ['horizonte', 2], ['verba', 3]]);
    const valores = Object.fromEntries(revisao.grupos.flatMap((g) => g.itens.map((i) => [i.rotulo, normalizar(i.valor)])));
    assert.equal(valores['Tipo de plano'], 'Marca');
    assert.equal(valores['Plataformas'], 'Google, Meta');
    assert.equal(valores['Foco do plano'], 'Camiseta');
    assert.equal(valores['Landing page'], 'Oferta (https://exemplo.com.br/oferta)');
    assert.equal(valores['WhatsApp do cliente'], '+5511999998888');
    assert.equal(valores['Horizonte'], '01/12/2026 a 28/02/2027');
    assert.equal(valores['Ousadia'], vm.ousadias.find((o) => o.valor === 'ousado')?.rotulo);
    assert.equal(valores['Total do horizonte'], 'R$ 3.000,00 em 90 dias');
    assert.equal(valores['Equivalente por mês'], 'R$ 1.000,00');
  });

  it('verba mensal explica a conversão; verba por período não', () => {
    const vm = formularioDeNovoPlano(modelo(), COMPLETOS, CLIENTE);
    const total = (campos: Record<string, string>) => revisaoDoNovoPlano(vm, campos).grupos.flatMap((g) => g.itens).find((i) => i.rotulo === 'Total do horizonte');
    assert.ok(total(COMPLETOS)?.nota);
    assert.equal(total({ ...COMPLETOS, modoDaVerba: 'periodo', verba: '3.000,00' })?.nota, null);
  });

  it('foco de marca vence produtos e campos vazios viram pendência', () => {
    const vm = formularioDeNovoPlano(modelo(), {}, CLIENTE);
    const marca = revisaoDoNovoPlano(vm, { ...COMPLETOS, focoMarca: '1' });
    assert.equal(marca.grupos[1]?.itens[0]?.valor, 'Campanha de marca');
    const vazia = revisaoDoNovoPlano(vm, {});
    assert.equal(vazia.pendencias, 9);
    assert.equal(vazia.grupos.flatMap((g) => g.itens).filter((i) => !i.vazio).map((i) => i.rotulo).join(), 'WhatsApp do cliente');
    assert.equal(vazia.grupos[3]?.itens[0]?.rotulo, 'Verba');
  });

  it('cliente sem cadastro completo bloqueia e aponta o passo do destino', () => {
    const vm = formularioDeNovoPlano(modelo({ whatsapp: null, whatsappAusente: true, podeCriar: false }), COMPLETOS, CLIENTE);
    const revisao = revisaoDoNovoPlano(vm, COMPLETOS);
    assert.equal(revisao.bloqueio?.passo, 1);
    assert.equal(revisao.grupos[1]?.itens[2]?.vazio, true);
  });
});
