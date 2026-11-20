import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coberturaPorColetas, coberturaPorMedida, escolherCobertura, lacunasEntre, unirJanelas } from './cobertura.ts';
import { codificarCursor, decodificarCursor, filtrarCatalogo, paginar } from './consulta.ts';
import { selar, type EntradaSemSelo } from './entrada.ts';
import { calcularFrescor, esperadoAte, piorFrescor, statusPorDado } from './frescor.ts';
import { jsonEstavel } from './jsonEstavel.ts';
import { aplicarPoliticaDeUso, MOTIVO_RESTRITO } from './politica.ts';
import { limparTextoLivre, procurarPii } from './privacidade.ts';
import { diasEntre, hojeEmSaoPaulo, somarDias } from './tempo.ts';
import { criarUrn, idSeguro, lerUrn, nomeDeArquivoDaUrn, urnDoCliente, UrnInvalidaError } from './urn.ts';
import { etagCasa } from '../interface/etag.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLI = '22222222-2222-4222-8222-222222222222';
const OUTRO = '33333333-3333-4333-8333-333333333333';

function entrada(id: string, extra: Partial<EntradaSemSelo> = {}): EntradaSemSelo {
  return {
    urn: criarUrn(ORG, CLI, 'tabela_de_dados', id),
    tipo: 'tabela_de_dados',
    id,
    titulo: `Tabela ${id}`,
    descricao: 'Descrição para o agente.',
    provedor: 'dados',
    plataforma: 'meta',
    referencia: { sistema: 'bigquery', local: `tria_dw.${id}` },
    esquema: null,
    grao: null,
    cobertura: null,
    frescor: null,
    qualidade: { completude: null, avisos: [] },
    acesso: { tipo: 'status' },
    sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido', retencao: 'x' },
    epistemico: null,
    valorResumido: null,
    tags: ['b', 'a', 'a'],
    relacoes: [],
    versao: 1,
    ...extra,
  };
}

describe('URN', () => {
  it('é estável, validada e só pertence ao próprio cliente', () => {
    const urn = criarUrn(ORG, CLI, 'fonte', 'abc');
    assert.equal(urn, `orla:${ORG}:${CLI}:fonte:abc`);
    assert.deepEqual(lerUrn(urn), { organizationId: ORG, clienteId: CLI, tipo: 'fonte', id: 'abc' });
    assert.ok(urnDoCliente(urn, ORG, CLI));
    assert.ok(!urnDoCliente(urn, ORG, OUTRO));
    assert.equal(lerUrn('orla:x:y:fonte:abc'), null);
    assert.throws(() => criarUrn(ORG, CLI, 'Tipo', 'abc'), UrnInvalidaError);
    assert.throws(() => criarUrn('ORG', CLI, 'fonte', 'abc'), UrnInvalidaError);
    assert.equal(nomeDeArquivoDaUrn(urn), 'fonte--abc.json');
  });

  it('idSeguro normaliza sem perder estabilidade', () => {
    assert.equal(idSeguro('presença_digital'), 'presenca_digital');
    assert.equal(idSeguro('presença_digital'), idSeguro('presença_digital'));
    assert.throws(() => idSeguro('!!!'));
  });
});

describe('tempo e frescor', () => {
  const agora = new Date('2026-11-20T15:00:00Z');

  it('dia em São Paulo e aritmética de datas', () => {
    assert.equal(hojeEmSaoPaulo(new Date('2026-11-21T02:00:00Z')), '2026-11-20');
    assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
    assert.equal(diasEntre('2026-01-01', '2026-01-31'), 31);
  });

  it('esperadoAte respeita o atraso da plataforma', () => {
    assert.equal(esperadoAte(1, agora), '2026-11-19');
    assert.equal(esperadoAte(3, agora), '2026-11-17');
  });

  it('fresco, atrasado, parado e desconhecido', () => {
    assert.equal(statusPorDado('2026-11-19', '2026-11-19'), 'fresco');
    assert.equal(statusPorDado('2026-11-18', '2026-11-19'), 'fresco');
    assert.equal(statusPorDado('2026-11-15', '2026-11-19'), 'atrasado');
    assert.equal(statusPorDado('2026-11-01', '2026-11-19'), 'parado');
    assert.equal(calcularFrescor({ dadoAte: null, ultimaAtualizacao: null, atrasoDias: 1, agora }).status, 'desconhecido');
    const recente = new Date('2026-11-20T09:00:00Z');
    assert.equal(calcularFrescor({ dadoAte: '2026-11-19', ultimaAtualizacao: recente, atrasoDias: 1, agora }).status, 'fresco');
    const velha = new Date('2026-11-01T09:00:00Z');
    assert.equal(calcularFrescor({ dadoAte: '2026-11-19', ultimaAtualizacao: velha, atrasoDias: 1, agora }).status, 'parado');
    assert.equal(piorFrescor(['fresco', 'desconhecido', 'atrasado']), 'atrasado');
    assert.equal(piorFrescor(['desconhecido']), 'desconhecido');
  });
});

