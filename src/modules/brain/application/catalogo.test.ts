import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../testes/ganchos.ts');
const fx = await import('../testes/fixtures.ts');
const { construirCatalogo } = await import('./construirCatalogo.ts');
const { artefatosDoCatalogo } = await import('./publicacao.ts');
const { PROVEDORES } = await import('../infrastructure/provedores/index.ts');
const { provedorDeExemplo } = await import('../infrastructure/provedores/exemplo.ts');
const { DEFINICOES_DE_CAPACIDADES } = await import('../dados/capacidades.ts');
const { CONECTORES_POSSIVEIS, plataformasDaTabela } = await import('../dados/registro.ts');
const { criarUrn } = await import('../domain/urn.ts');
const { procurarPii } = await import('../domain/privacidade.ts');
type Provedor = (typeof PROVEDORES)[number];
type Inventario = ReturnType<typeof fx.inventario>;

const dependencias = (provedores: readonly Provedor[] = PROVEDORES) => ({
  provedores,
  capacidades: DEFINICOES_DE_CAPACIDADES,
  conectores: CONECTORES_POSSIVEIS,
  plataformasDaTabela,
});

const montar = (opcoes: { provedores?: readonly Provedor[]; inventario?: Inventario; comContexto?: boolean; comRegras?: boolean; agora?: Date } = {}) =>
  construirCatalogo(dependencias(opcoes.provedores), {
    organizationId: fx.ORG,
    clienteId: fx.CLIENTE,
    agora: opcoes.agora ?? fx.AGORA,
    conjuntoDeDados: 'tria_dw',
    bytesMaximosPorConsulta: 10_000_000_000,
    inventario: opcoes.inventario ?? fx.inventario(),
    contexto: opcoes.comContexto === false ? null : fx.contexto(),
    regras: opcoes.comRegras === false ? null : fx.regras(),
  });

const urn = (tipo: string, id: string) => criarUrn(fx.ORG, fx.CLIENTE, tipo, id);

