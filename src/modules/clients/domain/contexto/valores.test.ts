import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { campoLista, campoSimples } from './catalogo.ts';
import { normalizarArroba, normalizarUrl, validarItem, validarValor } from './valores.ts';

const campo = (key: string) => campoSimples(key)!.campo;

describe('normalização', () => {
  it('URL ganha https, perde fragmento e barra final e recusa esquemas perigosos', () => {
    assert.equal(normalizarUrl('  Exemplo.COM.br/ '), 'https://exemplo.com.br');
    assert.equal(normalizarUrl('http://loja.com/p?x=1#topo'), 'http://loja.com/p?x=1');
    assert.equal(normalizarUrl('javascript:alert(1)'), null);
    assert.equal(normalizarUrl('ftp://arquivos.com'), null);
    assert.equal(normalizarUrl('sem ponto'), null);
    assert.equal(normalizarUrl('https://usuario:senha@site.com'), null);
  });

  it('perfil vira @handle a partir de @, nome solto ou link da rede', () => {
    assert.equal(normalizarArroba('@@marca.oficial '), '@marca.oficial');
    assert.equal(normalizarArroba('marca_oficial'), '@marca_oficial');
    assert.equal(normalizarArroba('https://www.instagram.com/marca/?hl=pt'), '@marca');
    assert.equal(normalizarArroba('tiktok.com/@marca'), '@marca');
    assert.equal(normalizarArroba('linkedin.com/company/acme-ltda/'), '@acme-ltda');
    assert.equal(normalizarArroba('Página da Marca'), 'Página da Marca');
  });
});

describe('validação por tipo', () => {
  it('texto apara espaços e respeita o limite', () => {
    assert.deepEqual(validarValor(campo('segmento'), '  moda   praia '), { ok: true, valor: 'moda praia' });
    assert.equal(validarValor(campo('tagline'), 'x'.repeat(121)).ok, false);
  });

  it('vazio vira null (limpar o campo)', () => {
    assert.deepEqual(validarValor(campo('segmento'), '   '), { ok: true, valor: null });
    assert.deepEqual(validarValor(campo('modelo_de_negocio'), []), { ok: true, valor: null });
  });

  it('seleção aceita só opção do catálogo, salvo quando há "outro"', () => {
    assert.equal(validarValor(campo('area_de_atuacao'), 'nacional').ok, true);
    assert.equal(validarValor(campo('area_de_atuacao'), 'galáctica').ok, false);
    assert.equal(validarValor(campo('crm'), 'Zoho').ok, true);
  });

  it('múltipla remove repetidos e recusa opção estranha', () => {
    assert.deepEqual(validarValor(campo('modelo_de_negocio'), ['b2b', 'b2b', 'servico']), {
      ok: true,
      valor: ['b2b', 'servico'],
    });
    assert.equal(validarValor(campo('modelo_de_negocio'), ['b2b', 'xpto']).ok, false);
  });

  it('dinheiro em texto vira centavos', () => {
    assert.deepEqual(validarValor(campo('orcamento_mensal_total'), 'R$ 12.500,50'), { ok: true, valor: 1250050 });
    assert.deepEqual(validarValor(campo('orcamento_mensal_total'), 999), { ok: true, valor: 999 });
    assert.equal(validarValor(campo('orcamento_mensal_total'), -1).ok, false);
  });

  it('escala só de 1 a 5', () => {
    assert.equal(validarValor(campo('tom_formal_informal'), 3).ok, true);
    assert.equal(validarValor(campo('tom_formal_informal'), 6).ok, false);
    assert.equal(validarValor(campo('tom_formal_informal'), 2.5).ok, false);
  });

  it('número respeita inteiro e faixa', () => {
    assert.equal(validarValor(campo('nps'), -100).ok, true);
    assert.equal(validarValor(campo('nps'), 101).ok, false);
    assert.equal(validarValor(campo('taxa_de_conversao'), '2,5%').ok, true);
  });

  it('URL inválida é recusada com mensagem em português', () => {
    const resultado = validarValor(campo('site'), 'javascript:alert(1)');
    assert.equal(resultado.ok, false);
    assert.match((resultado as { erro: string }).erro, /http/);
  });

  it('arquivo é lista de ids', () => {
    assert.equal(validarValor(campo('logo'), ['33333333-3333-4333-8333-333333333333']).ok, true);
    assert.equal(validarValor(campo('logo'), ['../../etc/passwd']).ok, false);
  });
});

describe('itens de lista', () => {
  const redes = campoLista('redes_sociais')!.campo;

  it('normaliza e guarda só o preenchido', () => {
    const resultado = validarItem(redes, {
      rede: 'instagram',
      perfil: 'https://instagram.com/marca',
      link: '',
      seguidores: '12.300',
    });
    assert.deepEqual(resultado, { ok: true, dados: { rede: 'instagram', perfil: '@marca', seguidores: 12300 } });
  });

  it('exige os obrigatórios e recusa campo desconhecido', () => {
    const resultado = validarItem(redes, { perfil: '@marca', senha: 'x' });
    assert.equal(resultado.ok, false);
    const erros = (resultado as { erros: Record<string, string> }).erros;
    assert.ok(erros.rede);
    assert.ok(erros.senha);
  });

  it('recusa o que não é objeto', () => {
    assert.equal(validarItem(redes, ['x']).ok, false);
    assert.equal(validarItem(redes, null).ok, false);
  });
});