describe('cobertura e lacunas', () => {
  it('une janelas sobrepostas e adjacentes', () => {
    assert.deepEqual(unirJanelas([
      { de: '2026-01-05', ate: '2026-01-10' },
      { de: '2026-01-01', ate: '2026-01-04' },
      { de: '2026-01-08', ate: '2026-01-12' },
      { de: '2026-01-20', ate: '2026-01-21' },
    ]), [{ de: '2026-01-01', ate: '2026-01-12' }, { de: '2026-01-20', ate: '2026-01-21' }]);
  });

  it('acha as lacunas dentro do intervalo, inclusive a final', () => {
    const lacunas = lacunasEntre([{ de: '2026-01-01', ate: '2026-01-10' }, { de: '2026-01-15', ate: '2026-01-20' }], '2026-01-01', '2026-01-25');
    assert.deepEqual(lacunas, [
      { de: '2026-01-11', ate: '2026-01-14', dias: 4 },
      { de: '2026-01-21', ate: '2026-01-25', dias: 5 },
    ]);
    assert.deepEqual(lacunasEntre([], '2026-01-01', '2026-01-02'), [{ de: '2026-01-01', ate: '2026-01-02', dias: 2 }]);
    assert.deepEqual(lacunasEntre([{ de: '2025-12-01', ate: '2026-02-01' }], '2026-01-01', '2026-01-31'), []);
  });

  it('cobertura por coletas conta dias e faltas até o esperado', () => {
    const cobertura = coberturaPorColetas([{ de: '2026-01-01', ate: '2026-01-10' }, { de: '2026-01-13', ate: '2026-01-18' }], '2026-01-20');
    assert.equal(cobertura.desde, '2026-01-01');
    assert.equal(cobertura.ate, '2026-01-18');
    assert.equal(cobertura.diasComDado, 16);
    assert.equal(cobertura.diasEsperados, 20);
    assert.equal(cobertura.diasFaltando, 4);
    assert.equal(cobertura.fonteDaMedida, 'coletas');
    assert.equal(coberturaPorColetas([], '2026-01-20').desde, null);
  });

  it('prefere a medida do BigQuery quando tem menos de 36 horas', () => {
    const agora = new Date('2026-11-20T15:00:00Z');
    const medida = { tabela: 't', desde: '2026-11-01', ate: '2026-11-19', linhas: 10, diasComDado: 17, medidoEm: new Date('2026-11-20T01:00:00Z') };
    const janelas = [{ de: '2026-11-10', ate: '2026-11-19' }];
    assert.equal(escolherCobertura(medida, janelas, '2026-11-19', agora).fonteDaMedida, 'gov_cobertura_cliente');
    assert.equal(escolherCobertura({ ...medida, medidoEm: new Date('2026-11-18T01:00:00Z') }, janelas, '2026-11-19', agora).fonteDaMedida, 'coletas');
    assert.equal(coberturaPorMedida(medida, '2026-11-19').diasFaltando, 2);
  });
});