describe('construção do catálogo', () => {
  it('indexa conexões, fontes, tabelas, contexto, arquivos e capacidades do cliente', async () => {
    const s = await montar();
    const tipos = new Set(s.entradas.map((e) => e.tipo));
    for (const tipo of ['conexao', 'fonte', 'tabela_de_dados', 'contexto_secao', 'contexto_lista', 'arquivo', 'capacidade', 'limite', 'regra', 'decisao']) assert.ok(tipos.has(tipo), tipo);
    const ids = new Set(s.entradas.map((e) => e.urn));
    assert.ok(ids.has(urn('fonte', fx.FONTE_META)));
    assert.ok(!ids.has(urn('fonte', fx.FONTE_DESVINCULADA)), 'fonte desvinculada não entra');
    assert.ok(!ids.has(urn('conexao', fx.CONEXAO_SC)), 'conexão sem recurso do cliente não entra');
    assert.ok(ids.has(urn('tabela_de_dados', 'fato_ads_diario')));
    assert.ok(ids.has(urn('tabela_de_dados', 'fato_ga4_diario')));
    assert.ok(!ids.has(urn('tabela_de_dados', 'fato_search_console_diario')), 'só tabelas de plataformas vinculadas');
    assert.ok(s.provedores.every((p) => p.status === 'ok'));
  });

  it('a tabela compartilhada entre plataformas vira uma entrada só, com as duas plataformas', async () => {
    const s = await montar();
    const ads = s.entradas.find((e) => e.id === 'fato_ads_diario')!;
    assert.equal(ads.plataforma, null);
    assert.ok(ads.tags.includes('plataforma:google') && ads.tags.includes('plataforma:meta'));
    assert.equal(ads.cobertura?.fonteDaMedida, 'gov_cobertura_cliente');
    assert.equal(ads.acesso.tipo, 'bigquery');
    if (ads.acesso.tipo !== 'bigquery') return;
    assert.equal(ads.acesso.objeto, 'vw_ads_diario');
    assert.deepEqual(ads.acesso.filtros, { cliente_atual_id: fx.CLIENTE });
    const sql = ads.acesso.exemplosDeConsulta[0]!.sql;
    assert.match(sql, /cliente_atual_id = @cliente_id/);
    assert.match(sql, /data_dia BETWEEN @desde AND @ate/);
    assert.match(sql, /LIMIT \d+/);
    assert.match(sql, /SUM\(investimento\)/);
    assert.doesNotMatch(sql, /SUM\(alcance\)|SUM\(ctr\)/);
  });

  it('cobertura do GA4 cai para as coletas quando a medida passou de 36 horas', async () => {
    const s = await montar();
    const ga4 = s.entradas.find((e) => e.id === 'fato_ga4_diario')!;
    assert.equal(ga4.cobertura?.fonteDaMedida, 'coletas');
    assert.equal(ga4.cobertura?.ate, '2026-10-01');
    assert.equal(ga4.frescor?.status, 'parado');
  });

  it('é determinístico e não depende da ordem do inventário', async () => {
    const a = await montar();
    const b = await montar();
    assert.equal(a.catalogHash, b.catalogHash);
    const base = fx.inventario();
    const embaralhado = { ...base, fontes: [...base.fontes].reverse(), coletas: [...base.coletas].reverse(), conexoesDaOrganizacao: [...base.conexoesDaOrganizacao].reverse() };
    assert.equal((await montar({ inventario: embaralhado })).catalogHash, a.catalogHash);
    const md1 = artefatosDoCatalogo(a).find((x) => x.nome === 'catalogo.md')!.conteudo;
    const md2 = artefatosDoCatalogo(b).find((x) => x.nome === 'catalogo.md')!.conteudo;
    assert.equal(md1, md2);
  });

  it('só metadado: nenhum valor livre, e-mail ou telefone do contexto sai no catálogo publicado', async () => {
    const s = await montar();
    const tudo = [JSON.stringify(s), ...artefatosDoCatalogo(s).map((a) => a.conteudo)].join('\n');
    assert.ok(!tudo.includes(fx.EMAIL_SENSIVEL));
    assert.ok(!tudo.includes('98765-4321'));
    assert.ok(!tudo.includes('texto livre da equipe'));
    assert.ok(!tudo.includes('Ana Compradora'));
    assert.deepEqual(procurarPii(tudo).filter((a) => a.padrao !== 'telefone' || !a.trecho.startsWith('orla')), []);
    assert.ok(!/credential_ref|account_email|webhook_token/.test(tudo));
  });

  it('resume só valores de opção confirmados', async () => {
    const s = await montar();
    const empresa = s.entradas.find((e) => e.urn === urn('contexto_secao', 'empresa'))!;
    assert.equal(empresa.valorResumido, 'Segmento: Varejo; Canais de venda: Site, outro (texto livre omitido); Ticket médio: R$ 159.90');
    const marca = s.entradas.find((e) => e.urn === urn('contexto_secao', 'marca'))!;
    assert.equal(marca.valorResumido, null, 'sugestão da IA não confirmada não é resumida');
    assert.equal(marca.epistemico?.sugestoesPendentes, 1);
  });

  it('lista com aviso de dado pessoal sai só com metadados', async () => {
    const s = await montar();
    const depoimentos = s.entradas.find((e) => e.urn === urn('contexto_lista', 'depoimentos'))!;
    assert.equal(depoimentos.acesso.tipo, 'restrito');
    assert.equal(depoimentos.valorResumido, null);
    assert.equal(s.restritasPelaPolitica >= 1, true);
  });

  it('sem contexto ligado, o provedor de contexto aparece indisponível e o resto segue', async () => {
    const s = await montar({ comContexto: false });
    assert.equal(s.provedores.find((p) => p.id === 'contexto')?.status, 'indisponivel');
    assert.ok(s.entradas.some((e) => e.tipo === 'tabela_de_dados'));
    assert.equal(s.diagnostico.contexto, null);
    const marca = s.capacidades.find((c) => c.id === 'contexto_de_marca')!;
    assert.equal(marca.status, 'indisponivel');
    assert.match(marca.faltando.join(' '), /contexto do cliente indisponível/);
  });
});

