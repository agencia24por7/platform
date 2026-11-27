import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { LandingPage } from '@/modules/clients/domain/destino/tipos';
import type { DestinoRepository, EscopoDeDestino } from '@/modules/clients/infrastructure/destinoRepository';
import type { MemberRole } from '@/modules/identity/domain/user';

const { createDestinoService } = await import('./destinoService.ts');

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA_ORG = '33333333-3333-4333-8333-333333333333';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const PAGINA = '44444444-4444-4444-8444-444444444444';
const ator = { userId: 'user-1', requestId: 'req-1', sourceIp: null };
const escopo = { organizationId: ORG, clientId: CLIENTE };

function montar() {
  const paginas: LandingPage[] = [];
  const whatsapps = new Map<string, string | null>([[`${ORG}/${CLIENTE}`, null]]);
  const eventos: AuditEvent[] = [];
  const chamadas: string[] = [];
  const chave = (e: EscopoDeDestino) => `${e.organizationId}/${e.clientId}`;
  const repository: DestinoRepository = {
    async inserirLandingPage(e, dados) {
      chamadas.push('inserir');
      if (!whatsapps.has(chave(e))) return { ok: false, motivo: 'cliente_inexistente' };
      if (paginas.some((p) => p.clientId === e.clientId && p.url === dados.url && !p.arquivadaEm)) return { ok: false, motivo: 'url_duplicada' };
      const pagina = { id: PAGINA, organizationId: e.organizationId, clientId: e.clientId, ...dados, criadaEm: new Date(0), arquivadaEm: null };
      paginas.push(pagina);
      return { ok: true, valor: pagina };
    },
    async listarLandingPages(e, incluir) {
      return paginas.filter((p) => chave(p) === chave(e) && (incluir || !p.arquivadaEm));
    },
    async arquivarLandingPage(e, id) {
      chamadas.push('arquivar');
      const i = paginas.findIndex((p) => p.id === id && chave(p) === chave(e) && !p.arquivadaEm);
      if (i < 0) return null;
      paginas[i] = { ...paginas[i]!, arquivadaEm: new Date(1) };
      return paginas[i]!;
    },
    async lerWhatsapp(e) {
      return whatsapps.has(chave(e)) ? { existe: true, whatsapp: whatsapps.get(chave(e)) ?? null } : { existe: false, whatsapp: null };
    },
    async gravarWhatsapp(e, valor) {
      chamadas.push('gravar');
      if (!whatsapps.has(chave(e))) return false;
      whatsapps.set(chave(e), valor);
      return true;
    },
  };
  const servico = createDestinoService(repository, { record: async (e) => void eventos.push(e), list: async () => [], search: async () => [] });
  return { servico, eventos, chamadas };
}

const comPapel = (papelDeQuemAge: MemberRole) => ({ ...escopo, papelDeQuemAge });