describe('selo, hash e política de uso', () => {
  it('selo é determinístico e ignora a ordem de tags', () => {
    const a = selar(entrada('x'));
    const b = selar(entrada('x', { tags: ['a', 'b'] }));
    assert.equal(a.hash, b.hash);
    assert.deepEqual(a.tags, ['a', 'b']);
    assert.notEqual(a.hash, selar(entrada('x', { titulo: 'Outro título' })).hash);
    assert.equal(jsonEstavel({ b: 1, a: { d: 2, c: 1 } }), '{"a":{"c":1,"d":2},"b":1}');
  });

  it('omite negado, reduz restrito a metadados e corta relação para o omitido', () => {
    const negada = selar(entrada('negada', { sensibilidade: { nivel: 'restrito', piiPossivel: true, usoPorAgente: 'negado', retencao: 'x' } }));
    const restrita = selar(entrada('restrita', {
      sensibilidade: { nivel: 'pessoal_possivel', piiPossivel: true, usoPorAgente: 'restrito', retencao: 'x' },
      valorResumido: 'valor',
      acesso: { tipo: 'arquivo', caminho: 'orgs/x', mime: 'application/pdf', tamanhoBytes: 1 },
    }));
    const livre = selar(entrada('livre', { relacoes: [{ tipo: 'relacionada', urn: negada.urn }, { tipo: 'relacionada', urn: restrita.urn }] }));
    const resultado = aplicarPoliticaDeUso([negada, restrita, livre]);
    assert.equal(resultado.omitidas, 1);
    assert.equal(resultado.restritas, 1);
    assert.deepEqual(resultado.entradas.map((e) => e.id), ['restrita', 'livre']);
    const r = resultado.entradas[0]!;
    assert.deepEqual(r.acesso, { tipo: 'restrito', motivo: MOTIVO_RESTRITO });
    assert.equal(r.valorResumido, null);
    assert.notEqual(r.hash, restrita.hash);
    assert.deepEqual(resultado.entradas[1]!.relacoes.map((x) => x.urn), [restrita.urn]);
  });
});

describe('padrões de dado pessoal e segredo', () => {
  it('acha e-mail, telefone, CPF e tokens', () => {
    const tipos = (texto: string) => procurarPii(texto).map((a) => a.padrao);
    assert.deepEqual(tipos('fale com joao@empresa.com.br'), ['email']);
    assert.deepEqual(tipos('ligue (11) 98765-4321'), ['telefone']);
    assert.deepEqual(tipos('ligue +55 11 987654321'), ['telefone']);
    assert.deepEqual(tipos('cpf 123.456.789-09'), ['cpf']);
    assert.deepEqual(tipos('token EAA' + 'B'.repeat(30)), ['token_de_acesso']);
    assert.deepEqual(tipos('{"access_token": "x"}'), ['segredo_em_chave']);
  });

  it('não confunde id de conta de anúncio com telefone', () => {
    assert.deepEqual(procurarPii('Conta de anúncio (id 1234567890) e act_123456789012'), []);
    assert.deepEqual(procurarPii(`orgs/${ORG}/clientes/${CLI}/contexto/brain/perfil.json`), []);
  });

  it('limpa texto livre', () => {
    assert.equal(limparTextoLivre('a joao@x.com b'), 'a [omitido] b');
  });
});

describe('consulta do catálogo', () => {
  const entradas = ['c', 'a', 'b', 'd'].map((id) => selar(entrada(id, { titulo: `Título ${id.toUpperCase()}`, plataforma: id === 'd' ? null : 'meta', tags: id === 'd' ? ['plataforma:google'] : [] })));

  it('filtra por tipo, plataforma (inclusive pela tag) e texto sem acento', () => {
    assert.equal(filtrarCatalogo(entradas, { plataforma: 'google' }).length, 1);
    assert.equal(filtrarCatalogo(entradas, { plataforma: 'meta' }).length, 3);
    assert.equal(filtrarCatalogo(entradas, { q: 'titulo b' }).length, 1);
    assert.equal(filtrarCatalogo(entradas, { tipo: 'fonte' }).length, 0);
  });

  it('pagina em ordem estável de URN com cursor', () => {
    const primeira = paginar(entradas, 2, null);
    assert.deepEqual(primeira.entradas.map((e) => e.id), ['a', 'b']);
    assert.equal(primeira.total, 4);
    const segunda = paginar(entradas, 2, primeira.proximoCursor);
    assert.deepEqual(segunda.entradas.map((e) => e.id), ['c', 'd']);
    assert.equal(segunda.proximoCursor, null);
    assert.equal(decodificarCursor(codificarCursor('orla:x')), 'orla:x');
    assert.equal(decodificarCursor('lixo'), null);
  });

  it('ETag casa com e sem prefixo fraco', () => {
    assert.ok(etagCasa('"abc"', '"abc"'));
    assert.ok(etagCasa('W/"abc", "def"', '"abc"'));
    assert.ok(etagCasa('*', '"abc"'));
    assert.ok(!etagCasa(null, '"abc"'));
    assert.ok(!etagCasa('"x"', '"abc"'));
  });
});