describe('isolamento e robustez', () => {
  const malicioso: Provedor = {
    id: 'malicioso',
    versao: 1,
    descricao: 'Provedor de teste que tenta vazar outro cliente.',
    fase: 'primaria',
    tiposDeclarados: ['fonte'],
    descobrir: () => [
      {
        urn: criarUrn(fx.ORG, fx.OUTRO_CLIENTE, 'fonte', 'x'), tipo: 'fonte', id: 'x', titulo: 'Fonte de outro', descricao: 'Fonte que pertence a outro cliente.',
        provedor: 'malicioso', plataforma: null, referencia: { sistema: 'x', local: 'x' }, esquema: null, grao: null, cobertura: null, frescor: null,
        qualidade: { completude: null, avisos: [] }, acesso: { tipo: 'status' },
        sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido', retencao: 'x' }, epistemico: null, valorResumido: null,
        tags: [], relacoes: [], versao: 1,
      },
      {
        urn: criarUrn(fx.ORG, fx.CLIENTE, 'fonte', 'y'), tipo: 'fonte', id: 'y', titulo: 'Fonte com e-mail', descricao: 'Contato: fulano@exemplo.com no texto.',
        provedor: 'malicioso', plataforma: null, referencia: { sistema: 'x', local: 'x' }, esquema: null, grao: null, cobertura: null, frescor: null,
        qualidade: { completude: null, avisos: [] }, acesso: { tipo: 'status' },
        sensibilidade: { nivel: 'negocio', piiPossivel: false, usoPorAgente: 'permitido', retencao: 'x' }, epistemico: null, valorResumido: null,
        tags: [], relacoes: [], versao: 1,
      },
    ],
    saude: () => ({ status: 'ok', motivo: null }),
  };
  const quebrado: Provedor = { ...malicioso, id: 'quebrado', descobrir: () => { throw new Error('fora do ar'); } };

  it('descarta entrada de outro cliente ou com dado pessoal e marca o provedor degradado', async () => {
    const s = await montar({ provedores: [...PROVEDORES, malicioso] });
    assert.ok(!JSON.stringify(s).includes(fx.OUTRO_CLIENTE));
    assert.ok(!JSON.stringify(s).includes('fulano@exemplo.com'));
    const estado = s.provedores.find((p) => p.id === 'malicioso')!;
    assert.equal(estado.status, 'degradado');
    assert.equal(estado.descartadas, 2);
  });

  it('provedor que lança erro fica indisponível sem derrubar o catálogo', async () => {
    const s = await montar({ provedores: [...PROVEDORES, quebrado] });
    assert.equal(s.provedores.find((p) => p.id === 'quebrado')?.status, 'indisponivel');
    assert.ok(s.entradas.length > 10);
  });

  it('uma fonte nova entra com um arquivo e uma linha no registro', async () => {
    const s = await montar({ provedores: [...PROVEDORES, provedorDeExemplo] });
    const exemplo = s.entradas.find((e) => e.tipo === 'planilha_externa');
    assert.ok(exemplo);
    assert.equal(exemplo.urn, urn('planilha_externa', 'metas-2026'));
  });

  it('cliente grande (centenas de fontes) monta em uma passada rápida', async () => {
    const base = fx.inventario();
    const fontes = Array.from({ length: 300 }, (_, i) => ({
      ...base.fontes[0]!,
      id: `eeeeeeee-0000-4000-8000-${String(i).padStart(12, '0')}`,
      externalId: `act_${i}`,
      nome: `Conta ${i}`,
    }));
    const coletas = fontes.map((f) => ({ ...base.coletas[0]!, fonteId: f.id }));
    const inicio = performance.now();
    const s = await montar({ inventario: { ...base, fontes: [...base.fontes, ...fontes], coletas: [...base.coletas, ...coletas] } });
    const duracao = performance.now() - inicio;
    assert.ok(s.entradas.length > 300);
    assert.ok(duracao < 5000, `levou ${Math.round(duracao)} ms`);
  });
});

