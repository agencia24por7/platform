import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chaveDeIdempotencia,
  diasParaVencer,
  estaVigente,
  mencionaPessoa,
  normalizarLote,
  normalizarSinal,
  notaSustentaAfirmacao,
  radarSemSinalVigente,
  semRepetidosNoLote,
  TIPO_NO_CATALOGO,
  TIPOS_DE_SINAL,
  vigentes,
} from './cultura.ts';

const AGORA = new Date('2026-11-20T15:00:00Z');

const valido = (extra: Record<string, unknown> = {}) => ({
  tipo: 'tendencia',
  titulo: '  Corrida   de rua  em alta ',
  resumo: 'Cresce o volume de conversas sobre corrida de rua entre iniciantes.',
  fonteNome: 'Google Trends',
  fonteUrl: 'https://trends.google.com/trends/explore?q=corrida#topo',
  plataforma: 'google_trends',
  observadoEm: '2026-11-18',
  validoAte: '2026-12-18',
  nota: 'B',
  ...extra,
});

const detalhes = (r: ReturnType<typeof normalizarSinal>) => (r.ok ? {} : (r.error.details ?? {}));

describe('sinal de cultura: normalização', () => {
  it('normaliza espaços, remove o fragmento da URL e entrega o sinal tipado', () => {
    const r = normalizarSinal(valido(), AGORA);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.titulo, 'Corrida de rua em alta');
    assert.equal(r.value.fonteUrl, 'https://trends.google.com/trends/explore?q=corrida');
    assert.equal(r.value.plataforma, 'google_trends');
  });

  it('plataforma vazia vira nula e plataforma fora do padrão é recusada', () => {
    const vazia = normalizarSinal(valido({ plataforma: '' }), AGORA);
    assert.ok(vazia.ok && vazia.value.plataforma === null);
    assert.ok('plataforma' in detalhes(normalizarSinal(valido({ plataforma: 'Rede Social!' }), AGORA)));
  });

  it('mapeia os seis tipos para os tipos do catálogo', () => {
    assert.deepEqual(
      TIPOS_DE_SINAL.map((t) => TIPO_NO_CATALOGO[t]),
      ['culture_tendencia', 'culture_meme', 'culture_conversa', 'culture_comunidade', 'culture_referencia', 'culture_anti_referencia'],
    );
  });

  it('recusa campo desconhecido (estrito), inclusive origem vinda do corpo', () => {
    assert.equal(normalizarSinal(valido({ origem: 'manual' }), AGORA).ok, false);
    assert.equal(normalizarSinal(valido({ organizationId: 'x' }), AGORA).ok, false);
  });

  it('recusa tipo, nota e tamanhos fora do limite', () => {
    assert.ok('tipo' in detalhes(normalizarSinal(valido({ tipo: 'moda' }), AGORA)));
    assert.ok('nota' in detalhes(normalizarSinal(valido({ nota: 'E' }), AGORA)));
    assert.ok('titulo' in detalhes(normalizarSinal(valido({ titulo: 'x'.repeat(161) }), AGORA)));
    assert.ok('resumo' in detalhes(normalizarSinal(valido({ resumo: 'x'.repeat(601) }), AGORA)));
    assert.ok('resumo' in detalhes(normalizarSinal(valido({ resumo: '   ' }), AGORA)));
  });
});

describe('sinal de cultura: sem dado pessoal', () => {
  const casos: Array<[string, string]> = [
    ['@handle no início', '@fulana viralizou'],
    ['@handle no meio', 'o vídeo de @fulana_oficial viralizou'],
    ['e-mail', 'contato maria@exemplo.com.br sobre o assunto'],
    ['telefone com DDD', 'fale no (11) 99999-8888 sobre o assunto'],
    ['telefone internacional', 'chame +55 11 99999-8888 agora'],
    ['CPF', 'cadastro 123.456.789-09 citado'],
  ];
  for (const [nome, texto] of casos) {
    it(`recusa ${nome} no título e no resumo`, () => {
      assert.equal(mencionaPessoa(texto), true);
      assert.ok('titulo' in detalhes(normalizarSinal(valido({ titulo: texto }), AGORA)));
      assert.ok('resumo' in detalhes(normalizarSinal(valido({ resumo: texto }), AGORA)));
      assert.ok('fonteNome' in detalhes(normalizarSinal(valido({ fonteNome: texto }), AGORA)));
    });
  }

  it('aceita hashtag, número grande e arroba sem nome colado', () => {
    assert.equal(mencionaPessoa('#corridaderua com 1.500.000 de visualizações'), false);
    assert.equal(mencionaPessoa('preço de R$ 5 @ loja'), false);
  });
});

