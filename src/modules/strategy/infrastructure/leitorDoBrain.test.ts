import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { EntradaDoCatalogo, EntradaSemSelo } from '../../brain/domain/entrada.ts';
import { ORGANIZACAO_ID, CLIENTE_ID, urnDeTeste } from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { selar } = await import('../../brain/domain/entrada.ts');
const { criarLeitorDoBrain, montarPacote, prioridadeDaEntrada } = await import('./leitorDoBrain.ts');
const { ok, err } = await import('../../../shared/result/result.ts');
const { failure } = await import('../../../shared/result/failure.ts');
const { esquemaPacoteDeLeitura } = await import('../domain/pacote.ts');

const entrada = (tipo: string, id: string, extra: Partial<EntradaSemSelo> = {}): EntradaDoCatalogo =>
  selar({
    urn: urnDeTeste(tipo, id),
    tipo,
    id,
    titulo: `Entrada ${id}`,
    descricao: `Descrição de ${id}.`,
    provedor: 'teste',
    plataforma: null,
    referencia: { sistema: 'teste', local: id },
    esquema: null,
    grao: null,
    cobertura: null,
    frescor: null,
    qualidade: { completude: null, avisos: [] },
    acesso: { tipo: 'status' },
    sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido', retencao: 'x' },
    epistemico: null,
    valorResumido: null,
    tags: [],
    relacoes: [],
    versao: 1,
    ...extra,
  });

const limites = { maximoDeEntradas: 600, maximoDeBytes: 300_000 };
const quando = new Date('2026-11-25T10:00:00Z');