describe('governança: capacidades e diagnóstico', () => {
  it('avalia capacidades com evidências e o que falta', async () => {
    const s = await montar();
    const por = new Map(s.capacidades.map((c) => [c.id, c]));
    assert.equal(por.get('performance_de_anuncios')?.status, 'disponivel');
    assert.deepEqual(por.get('performance_de_anuncios')?.evidencias, [urn('tabela_de_dados', 'fato_ads_diario')]);
    assert.equal(por.get('trafego_do_site')?.status, 'parcial');
    assert.equal(por.get('busca_organica')?.status, 'indisponivel');
    assert.ok(por.get('busca_organica')?.plataformasQueDesbloqueiam.includes('searchconsole'));
    assert.equal(por.get('contexto_de_marca')?.status, 'parcial');
    assert.equal(por.get('leads_e_origem')?.status, 'indisponivel');
  });

  it('diagnostica conectores: conectado, reautorizar, conexão sem vínculo e não conectado', async () => {
    const s = await montar();
    const estado = new Map(s.diagnostico.conectores.map((c) => [c.plataforma, c.estado]));
    assert.equal(estado.get('meta'), 'conectado');
    assert.equal(estado.get('ga4'), 'precisa_reautorizar');
    assert.equal(estado.get('searchconsole'), 'conexao_sem_vinculo');
    assert.equal(estado.get('rdstation'), 'nao_conectado');
    assert.equal(estado.get('apify'), 'fora_da_coleta');
  });

  it('frescor, lacunas e falhas por fonte', async () => {
    const s = await montar();
    const por = new Map(s.diagnostico.fontes.map((f) => [f.urn, f]));
    const meta = por.get(urn('fonte', fx.FONTE_META))!;
    assert.equal(meta.frescor, 'fresco');
    assert.deepEqual(meta.lacunas, [{ de: '2026-10-01', ate: '2026-10-05', dias: 5 }]);
    const google = por.get(urn('fonte', fx.FONTE_GOOGLE))!;
    assert.equal(google.frescor, 'atrasado');
    assert.deepEqual(google.falhasRecentes, { limite_de_uso: 4 });
    assert.equal(por.get(urn('fonte', fx.FONTE_GA4))!.frescor, 'parado');
    const avisos = s.diagnostico.qualidade.map((a) => `${a.tipo}`);
    assert.ok(avisos.includes('limiar_de_privacidade'));
    assert.ok(avisos.includes('limite_de_uso'));
    assert.ok(avisos.includes('parcial'));
  });

  it('contexto: completude por seção, sugestões pendentes e marcação divergente', async () => {
    const s = await montar();
    const contexto = s.diagnostico.contexto!;
    assert.equal(contexto.sugestoesPendentes, 1);
    assert.deepEqual(contexto.contradicoes.map((c) => `${c.secao}:${c.chave}`), ['publico:personas']);
    assert.ok(!JSON.stringify(contexto).includes('Ana'));
    const empresa = contexto.secoes.find((x) => x.secao === 'empresa')!;
    assert.equal(empresa.essenciaisFaltando, 1);
  });

  it('ações ordenadas por impacto, reautorizar primeiro', async () => {
    const s = await montar();
    const ids = s.diagnostico.acoes.map((a) => a.id);
    assert.equal(ids[0], 'reautorizar:ga4');
    assert.ok(ids.indexOf(`investigar:${urn('fonte', fx.FONTE_GA4)}`) < ids.indexOf('conectar:rdstation'));
    assert.ok(ids.includes('vincular:searchconsole'));
    assert.ok(ids.includes('preencher:empresa'));
    assert.ok(ids.includes('confirmar:marca'));
    assert.ok(ids.includes('contradicao:publico:personas'));
    const impactos = s.diagnostico.acoes.map((a) => a.impacto);
    assert.deepEqual(impactos, [...impactos].sort((a, b) => b - a));
  });
});

describe('artefatos publicados', () => {
  it('manifesto com hash por entrada, contagens e provedores; markdown no estilo llms.txt', async () => {
    const s = await montar();
    const artefatos = artefatosDoCatalogo(s);
    const nomes = artefatos.map((a) => a.nome);
    for (const nome of ['catalogo.json', 'catalogo.md', 'capacidades.json', 'diagnostico.json', 'regras.md', 'decisoes.jsonl', 'manifest.json']) assert.ok(nomes.includes(nome), nome);
    assert.equal(nomes.filter((n) => n.startsWith('entradas/')).length, s.entradas.length);
    assert.equal(nomes[nomes.length - 1], 'manifest.json');
    const manifesto = JSON.parse(artefatos.find((a) => a.nome === 'manifest.json')!.conteudo);
    assert.equal(manifesto.catalogHash, s.catalogHash);
    assert.equal(manifesto.counts.entradas, s.entradas.length);
    assert.equal(manifesto.status, 'completo');
    assert.equal(manifesto.referencias.exportDoContexto, `orgs/${fx.ORG}/clientes/${fx.CLIENTE}/contexto/brain/`);
    const md = artefatos.find((a) => a.nome === 'catalogo.md')!.conteudo;
    assert.match(md, /^# Catálogo do cliente: Loja Exemplo/);
    assert.match(md, /## Tabelas de dados \(BigQuery\)/);
    assert.match(md, new RegExp(`\\(${urn('tabela_de_dados', 'fato_ads_diario')}\\)`));
    assert.match(md, /## Lacunas e próximos passos/);
  });
});
