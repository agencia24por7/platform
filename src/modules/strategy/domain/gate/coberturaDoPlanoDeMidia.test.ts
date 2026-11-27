import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextoDeTeste } from '../fixturesDeTeste.ts';
import { checarCoberturaDoPlanoDeMidia } from './coberturaDoPlanoDeMidia.ts';

describe('gate: cobertura_do_plano_de_midia', () => {
  it('aprova quando todo campo obrigatório do catálogo está no plano, com justificativa', () => {
    assert.equal(checarCoberturaDoPlanoDeMidia(contextoDeTeste()).resultado, 'aprovado');
  });

  it('falha fechada sem catálogo da plataforma escolhida', () => {
    const r = checarCoberturaDoPlanoDeMidia(contextoDeTeste({ catalogosDeCampos: undefined }));
    assert.equal(r.resultado, 'reprovado');
    assert.equal(r.onde.length, 2);
    assert.ok(r.onde.every((o) => o.includes('sem catálogo')));

    const completo = contextoDeTeste();
    const parcial = checarCoberturaDoPlanoDeMidia({ ...completo, catalogosDeCampos: completo.catalogosDeCampos!.filter((c) => c.plataforma === 'google') });
    assert.equal(parcial.resultado, 'reprovado');
    assert.deepEqual(parcial.onde, ['plano_de_midia/meta (sem catálogo de campos: não é possível conferir)']);
  });

  it('reprova intenção sem plataformas', () => {
    const contexto = contextoDeTeste();
    contexto.plano.intencao.plataformas = undefined;
    assert.equal(checarCoberturaDoPlanoDeMidia(contexto).resultado, 'reprovado');
  });

  it('reprova campo obrigatório ausente e lista onde', () => {
    const contexto = contextoDeTeste();
    const google = contexto.plano.plano_de_midia.plataformas[0]!;
    google.secoes = google.secoes.filter((s) => s.secao !== 'orcamento_e_lances');
    const r = checarCoberturaDoPlanoDeMidia(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.deepEqual(r.onde, ['plano_de_midia/google/orcamento_diario (campo obrigatório ausente)']);
  });

  it('plataforma escolhida sem entrada no plano reprova todos os obrigatórios', () => {
    const contexto = contextoDeTeste();
    contexto.plano.plano_de_midia.plataformas = [];
    assert.equal(checarCoberturaDoPlanoDeMidia(contexto).onde.length, 4);
  });

  it('campo opcional pode faltar; presente, tem de ter justificativa', () => {
    const contexto = contextoDeTeste();
    assert.equal(checarCoberturaDoPlanoDeMidia(contexto).resultado, 'aprovado');
    contexto.plano.plano_de_midia.plataformas[0]!.secoes[0]!.campos[0]!.justificativa = '   ';
    const r = checarCoberturaDoPlanoDeMidia(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.includes('sem justificativa'));
  });

  it('reprova campo fora do catálogo, na seção errada ou com valor de outro tipo', () => {
    const contexto = contextoDeTeste();
    const google = contexto.plano.plano_de_midia.plataformas[0]!;
    google.secoes[0]!.campos.push({ campo: 'inventado', valor: 'x', justificativa: 'j', evidencias: [] });
    google.secoes[1]!.campos[0]!.valor = 'muito';
    google.secoes[0]!.campos[0]!.valor = 'sorteio';
    contexto.plano.plano_de_midia.plataformas[1]!.secoes[1]!.secao = 'objetivo';
    const r = checarCoberturaDoPlanoDeMidia(contexto);
    assert.equal(r.resultado, 'reprovado');
    const texto = r.onde.join('|');
    assert.ok(texto.includes('inventado (campo fora do catálogo)'));
    assert.ok(texto.includes('orcamento_diario (valor fora do tipo numero)'));
    assert.ok(texto.includes('objetivo_da_campanha (valor fora do tipo escolha)'));
    assert.ok(texto.includes('posicionamento_automatico (na seção objetivo; o catálogo pede posicionamentos)'));
  });

  it('url_de_destino, numero_do_whatsapp e parametros_de_url precisam ser os da intenção', () => {
    const catalogo = {
      plataforma: 'meta' as const,
      versaoDaApi: 'v99',
      objetivos: ['leads'],
      campos: [
        { chave: 'url_de_destino', secao: 'conversao', obrigatorio: true, tipoDoValor: 'texto' as const },
        { chave: 'parametros_de_url', secao: 'conversao', obrigatorio: true, tipoDoValor: 'texto' as const },
        { chave: 'numero_do_whatsapp', secao: 'conversao', obrigatorio: true, tipoDoValor: 'texto' as const },
      ],
    };
    const base = contextoDeTeste();
    const intencao = { ...base.plano.intencao, plataformas: ['meta' as const] };
    const utm = intencao.utm!.meta!;
    const campo = (nome: string, valor: string) => ({ campo: nome, valor, justificativa: 'copiado da intenção', evidencias: [] });
    const comValores = (url: string, parametros: string, zap: string) => ({
      ...base,
      catalogosDeCampos: [catalogo],
      plano: {
        ...base.plano,
        intencao,
        plano_de_midia: { plataformas: [{ plataforma: 'meta' as const, secoes: [{ secao: 'conversao', campos: [campo('url_de_destino', url), campo('parametros_de_url', parametros), campo('numero_do_whatsapp', zap)] }] }] },
      },
    });
    const certos = `utm_source=${utm.utm_source}&utm_medium=${utm.utm_medium}&utm_campaign=${utm.utm_campaign}`;
    assert.equal(checarCoberturaDoPlanoDeMidia(comValores(intencao.destino!.url, certos, intencao.whatsapp!)).resultado, 'aprovado');
    assert.equal(checarCoberturaDoPlanoDeMidia(comValores('https://outro.com', certos, intencao.whatsapp!)).resultado, 'reprovado');
    assert.equal(checarCoberturaDoPlanoDeMidia(comValores(intencao.destino!.url, 'utm_source=inventada', intencao.whatsapp!)).resultado, 'reprovado');
    assert.equal(checarCoberturaDoPlanoDeMidia(comValores(intencao.destino!.url, certos, '+5511900000000')).resultado, 'reprovado');
  });
});