describe('montarPacote', () => {
  it('negado fica de fora, restrito vira só metadados sem resumo, e o resto mapeia título, resumo e hash', () => {
    const permitida = entrada('regra', 'r1', { valorResumido: 'Teto mensal de R$ 10 mil.' });
    const negada = entrada('regra', 'r2', { sensibilidade: { nivel: 'restrito', piiPossivel: true, usoPorAgente: 'negado', retencao: 'x' } });
    const restrita = entrada('tabela_de_dados', 't1', {
      valorResumido: 'valor secreto',
      sensibilidade: { nivel: 'pessoal_possivel', piiPossivel: true, usoPorAgente: 'restrito', retencao: 'x' },
    });
    const pacote = montarPacote(ORGANIZACAO_ID, CLIENTE_ID, quando, [permitida, negada, restrita], limites);
    assert.equal(pacote.entradas.length, 2);
    assert.ok(!pacote.entradas.some((e) => e.urn === negada.urn));
    const r1 = pacote.entradas.find((e) => e.urn === permitida.urn)!;
    assert.equal(r1.resumo, 'Teto mensal de R$ 10 mil.');
    assert.equal(r1.hash, permitida.hash);
    assert.equal(r1.somenteMetadados, false);
    const t1 = pacote.entradas.find((e) => e.urn === restrita.urn)!;
    assert.equal(t1.somenteMetadados, true);
    assert.equal(t1.resumo, '');
    assert.ok(!JSON.stringify(pacote).includes('valor secreto'));
    assert.ok(esquemaPacoteDeLeitura.safeParse(pacote).success);
  });

  it('catálogo lista tudo que é visível, inclusive arquivo, marca o que não coube e deixa de fora negado', () => {
    const a = entrada('regra', 'r1');
    const b = entrada('contexto_secao', 'c1');
    const c = entrada('contexto_secao', 'c2');
    const negada = entrada('regra', 'rn', { sensibilidade: { nivel: 'restrito', piiPossivel: true, usoPorAgente: 'negado', retencao: 'x' } });
    const arquivo = entrada('arquivo', 'a1', { titulo: 'Contrato Maria Silva.pdf' });
    const pacote = montarPacote(ORGANIZACAO_ID, CLIENTE_ID, quando, [a, b, c, negada, arquivo], { maximoDeEntradas: 2, maximoDeBytes: 300_000 });
    assert.equal(pacote.entradas.length, 2);
    const catalogo = pacote.catalogo ?? [];
    assert.equal(catalogo.length, 4);
    assert.equal(catalogo.filter((item) => item.incluida).length, 2);
    assert.equal(catalogo.filter((item) => !item.incluida).length, 2);
    assert.ok(catalogo.some((item) => item.urn === arquivo.urn));
    assert.ok(!catalogo.some((item) => item.urn === negada.urn));
  });

  it('o título do catálogo é curto e sem e-mail', () => {
    const longa = entrada('contexto_secao', 'c9', { titulo: `${'x'.repeat(120)} joao@exemplo.com` });
    const pacote = montarPacote(ORGANIZACAO_ID, CLIENTE_ID, quando, [longa], limites);
    assert.ok((pacote.catalogo ?? [])[0]!.titulo.length <= 80);
    assert.ok(!JSON.stringify(pacote.catalogo).includes('joao@exemplo.com'));
  });

  it('textoSeguro em título e resumo: e-mail e telefone saem do pacote', () => {
    const suja = entrada('contexto_secao', 'c1', { titulo: 'Contato joao@exemplo.com', descricao: 'Fale com maria@exemplo.com ou (11) 98888-7777.' });
    const pacote = montarPacote(ORGANIZACAO_ID, CLIENTE_ID, quando, [suja], limites);
    const texto = JSON.stringify(pacote);
    assert.ok(!texto.includes('joao@exemplo.com'));
    assert.ok(!texto.includes('maria@exemplo.com'));
    assert.ok(!texto.includes('98888'));
  });

  it('mapeia a evidência: nota, categoria, validade, jurisdição, verificação e obrigatoriedade', () => {
    const conhecimento = entrada('conhecimento', 'k1', {
      provedor: 'conhecimento',
      evidencia: {
        categoria: 'regra_legal',
        nota: 'A',
        fonte: 'Resolução X',
        mercado: 'br',
        jurisdicao: 'br',
        dataDaFonte: '2026-01-01',
        validoAte: '2027-01-01',
        verificadoEm: '2026-10-01',
        obrigatoria: true,
        replicada: true,
      },
    });
    const [lida] = montarPacote(ORGANIZACAO_ID, CLIENTE_ID, quando, [conhecimento], limites).entradas;
    assert.deepEqual(lida!.evidencia, { nota: 'A', categoria: 'regra_legal', jurisdicao: 'br', obrigatoria: true, validoAte: '2027-01-01', verificadoEm: '2026-10-01' });
  });

  it('prioridade determinística: regras e limites, contexto, desempenho, conhecimento, o resto', () => {
    assert.equal(prioridadeDaEntrada({ tipo: 'limite', provedor: 'regras', evidencia: undefined }), 0);
    assert.equal(prioridadeDaEntrada({ tipo: 'contexto_lista', provedor: 'contexto', evidencia: undefined }), 1);
    assert.equal(prioridadeDaEntrada({ tipo: 'tabela_de_dados', provedor: 'desempenho', evidencia: undefined }), 2);
    assert.equal(prioridadeDaEntrada({ tipo: 'conhecimento', provedor: 'conhecimento', evidencia: undefined }), 3);
    assert.equal(prioridadeDaEntrada({ tipo: 'conexao', provedor: 'conexoes', evidencia: undefined }), 4);
  });

  it('estourar o limite corta por prioridade e conta quantas ficaram de fora', () => {
    const todas = [
      entrada('conexao', 'x1'),
      entrada('conexao', 'x2'),
      entrada('regra', 'r1'),
      entrada('contexto_secao', 'c1'),
      entrada('tabela_de_dados', 'd1', { provedor: 'desempenho' }),
      entrada('conhecimento', 'k1', { provedor: 'conhecimento' }),
    ];
    const pacote = montarPacote(ORGANIZACAO_ID, CLIENTE_ID, quando, todas, { maximoDeEntradas: 3, maximoDeBytes: 300_000 });
    assert.deepEqual(pacote.entradas.map((e) => e.tipo), ['regra', 'contexto_secao', 'tabela_de_dados']);
    assert.equal(pacote.omitidasPorTamanho, 3);
    const invertido = montarPacote(ORGANIZACAO_ID, CLIENTE_ID, quando, [...todas].reverse(), { maximoDeEntradas: 3, maximoDeBytes: 300_000 });
    assert.deepEqual(invertido.entradas.map((e) => e.urn), pacote.entradas.map((e) => e.urn));
  });

  it('o limite de bytes também corta, e o pacote nunca passa dele', () => {
    const grandes = Array.from({ length: 20 }, (_, i) => entrada('regra', `r${String(i).padStart(2, '0')}`, { valorResumido: 'x'.repeat(590) }));
    const pacote = montarPacote(ORGANIZACAO_ID, CLIENTE_ID, quando, grandes, { maximoDeEntradas: 600, maximoDeBytes: 5_000 });
    assert.ok(new TextEncoder().encode(JSON.stringify(pacote.entradas)).length <= 5_000);
    assert.ok((pacote.omitidasPorTamanho ?? 0) > 0);
    assert.equal(pacote.entradas.length + (pacote.omitidasPorTamanho ?? 0), 20);
  });
});

