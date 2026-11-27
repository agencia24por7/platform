import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErroUtm, PADRAO_DE_UTM, aplicarUtm, montarUtm, previaDeUtm } from './utm.ts';

const entradaBase = {
  plataforma: 'google',
  tipoDePlano: 'Essencial',
  slugDoPlano: 'plano-mensal',
  periodo: '202611',
};

function codigoDoErro(fn: () => unknown): string {
  try {
    fn();
  } catch (erro) {
    assert.ok(erro instanceof ErroUtm, 'deve lançar ErroUtm');
    return erro.codigo;
  }
  assert.fail('deveria ter lançado');
}

describe('PADRAO_DE_UTM', () => {
  it('define as cinco chaves e a tabela fixa de medium por plataforma', () => {
    assert.deepEqual(PADRAO_DE_UTM.chaves, [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
    ]);
    assert.equal(PADRAO_DE_UTM.plataformas.google.medium, 'cpc');
    assert.equal(PADRAO_DE_UTM.plataformas.meta.medium, 'paid_social');
    assert.equal(PADRAO_DE_UTM.plataformas.tiktok.medium, 'paid_social');
    assert.equal(PADRAO_DE_UTM.plataformas.linkedin.medium, 'paid_social');
  });
});

describe('montarUtm', () => {
  it('monta source, medium e campaign no formato tipo-slug-yyyymm', () => {
    assert.deepEqual(montarUtm(entradaBase), {
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'essencial-plano-mensal-202611',
    });
  });

  it('remove acentos e normaliza espaços e caixa', () => {
    const utm = montarUtm({
      ...entradaBase,
      tipoDePlano: 'Pró Avançado',
      slugDoPlano: 'Promoção de Verão!',
      content: 'Anúncio Azul & Verde',
    });
    assert.equal(utm.utm_campaign, 'pro-avancado-promocao-de-verao-202611');
    assert.equal(utm.utm_content, 'anuncio-azul-verde');
  });

  it('aceita periodo no formato AAAA-MM', () => {
    assert.equal(montarUtm({ ...entradaBase, periodo: '2026-11' }).utm_campaign, 'essencial-plano-mensal-202611');
  });

  it('rejeita periodo fora do formato', () => {
    assert.equal(codigoDoErro(() => montarUtm({ ...entradaBase, periodo: '202613' })), 'periodo_invalido');
  });

  it('rejeita valor que fica vazio após normalização', () => {
    assert.equal(codigoDoErro(() => montarUtm({ ...entradaBase, slugDoPlano: '!!!' })), 'valor_vazio');
  });

  it('aceita campaign de exatamente 50 caracteres e rejeita 51', () => {
    const tipo = 'a'.repeat(50 - '-b-202611'.length);
    assert.equal(montarUtm({ ...entradaBase, tipoDePlano: tipo, slugDoPlano: 'b' }).utm_campaign.length, 50);
    assert.equal(
      codigoDoErro(() => montarUtm({ ...entradaBase, tipoDePlano: `${tipo}x`, slugDoPlano: 'b' })),
      'valor_longo',
    );
  });

  it('rejeita utm_content acima de 50 caracteres', () => {
    assert.equal(codigoDoErro(() => montarUtm({ ...entradaBase, content: 'c'.repeat(51) })), 'valor_longo');
  });

  it('aceita utm_term apenas em busca (google)', () => {
    assert.equal(montarUtm({ ...entradaBase, term: 'Plano Mensal' }).utm_term, 'plano-mensal');
    assert.equal(
      codigoDoErro(() => montarUtm({ ...entradaBase, plataforma: 'meta', term: 'x' })),
      'termo_nao_permitido',
    );
  });

  it('lança ErroUtm tipado para plataforma desconhecida', () => {
    assert.equal(codigoDoErro(() => montarUtm({ ...entradaBase, plataforma: 'myspace' })), 'plataforma_desconhecida');
    assert.equal(codigoDoErro(() => montarUtm({ ...entradaBase, plataforma: 'constructor' })), 'plataforma_desconhecida');
  });
});

describe('aplicarUtm', () => {
  const utm = montarUtm(entradaBase);

  it('anexa os parâmetros a uma URL sem query', () => {
    assert.equal(
      aplicarUtm('https://exemplo.com/planos', utm),
      'https://exemplo.com/planos?utm_source=google&utm_medium=cpc&utm_campaign=essencial-plano-mensal-202611',
    );
  });

  it('preserva a query existente e o fragmento', () => {
    const url = aplicarUtm('https://exemplo.com/planos?ref=site&q=a%20b#topo', utm);
    assert.equal(
      url,
      'https://exemplo.com/planos?ref=site&q=a%20b&utm_source=google&utm_medium=cpc&utm_campaign=essencial-plano-mensal-202611#topo',
    );
  });

  it('substitui UTM já presente na URL em vez de duplicar', () => {
    const url = aplicarUtm('https://exemplo.com/?utm_source=antigo&x=1', utm);
    const parametros = new URL(url).searchParams;
    assert.deepEqual(parametros.getAll('utm_source'), ['google']);
    assert.equal(parametros.get('x'), '1');
  });

  it('rejeita URL http', () => {
    assert.equal(codigoDoErro(() => aplicarUtm('http://exemplo.com/', utm)), 'url_nao_https');
  });

  it('rejeita URL malformada e protocolos que não são https', () => {
    assert.equal(codigoDoErro(() => aplicarUtm('não é url', utm)), 'url_invalida');
    assert.equal(codigoDoErro(() => aplicarUtm('javascript:alert(1)', utm)), 'url_nao_https');
  });
});

describe('previaDeUtm', () => {
  it('devolve uma URL por plataforma padrão, com term só na busca', () => {
    const previa = previaDeUtm({
      urlHttps: 'https://exemplo.com/planos',
      tipoDePlano: 'Essencial',
      slugDoPlano: 'plano-mensal',
      periodo: '202611',
      term: 'plano mensal',
    });
    assert.deepEqual(
      previa.map((item) => item.plataforma),
      Object.keys(PADRAO_DE_UTM.plataformas),
    );
    assert.equal(
      previa[0]?.url,
      'https://exemplo.com/planos?utm_source=google&utm_medium=cpc&utm_campaign=essencial-plano-mensal-202611&utm_term=plano-mensal',
    );
    assert.equal(
      previa[1]?.url,
      'https://exemplo.com/planos?utm_source=meta&utm_medium=paid_social&utm_campaign=essencial-plano-mensal-202611',
    );
  });

  it('aceita lista de plataformas e propaga erro de plataforma desconhecida', () => {
    const base = { urlHttps: 'https://exemplo.com/', tipoDePlano: 'essencial', slugDoPlano: 'mensal', periodo: '202611' };
    assert.equal(previaDeUtm({ ...base, plataformas: ['linkedin'] }).length, 1);
    assert.equal(codigoDoErro(() => previaDeUtm({ ...base, plataformas: ['orkut'] })), 'plataforma_desconhecida');
  });
});