describe('destinoService: landing pages', () => {
  for (const papel of ['owner', 'admin', 'operator'] as const) {
    it(`${papel} cria, lista e arquiva, e cada escrita é auditada`, async () => {
      const { servico, eventos } = montar();
      const criada = await servico.criarLandingPage({ ...comPapel(papel), url: ' https://Loja.com.br/oferta#x ', rotulo: '  Oferta   verão ' }, ator);
      assert.equal(criada.ok, true);
      if (!criada.ok) return;
      assert.equal(criada.value.url, 'https://loja.com.br/oferta');
      assert.equal(criada.value.rotulo, 'Oferta verão');

      const lista = await servico.listarLandingPages(escopo);
      assert.equal(lista.ok && lista.value.length, 1);

      const arquivada = await servico.arquivarLandingPage({ ...comPapel(papel), landingPageId: PAGINA }, ator);
      assert.equal(arquivada.ok, true);
      const ativas = await servico.listarLandingPages(escopo);
      assert.equal(ativas.ok && ativas.value.length, 0);
      const todas = await servico.listarLandingPages(escopo, { incluirArquivadas: true });
      assert.equal(todas.ok && todas.value.length, 1);
      assert.deepEqual(eventos.map((e) => e.action), ['client.landing_page.create', 'client.landing_page.archive']);
      assert.equal(eventos[0]?.organizationId, ORG);
    });
  }

  it('viewer não escreve, não grava nem audita, mas lista', async () => {
    const { servico, eventos, chamadas } = montar();
    const criar = await servico.criarLandingPage({ ...comPapel('viewer'), url: 'https://loja.com.br/', rotulo: 'x' }, ator);
    const arquivar = await servico.arquivarLandingPage({ ...comPapel('viewer'), landingPageId: PAGINA }, ator);
    for (const r of [criar, arquivar]) assert.equal(!r.ok && r.error.code, 'forbidden');
    assert.deepEqual(chamadas, []);
    assert.deepEqual(eventos, []);
    assert.equal((await servico.listarLandingPages(escopo)).ok, true);
  });

  it('valida URL e rótulo no servidor antes de gravar', async () => {
    const { servico, chamadas } = montar();
    for (const url of ['http://loja.com.br', 'https://127.0.0.1/', ['https://u', 'p@loja.com.br/'].join(':'), 'lixo', 42]) {
      const r = await servico.criarLandingPage({ ...comPapel('owner'), url, rotulo: 'ok' }, ator);
      assert.equal(!r.ok && r.error.code, 'validation', String(url));
    }
    for (const rotulo of ['', '   ', 'a'.repeat(121), null]) {
      const r = await servico.criarLandingPage({ ...comPapel('owner'), url: 'https://loja.com.br/', rotulo }, ator);
      assert.equal(!r.ok && r.error.code, 'validation');
    }
    assert.deepEqual(chamadas, []);
  });

  it('URL ativa repetida vira conflito e não audita', async () => {
    const { servico, eventos } = montar();
    const entrada = { ...comPapel('owner'), url: 'https://loja.com.br/', rotulo: 'a' };
    assert.equal((await servico.criarLandingPage(entrada, ator)).ok, true);
    const repetida = await servico.criarLandingPage(entrada, ator);
    assert.equal(!repetida.ok && repetida.error.code, 'conflict');
    assert.equal(eventos.length, 1);
  });

  it('escopo de outra organização ou id inválido não acha nem grava', async () => {
    const { servico, eventos } = montar();
    const fora = await servico.criarLandingPage({ organizationId: OUTRA_ORG, clientId: CLIENTE, papelDeQuemAge: 'owner', url: 'https://loja.com.br/', rotulo: 'a' }, ator);
    assert.equal(!fora.ok && fora.error.code, 'not_found');
    const invalido = await servico.listarLandingPages({ organizationId: ORG, clientId: 'x' });
    assert.equal(!invalido.ok && invalido.error.code, 'validation');
    const pagina = await servico.arquivarLandingPage({ ...comPapel('owner'), landingPageId: 'x' }, ator);
    assert.equal(!pagina.ok && pagina.error.code, 'validation');
    const inexistente = await servico.arquivarLandingPage({ ...comPapel('owner'), landingPageId: PAGINA }, ator);
    assert.equal(!inexistente.ok && inexistente.error.code, 'not_found');
    assert.deepEqual(eventos, []);
  });
});

describe('destinoService: WhatsApp do cliente', () => {
  it('grava normalizado, lê de volta e audita sem o número', async () => {
    const { servico, eventos } = montar();
    assert.deepEqual(await servico.lerWhatsapp(escopo), { ok: true, value: null });
    const gravado = await servico.gravarWhatsapp({ ...comPapel('operator'), whatsapp: '(11) 99999-8888' }, ator);
    assert.deepEqual(gravado, { ok: true, value: '+5511999998888' });
    assert.deepEqual(await servico.lerWhatsapp(escopo), { ok: true, value: '+5511999998888' });
    assert.equal(eventos[0]?.action, 'client.whatsapp.set');
    assert.equal(JSON.stringify(eventos).includes('999998888'), false);
  });

  it('viewer lê mas não grava; número inválido e cliente de outra organização são recusados', async () => {
    const { servico, eventos } = montar();
    assert.equal((await servico.lerWhatsapp(escopo)).ok, true);
    const viewer = await servico.gravarWhatsapp({ ...comPapel('viewer'), whatsapp: '11999998888' }, ator);
    assert.equal(!viewer.ok && viewer.error.code, 'forbidden');
    const lixo = await servico.gravarWhatsapp({ ...comPapel('owner'), whatsapp: 'abc' }, ator);
    assert.equal(!lixo.ok && lixo.error.code, 'validation');
    const fora = await servico.gravarWhatsapp({ organizationId: OUTRA_ORG, clientId: CLIENTE, papelDeQuemAge: 'owner', whatsapp: '11999998888' }, ator);
    assert.equal(!fora.ok && fora.error.code, 'not_found');
    const leituraFora = await servico.lerWhatsapp({ organizationId: OUTRA_ORG, clientId: CLIENTE });
    assert.equal(!leituraFora.ok && leituraFora.error.code, 'not_found');
    assert.deepEqual(eventos, []);
  });
});