describe('criarLeitorDoBrain', () => {
  const snapshot = (organizationId = ORGANIZACAO_ID, clienteId = CLIENTE_ID) => ({ organizationId, clienteId, entradas: [entrada('regra', 'r1')] });

  it('lê o catálogo em processo pela organização e devolve um pacote válido', async () => {
    let chamado: [string, string] | null = null;
    const leitor = criarLeitorDoBrain({
      brain: { async montarNaOrganizacao(org, cli) { chamado = [org, cli]; return ok(snapshot() as never); } },
      relogio: { agora: () => quando },
    });
    const resultado = await leitor.lerPacote(ORGANIZACAO_ID, CLIENTE_ID);
    assert.ok(resultado.ok);
    assert.deepEqual(chamado, [ORGANIZACAO_ID, CLIENTE_ID]);
    if (resultado.ok) {
      assert.equal(resultado.value.lidoEm, quando.toISOString());
      assert.equal(resultado.value.entradas.length, 1);
    }
  });

  it('entradasPorUrn devolve só as pedidas, sem negada, com restrita só em metadados e sem limite de entradas', async () => {
    const a = entrada('regra', 'r1');
    const b = entrada('contexto_secao', 'c1', { valorResumido: 'Conteúdo da seção.' });
    const negada = entrada('regra', 'rn', { sensibilidade: { nivel: 'restrito', piiPossivel: true, usoPorAgente: 'negado', retencao: 'x' } });
    const restrita = entrada('tabela_de_dados', 't1', {
      valorResumido: 'valor secreto',
      sensibilidade: { nivel: 'pessoal_possivel', piiPossivel: true, usoPorAgente: 'restrito', retencao: 'x' },
    });
    const leitor = criarLeitorDoBrain({
      brain: { async montarNaOrganizacao() { return ok({ organizationId: ORGANIZACAO_ID, clienteId: CLIENTE_ID, entradas: [a, b, negada, restrita] } as never); } },
      maximoDeEntradas: 1,
    });
    const r = await leitor.entradasPorUrn!(ORGANIZACAO_ID, CLIENTE_ID, [b.urn, negada.urn, restrita.urn, 'orla:x:y:regra:inexistente']);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.value.map((e) => e.urn).sort(), [b.urn, restrita.urn].sort());
    const devolvidaRestrita = r.value.find((e) => e.urn === restrita.urn)!;
    assert.equal(devolvidaRestrita.somenteMetadados, true);
    assert.equal(devolvidaRestrita.resumo, '');
    assert.ok(!JSON.stringify(r.value).includes('valor secreto'));
  });

  it('entradasPorUrn sem URN não consulta o Brain, e falha do Brain vira erro tipado', async () => {
    let chamadas = 0;
    const leitor = criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { chamadas += 1; return ok(snapshot() as never); } } });
    const vazio = await leitor.entradasPorUrn!(ORGANIZACAO_ID, CLIENTE_ID, []);
    assert.ok(vazio.ok && vazio.value.length === 0);
    assert.equal(chamadas, 0);
    const fora = criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { return err(failure('unavailable', 'x')); } } });
    const r = await fora.entradasPorUrn!(ORGANIZACAO_ID, CLIENTE_ID, ['orla:a:b:regra:c']);
    assert.equal(!r.ok && r.error.codigo, 'brain_indisponivel');
  });

  it('entradasPorUrn recusa o snapshot de outro cliente', async () => {
    const leitor = criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { return ok(snapshot(ORGANIZACAO_ID, '33333333-3333-4333-8333-333333333333') as never); } } });
    const r = await leitor.entradasPorUrn!(ORGANIZACAO_ID, CLIENTE_ID, ['orla:a:b:regra:c']);
    assert.equal(!r.ok && r.error.codigo, 'brain_indisponivel');
  });

  it('cliente inexistente e falha do Brain viram erros tipados, e exceção não escapa', async () => {
    const naoEncontrado = criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { return err(failure('not_found', 'x')); } } });
    const a = await naoEncontrado.lerPacote(ORGANIZACAO_ID, CLIENTE_ID);
    assert.equal(!a.ok && a.error.codigo, 'cliente_inexistente');
    const fora = criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { return err(failure('unavailable', 'x')); } } });
    const b = await fora.lerPacote(ORGANIZACAO_ID, CLIENTE_ID);
    assert.equal(!b.ok && b.error.codigo, 'brain_indisponivel');
    const quebrado = criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { throw new Error('segredo'); } } });
    const c = await quebrado.lerPacote(ORGANIZACAO_ID, CLIENTE_ID);
    assert.equal(!c.ok && c.error.codigo, 'brain_indisponivel');
    assert.ok(!c.ok && !c.error.mensagem.includes('segredo'));
  });

  it('recusa snapshot de outro cliente ou de outra organização', async () => {
    const leitor = criarLeitorDoBrain({
      brain: { async montarNaOrganizacao() { return ok(snapshot(ORGANIZACAO_ID, '33333333-3333-4333-8333-333333333333') as never); } },
    });
    const resultado = await leitor.lerPacote(ORGANIZACAO_ID, CLIENTE_ID);
    assert.equal(!resultado.ok && resultado.error.codigo, 'brain_indisponivel');
  });
});