describe('sinal de cultura: URL da fonte', () => {
  const recusas: Array<[string, string]> = [
    ['http', 'http://exemplo.com.br/x'],
    ['credencial embutida', 'https://usuario:senha@exemplo.com.br/x'],
    ['IP', 'https://10.0.0.1/x'],
    ['host interno', 'https://painel.internal/x'],
    ['porta', 'https://exemplo.com.br:8443/x'],
    ['espaço', 'https://exemplo.com.br/a b'],
    ['sem esquema', 'exemplo.com.br/x'],
  ];
  for (const [nome, url] of recusas) {
    it(`recusa ${nome}`, () => assert.ok('fonteUrl' in detalhes(normalizarSinal(valido({ fonteUrl: url }), AGORA))));
  }
  it('recusa URL acima de 2048 caracteres', () => {
    assert.ok('fonteUrl' in detalhes(normalizarSinal(valido({ fonteUrl: `https://exemplo.com.br/${'a'.repeat(2100)}` }), AGORA)));
  });
});

describe('sinal de cultura: validade', () => {
  it('aceita exatamente 90 dias e recusa 91', () => {
    assert.ok(normalizarSinal(valido({ observadoEm: '2026-11-20', validoAte: '2027-02-18' }), AGORA).ok);
    assert.ok('validoAte' in detalhes(normalizarSinal(valido({ observadoEm: '2026-11-20', validoAte: '2027-02-19' }), AGORA)));
  });
  it('recusa validade anterior à observação, data inexistente e observação no futuro', () => {
    assert.ok('validoAte' in detalhes(normalizarSinal(valido({ observadoEm: '2026-11-20', validoAte: '2026-11-19' }), AGORA)));
    assert.ok('observadoEm' in detalhes(normalizarSinal(valido({ observadoEm: '2026-02-30' }), AGORA)));
    assert.ok('observadoEm' in detalhes(normalizarSinal(valido({ observadoEm: '2026-11-25', validoAte: '2026-12-10' }), AGORA)));
  });
  it('recusa sinal que já nasceria vencido', () => {
    assert.ok('validoAte' in detalhes(normalizarSinal(valido({ observadoEm: '2026-09-01', validoAte: '2026-11-19' }), AGORA)));
  });
  it('vigência é inclusiva no último dia; vencido sai; radar sem sinal vigente', () => {
    assert.equal(estaVigente({ validoAte: '2026-11-20' }, '2026-11-20'), true);
    assert.equal(estaVigente({ validoAte: '2026-11-19' }, '2026-11-20'), false);
    assert.deepEqual(vigentes([{ validoAte: '2026-11-19' }, { validoAte: '2026-11-21' }], '2026-11-20'), [{ validoAte: '2026-11-21' }]);
    assert.equal(radarSemSinalVigente([], '2026-11-20'), true);
    assert.equal(radarSemSinalVigente([{ validoAte: '2026-11-19' }], '2026-11-20'), true);
    assert.equal(radarSemSinalVigente([{ validoAte: '2026-11-20' }], '2026-11-20'), false);
    assert.equal(diasParaVencer({ validoAte: '2026-11-27' }, '2026-11-20'), 7);
  });
  it('nota D não sustenta afirmação', () => {
    assert.equal(notaSustentaAfirmacao('D'), false);
    for (const nota of ['A', 'B', 'C'] as const) assert.equal(notaSustentaAfirmacao(nota), true);
  });
});

describe('lote do coletor', () => {
  it('aceita de 1 a 50 sinais e recusa vazio, 51 e campo extra na raiz', () => {
    assert.ok(normalizarLote({ sinais: [valido()] }, AGORA).ok);
    assert.equal(normalizarLote({ sinais: [] }, AGORA).ok, false);
    assert.equal(normalizarLote({ sinais: Array.from({ length: 50 }, (_, i) => valido({ fonteUrl: `https://exemplo.com.br/${i}` })) }, AGORA).ok, true);
    assert.equal(normalizarLote({ sinais: Array.from({ length: 51 }, (_, i) => valido({ fonteUrl: `https://exemplo.com.br/${i}` })) }, AGORA).ok, false);
    assert.equal(normalizarLote({ sinais: [valido()], extra: 1 }, AGORA).ok, false);
    assert.equal(normalizarLote(null, AGORA).ok, false);
    assert.equal(normalizarLote({}, AGORA).ok, false);
  });

  it('um item inválido derruba o lote inteiro e aponta o índice', () => {
    const r = normalizarLote({ sinais: [valido(), valido({ titulo: '@perfil' })] }, AGORA);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(Object.keys(r.error.details ?? {}).some((c) => c.startsWith('sinais.1.titulo')));
  });

  it('idempotência por URL (sem caixa) e dia: repetidos no lote colapsam', () => {
    const a = normalizarSinal(valido({ fonteUrl: 'https://Exemplo.com.br/Post' }), AGORA);
    const b = normalizarSinal(valido({ fonteUrl: 'https://exemplo.com.br/Post', titulo: 'Outro título' }), AGORA);
    const c = normalizarSinal(valido({ fonteUrl: 'https://exemplo.com.br/Post', observadoEm: '2026-11-19' }), AGORA);
    assert.ok(a.ok && b.ok && c.ok);
    if (!a.ok || !b.ok || !c.ok) return;
    assert.equal(chaveDeIdempotencia(a.value), chaveDeIdempotencia(b.value));
    assert.notEqual(chaveDeIdempotencia(a.value), chaveDeIdempotencia(c.value));
    assert.equal(semRepetidosNoLote([a.value, b.value, c.value]).length, 2);
  });
});