describe('catalogoDoSnapshot', () => {
  it('aplica a mesma política de uso do pacote: negado fora, e o catálogo coincide com o de lerPacote', async () => {
    const permitida = entrada('regra', 'r1', { valorResumido: 'Teto.' });
    const negada = entrada('regra', 'r2', { sensibilidade: { nivel: 'restrito', piiPossivel: true, usoPorAgente: 'negado', retencao: 'x' } });
    const leitor = criarLeitorDoBrain({
      brain: { async montarNaOrganizacao() { return ok({ organizationId: ORGANIZACAO_ID, clienteId: CLIENTE_ID, entradas: [permitida, negada] } as never); } },
      relogio: { agora: () => quando },
    });
    const catalogo = leitor.catalogoDoSnapshot!(ORGANIZACAO_ID, CLIENTE_ID, { organizationId: ORGANIZACAO_ID, clienteId: CLIENTE_ID, entradas: [permitida, negada] });
    assert.ok(catalogo);
    assert.deepEqual([...catalogo.keys()], [permitida.urn]);
    const pacote = await leitor.lerPacote(ORGANIZACAO_ID, CLIENTE_ID);
    assert.ok(pacote.ok);
    if (pacote.ok) assert.deepEqual([...catalogo.keys()], pacote.value.entradas.map((e) => e.urn));
  });

  it('snapshot de outro cliente ou de outra organização não vira catálogo', () => {
    const leitor = criarLeitorDoBrain({ brain: { async montarNaOrganizacao() { return ok({} as never); } } });
    const outro = '33333333-3333-4333-8333-333333333333';
    assert.equal(leitor.catalogoDoSnapshot!(ORGANIZACAO_ID, CLIENTE_ID, { organizationId: ORGANIZACAO_ID, clienteId: outro, entradas: [] }), null);
    assert.equal(leitor.catalogoDoSnapshot!(ORGANIZACAO_ID, CLIENTE_ID, { organizationId: outro, clienteId: CLIENTE_ID, entradas: [] }), null);
  });
});
