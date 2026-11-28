import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLIENTE_ID, URN_DESEMPENHO, URN_LIMITE, URN_REGRA_LEGAL, planoCompleto } from '../domain/fixturesDeTeste.ts';
import type { Execucao, Versao, VersaoResumo } from '../application/portas.ts';
import type { PainelDoPlano } from '../application/estrategiaService.ts';
import type { MemberRole } from '../../identity/domain/user.ts';
import { AVISO_REGRA_LEGAL_NAO_VERIFICADA, caminhoLegivel, indicacoesDaEvidencia, mensagemDeFalha, visaoDoPlano, type AcaoDaVisao, type ChaveDeAcao, type EntradaDaVisao } from './visaoDoPlano.ts';

const AGORA = new Date('2026-11-25T13:00:00.000Z');
const PLANO_ID = '44444444-4444-4444-8444-444444444444';
const VERSAO_ID = '55555555-5555-4555-8555-555555555555';
const USUARIO_ID = '66666666-6666-4666-8666-666666666666';

function resumo(sobrescrita: Partial<VersaoResumo> = {}): VersaoResumo {
  return {
    id: VERSAO_ID,
    planoId: PLANO_ID,
    organizationId: 'org',
    clientId: CLIENTE_ID,
    status: 'rascunho',
    schemaVersion: 1,
    supersedesId: null,
    autorTipo: 'agente',
    autorUsuarioId: null,
    agentId: 'agente_de_plano',
    agentRunId: 'run-1',
    redigidaEm: null,
    criadaEm: AGORA,
    ...sobrescrita,
  };
}

function versao(sobrescrita: Partial<Versao> = {}): Versao {
  return { ...resumo(), conteudo: planoCompleto(), referencias: [], ...sobrescrita };
}

function execucao(sobrescrita: Partial<Execucao> = {}): Execucao {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    planoId: PLANO_ID,
    organizationId: 'org',
    clientId: CLIENTE_ID,
    tipo: 'criar',
    pedido: {},
    versaoBaseId: null,
    status: 'rodando',
    etapa: 'redigir',
    rodada: 0,
    tentativas: 0,
    falhas: 0,
    erroCodigo: null,
    agentRunId: 'run-1',
    solicitadoPor: USUARIO_ID,
    solicitadoTipo: 'usuario',
    leaseAte: null,
    criadaEm: AGORA,
    atualizadaEm: AGORA,
    ...sobrescrita,
  };
}


function painel(sobrescrita: Partial<PainelDoPlano> = {}): PainelDoPlano {
  const exibida = sobrescrita.versaoExibida === undefined ? versao() : sobrescrita.versaoExibida;
  return {
    plano: { id: PLANO_ID, organizationId: 'org', clientId: CLIENTE_ID, tipo: 'aquisicao', plataformas: ['meta'], whatsapp: '+5511912345678', landingPageId: '00000000-0000-4000-8000-0000000000aa', foco: null, criadoEm: AGORA },
    versaoExibida: exibida,
    status: exibida?.status ?? null,
    rotulo: null,
    pareceres: [],
    ajuste: null,
    gate: null,
    faltaParaAplicar: null,
    execucaoAtiva: null,
    ultimaExecucao: null,
    desatualizado: null,
    historico: { versoes: exibida ? [resumo({ status: exibida.status })] : [], eventos: [] },
    ...sobrescrita,
  };
}

function ver(papel: MemberRole, p: PainelDoPlano | null, extra: Partial<EntradaDaVisao> = {}) {
  return visaoDoPlano({ painel: p, papel, clienteId: CLIENTE_ID, agora: AGORA, ...extra });
}

function acao(visao: ReturnType<typeof ver>, chave: ChaveDeAcao): AcaoDaVisao | undefined {
  return visao.acoes.find((a) => a.chave === chave);
}


describe('visão do plano: sem versão', () => {
  it('plano sem versão e sem execução não tem ação de escrita e se rotula "Sem versão"', () => {
    const visao = ver('operator', painel({ versaoExibida: null }));
    assert.equal(visao.temPlano, false);
    assert.equal(visao.rotuloDoStatus, 'Sem versão');
    assert.deepEqual(visao.acoes, []);
    assert.equal(visao.resumo, null);
    assert.equal(visao.midia, null);
  });

  it('só com versões encerradas mostra o status da última, em português', () => {
    const antiga = resumo({ id: 'v1', status: 'rejeitado', criadaEm: new Date(AGORA.getTime() - 60_000) });
    const recente = resumo({ id: 'v2', status: 'cancelado', criadaEm: AGORA });
    const visao = ver('operator', painel({ versaoExibida: null, historico: { versoes: [antiga, recente], eventos: [] } }));
    assert.equal(visao.rotuloDoStatus, 'Cancelado');
    assert.equal(visao.temPlano, false);
  });

  it('com execução ativa vira "Em geração" e só oferece cancelar', () => {
    const visao = ver('operator', painel({ versaoExibida: null, execucaoAtiva: execucao() }));
    assert.equal(visao.rotuloDoStatus, 'Em geração');
    assert.deepEqual(visao.acoes.map((a) => a.chave), ['cancelar_execucao']);
  });

  it('última execução falhou vira "Falhou" com aviso explicativo', () => {
    const visao = ver('operator', painel({ versaoExibida: null, ultimaExecucao: execucao({ status: 'falhou', erroCodigo: 'ia_falha' }) }));
    assert.equal(visao.rotuloDoStatus, 'Falhou');
    assert.equal(visao.avisos[0]?.chave, 'execucao_falhou');
  });

  it('viewer não vê ação alguma (defesa em profundidade: a página já nega a aba)', () => {
    const visao = ver('viewer', painel({ versaoExibida: null, execucaoAtiva: execucao() }));
    assert.equal(visao.somenteLeitura, true);
    assert.deepEqual(visao.acoes, []);
  });
});

describe('visão do plano: linha do tempo da execução', () => {
  const ETAPAS = [
    ['ler_brain', 'Lendo o contexto do cliente'],
    ['redigir', 'Redigindo o plano'],
    ['comite', 'Revisando o plano'],
    ['ajustar', 'Ajustando o plano'],
    ['gates', 'Conferindo o plano'],
  ] as const;

  for (const [etapa, rotulo] of ETAPAS) {
    it(`mostra a etapa "${rotulo}" como atual`, () => {
      const visao = ver('operator', painel({ execucaoAtiva: execucao({ etapa }) }));
      assert.equal(visao.execucao?.etapaAtual, rotulo);
      const estados = visao.execucao?.etapas.map((e) => e.estado) ?? [];
      const indice = ETAPAS.findIndex(([chave]) => chave === etapa);
      assert.equal(estados[indice], 'atual');
      assert.ok(estados.slice(0, indice).every((e) => e === 'feita'));
      assert.ok(estados.slice(indice + 1).every((e) => e === 'pendente'));
    });
  }

  it('os textos da linha do tempo não expõem Comitê, Gates nem Brain', () => {
    const visao = ver('operator', painel({ execucaoAtiva: execucao() }));
    const texto = [visao.execucao?.titulo, visao.execucao?.etapaAtual, ...(visao.execucao?.etapas.map((e) => e.rotulo) ?? [])].join(' ');
    assert.doesNotMatch(texto, /Comitê|Gate|Brain|parecer/i);
  });

  it('bloqueia aplicar, pedir mudança e editar enquanto roda', () => {
    const visao = ver('operator', painel({ execucaoAtiva: execucao(), faltaParaAplicar: [] }));
    for (const chave of ['aplicar', 'pedir_mudanca', 'editar_secao'] as const) {
      const a = acao(visao, chave);
      assert.equal(a?.habilitada, false, chave);
      assert.ok(a?.motivos.some((m) => m.includes('execução em andamento')));
    }
    assert.equal(acao(visao, 'cancelar_execucao')?.habilitada, true);
  });

  it('marca todas as etapas como feitas no fim', () => {
    const visao = ver('operator', painel({ execucaoAtiva: execucao({ etapa: 'fim' }) }));
    assert.ok(visao.execucao?.etapas.every((e) => e.estado === 'feita'));
  });
});

describe('visão do plano: falha da execução', () => {
  const CASOS: readonly [string, string, string | null][] = [
    ['ia_nao_configurada', 'A inteligência artificial ainda não está configurada', '/config'],
    ['ia_limite', 'O limite de uso da inteligência artificial foi atingido', null],
    ['ia_saida_invalida', 'A resposta da inteligência artificial não pôde ser usada', null],
    ['ia_falha', 'O serviço de inteligência artificial falhou', null],
    ['ia_tempo', 'O pedido demorou mais do que o permitido', null],
    ['brain_indisponivel', 'Não foi possível ler o contexto do cliente agora', null],
    ['gate_reprovado', 'O plano não passou na conferência final', null],
    ['interno', 'Algo deu errado ao montar o plano', null],
  ];

  for (const [codigo, titulo, link] of CASOS) {
    it(`explica ${codigo} sem jargão`, () => {
      const visao = ver('operator', painel({ ultimaExecucao: execucao({ status: 'falhou', erroCodigo: codigo as Execucao['erroCodigo'] }) }));
      const aviso = visao.avisos.find((a) => a.chave === 'execucao_falhou');
      assert.equal(aviso?.titulo, titulo);
      assert.equal(aviso?.tom, 'danger');
      assert.equal(aviso?.link?.href ?? null, link);
      assert.ok(!/ia_|erro_|codigo|Comitê|Gate/i.test(`${aviso?.titulo} ${aviso?.texto}`));
    });
  }

  it('cai na mensagem genérica para código desconhecido ou ausente', () => {
    assert.equal(mensagemDeFalha('qualquer_coisa').titulo, 'Algo deu errado ao montar o plano');
    assert.equal(mensagemDeFalha(null).titulo, 'Algo deu errado ao montar o plano');
  });

  it('não mostra falha antiga se há execução ativa', () => {
    const visao = ver('operator', painel({ execucaoAtiva: execucao(), ultimaExecucao: execucao({ status: 'falhou', erroCodigo: 'ia_falha' }) }));
    assert.equal(visao.avisos.some((a) => a.chave === 'execucao_falhou'), false);
  });
});

describe('visão do plano: rascunho', () => {
  it('rascunho pronto habilita aplicar', () => {
    const visao = ver('operator', painel({ faltaParaAplicar: [] }));
    assert.equal(visao.rotuloDoStatus, 'Em rascunho');
    assert.equal(acao(visao, 'aplicar')?.habilitada, true);
    assert.equal(acao(visao, 'cancelar_rascunho')?.habilitada, true);
    assert.equal(acao(visao, 'pedir_mudanca')?.habilitada, true);
    assert.equal(acao(visao, 'autorizar'), undefined);
  });

  it('os motivos de falta para aplicar não citam Comitê nem Gates e não se repetem', () => {
    const visao = ver('operator', painel({ faltaParaAplicar: ['falta_parecer', 'falta_gate', 'gate_reprovado'] }));
    const aplicar = acao(visao, 'aplicar');
    assert.equal(aplicar?.habilitada, false);
    assert.deepEqual(aplicar?.motivos, [
      'O plano ainda está em revisão. Aguarde a conferência terminar.',
      'O plano não passou na conferência final. Peça uma mudança ao agente ou edite o plano.',
    ]);
    assert.doesNotMatch(JSON.stringify(aplicar?.motivos), /Comitê|Gate/);
  });

  it('viewer não vê ação', () => {
    assert.deepEqual(ver('viewer', painel({ faltaParaAplicar: [] })).acoes, []);
  });
});

describe('visão do plano: em autorização', () => {
  const emAutorizacao = () => painel({ versaoExibida: versao({ status: 'proposto' }) });

  it('operator vê autorizar e rejeitar desabilitados com motivo', () => {
    const visao = ver('operator', emAutorizacao());
    assert.equal(visao.rotuloDoStatus, 'Em autorização');
    for (const chave of ['autorizar', 'rejeitar'] as const) {
      assert.equal(acao(visao, chave)?.habilitada, false);
      assert.deepEqual(acao(visao, chave)?.motivos, ['Só quem administra pode autorizar ou rejeitar o plano.']);
    }
    assert.equal(acao(visao, 'aplicar'), undefined);
  });

  it('admin e owner podem autorizar e rejeitar', () => {
    for (const papel of ['admin', 'owner'] as const) {
      const visao = ver(papel, emAutorizacao());
      assert.equal(acao(visao, 'autorizar')?.habilitada, true);
      assert.equal(acao(visao, 'rejeitar')?.habilitada, true);
    }
  });

  it('viewer não vê ação', () => {
    assert.deepEqual(ver('viewer', emAutorizacao()).acoes, []);
  });
});

describe('visão do plano: autorizado e desatualizado', () => {
  const vigente = (extra: Partial<PainelDoPlano> = {}) => painel({ versaoExibida: versao({ status: 'vigente' }), ...extra });

  it('só admin revoga', () => {
    assert.equal(acao(ver('admin', vigente()), 'revogar')?.habilitada, true);
    assert.equal(acao(ver('operator', vigente()), 'revogar')?.habilitada, false);
    assert.equal(ver('admin', vigente()).rotuloDoStatus, 'Autorizado');
  });

  it('impacto material avisa com itens e oferece revisão', () => {
    const visao = ver(
      'operator',
      vigente({ desatualizado: { impacto: 'material', itens: [{ urn: URN_DESEMPENHO, motivo: 'hash_mudou', impacto: 'material', tipo: 'tabela_de_dados' }] } }),
    );
    const aviso = visao.avisos.find((a) => a.chave === 'desatualizado');
    assert.equal(aviso?.tom, 'warn');
    assert.deepEqual(aviso?.itens, ['Conteúdo da entrada mudou (tabela de dados)']);
    assert.equal(acao(visao, 'pedir_revisao')?.habilitada, true);
  });

  it('o item do aviso mostra o título da entrada quando ela é conhecida e o tipo legível quando não', () => {
    const visao = ver(
      'operator',
      vigente({
        desatualizado: {
          impacto: 'material',
          itens: [
            { urn: URN_DESEMPENHO, motivo: 'hash_mudou', impacto: 'material', tipo: 'contexto_secao' },
            { urn: URN_LIMITE, motivo: 'limite_ou_regra_novo', impacto: 'material', tipo: 'decisao' },
          ],
        },
      }),
      { entradasDoBrain: new Map([[URN_DESEMPENHO, { titulo: 'Contexto: Objetivos e metas', nota: null }]]) },
    );
    const aviso = visao.avisos.find((a) => a.chave === 'desatualizado');
    assert.deepEqual(aviso?.itens, ['Conteúdo da entrada mudou: Contexto: Objetivos e metas', 'Limite ou regra nova (decisão)']);
  });

  it('impacto informativo avisa mas não oferece revisão', () => {
    const visao = ver('operator', vigente({ desatualizado: { impacto: 'informativo', itens: [] } }));
    assert.ok(visao.avisos.some((a) => a.chave === 'brain_mudou_informativo'));
    assert.equal(acao(visao, 'pedir_revisao'), undefined);
  });

  it('sem impacto não avisa', () => {
    const visao = ver('operator', vigente({ desatualizado: { impacto: 'nenhum', itens: [] } }));
    assert.equal(visao.avisos.some((a) => a.chave.startsWith('desatualizado') || a.chave.startsWith('brain_mudou')), false);
  });

  it('desatualizado indisponível vira aviso informativo', () => {
    const visao = ver('operator', vigente({ desatualizado: 'indisponivel' }));
    assert.equal(visao.avisos.find((a) => a.chave === 'desatualizado_indisponivel')?.tom, 'info');
    assert.equal(acao(visao, 'pedir_revisao'), undefined);
  });

  it('viewer só lê, mesmo desatualizado', () => {
    assert.deepEqual(ver('viewer', vigente({ desatualizado: { impacto: 'material', itens: [] } })).acoes, []);
  });
});

describe('visão do plano: cabeçalho', () => {
  it('título vem do objetivo, com tipo e plataformas em português', () => {
    const visao = ver('operator', painel());
    assert.equal(visao.titulo, planoCompleto().intencao.objetivo);
    assert.equal(visao.tipoRotulo, 'Aquisição');
    assert.deepEqual(visao.plataformas, ['Meta']);
    assert.equal(visao.versao?.id, VERSAO_ID);
  });

  it('conteúdo fora do esquema vira aviso, sem resumo nem mídia, e não derruba a tela', () => {
    const visao = ver('operator', painel({ versaoExibida: versao({ conteudo: { antigo: true } }) }));
    assert.equal(visao.resumo, null);
    assert.equal(visao.midia, null);
    assert.ok(visao.avisos.some((a) => a.chave === 'plano_ilegivel'));
  });
});

describe('visão do plano: resumo executivo', () => {
  it('traz objetivo, aposta, resultado, verba e período, plataformas e destino, sem JSON cru', () => {
    const resumoDoPlano = ver('operator', painel()).resumo;
    assert.deepEqual(resumoDoPlano?.conteudo.map((b) => b.rotulo), ['Objetivo', 'Aposta central', 'Resultado esperado', 'Verba e período', 'Plataformas', 'Landing page', 'WhatsApp']);
    const texto = JSON.stringify(resumoDoPlano?.conteudo);
    assert.match(texto, /R\$ [\d.]+,\d{2}/);
    assert.match(texto, /\d{2}\/\d{2}\/\d{4}/);
    assert.doesNotMatch(texto, /"centavos"/);
    assert.ok(resumoDoPlano && !('json' in resumoDoPlano));
    assert.ok((resumoDoPlano?.grupos.length ?? 0) > 0);
    assert.doesNotMatch(JSON.stringify(resumoDoPlano?.grupos), /orla:|"urn"|"id"/);
  });

  it('evidência vira marca com nota quando o Brain é conhecido e aponta ao Brain', () => {
    const visao = ver('operator', painel(), { entradasDoBrain: new Map([[URN_DESEMPENHO, { titulo: 'Desempenho de anúncios', nota: 'B' as const }]]) });
    const marcas = JSON.stringify(visao.resumo);
    const url = planoCompleto().resumo_executivo.aposta_central.evidencias.map((e) => e.urn);
    if (url.includes(URN_DESEMPENHO)) {
      assert.ok(marcas.includes('Desempenho de anúncios'));
      assert.ok(marcas.includes(`/clientes/${CLIENTE_ID}/contexto`));
    }
    assert.ok(marcas.includes('"marcas"'));
  });
});

describe('visão do plano: plano de mídia', () => {
  it('lista as plataformas do plano com link de UTM, seções recolhíveis e campos com justificativa', () => {
    const midia = ver('operator', painel()).midia;
    assert.ok(midia && midia.conteudo.length > 0);
    const primeira = midia.conteudo[0]!;
    assert.equal(primeira.aberta, true);
    assert.match(primeira.link ?? '', /^https:\/\/exemplo\.com\.br\/oferta\?utm_source=/);
    assert.ok(primeira.secoes.length > 0);
    assert.equal(primeira.secoes[0]?.aberta, true);
    assert.ok(primeira.secoes.flatMap((s) => s.campos).every((c) => c.rotulo !== '' && c.valor !== ''));
    assert.ok(primeira.secoes.flatMap((s) => s.campos).some((c) => c.justificativa !== null));
  });

  it('inclui copy e testes A/B quando o plano os traz', () => {
    const midia = ver('operator', painel()).midia;
    const chaves = midia?.conteudo.flatMap((p) => p.secoes.map((s) => s.chave)) ?? [];
    const esperadas = planoCompleto().plano_de_midia.plataformas.flatMap((p) => p.secoes.map((s) => s.secao));
    assert.deepEqual(chaves, esperadas);
  });
});

describe('visão do plano: avisos de conferência e lacunas', () => {
  it('regra legal sem verificação gera aviso e a marca ganha a indicação; verificada não avisa', () => {
    const naoVerificada = { titulo: 'Lei', nota: 'D' as const, categoria: 'regra_legal' };
    const visao = ver('operator', painel(), { entradasDoBrain: new Map([[URN_REGRA_LEGAL, naoVerificada]]) });
    assert.ok(visao.avisos.some((a) => a.chave === 'regra_legal_nao_verificada' && a.titulo === AVISO_REGRA_LEGAL_NAO_VERIFICADA));
    const verificada = ver('operator', painel(), { entradasDoBrain: new Map([[URN_REGRA_LEGAL, { ...naoVerificada, verificadoEm: '2026-11-01' }]]) });
    assert.equal(verificada.avisos.some((a) => a.chave === 'regra_legal_nao_verificada'), false);
  });

  it('indicacoesDaEvidencia: vencida só quando validoAte é anterior a hoje', () => {
    const base = { titulo: 'x', nota: 'B' as const };
    assert.deepEqual(indicacoesDaEvidencia({ ...base, validoAte: '2026-11-24' }, '2026-11-25'), ['vencida']);
    assert.deepEqual(indicacoesDaEvidencia({ ...base, validoAte: '2026-11-25' }, '2026-11-25'), []);
    assert.deepEqual(indicacoesDaEvidencia({ ...base, categoria: 'regra_legal', validoAte: '2026-01-01' }, '2026-11-25'), ['não verificada', 'vencida']);
    assert.deepEqual(indicacoesDaEvidencia({ ...base, categoria: 'benchmark' }, '2026-11-25'), []);
    assert.deepEqual(indicacoesDaEvidencia(undefined, '2026-11-25'), []);
  });

  it('o plano que declara limite não aplicável avisa antes de autorizar', () => {
    const plano = planoCompleto();
    const conteudo = { ...plano, riscos_e_regras: { ...plano.riscos_e_regras, limites_nao_aplicaveis: [{ medida: 'custo_por_lead', motivo: 'Sem histórico de leads' }] } };
    const visao = ver('admin', painel({ versaoExibida: versao({ status: 'proposto', conteudo }) }));
    const aviso = visao.avisos.find((a) => a.chave === 'limite_nao_aplicavel');
    assert.deepEqual(aviso?.itens, ['Custo por lead: Sem histórico de leads']);
  });

  it('sem limite declarado não há aviso de limite', () => {
    assert.equal(ver('operator', painel()).avisos.some((a) => a.chave === 'limite_nao_aplicavel'), false);
  });

  it('lacunas do painel viram bloco com botão de aprovar e link para Regras; sem lacunas o bloco some', () => {
    const lacuna = { id: 'sem_teto', descricao: 'Falta o teto', valorSugerido: null, valorLegivel: null, origem: 'sem_sugestao' as const, evidencias: [], justificativa: null, editavel: false, podeAprovar: false, regraAGravar: null };
    const comLacuna = ver('operator', painel({ lacunas: [lacuna, { ...lacuna, id: 'outra', podeAprovar: true }] }));
    assert.equal(comLacuna.lacunas?.itens.length, 2);
    assert.equal(comLacuna.lacunas?.itens[0]?.origemRotulo, 'Sem sugestão do plano');
    assert.equal(comLacuna.lacunas?.itens[0]?.textoEditavel, null);
    assert.equal(comLacuna.lacunas?.podeAprovar, true);
    assert.equal(comLacuna.lacunas?.textoDoBotao, 'Aprovar sugestões do plano');
    assert.equal(comLacuna.lacunas?.regrasHref, `/clientes/${CLIENTE_ID}/regras?secao=registrar`);
    assert.equal(ver('operator', painel({ lacunas: [lacuna] })).lacunas?.podeAprovar, false);
    assert.equal(ver('operator', painel()).lacunas, null);
  });

  it('a falha de gate do painel passa para a visão sem mudança', () => {
    const falha = { possivel: true, motivoLegivel: 'O plano não passou na conferência: X.', falhas: [{ gate: 'X', itens: ['Y'] }] };
    assert.deepEqual(ver('operator', painel({ falhaDoGate: falha })).falhaDoGate, falha);
    assert.equal(ver('operator', painel()).falhaDoGate, null);
  });
});

describe('caminho legível de erro de validação', () => {
  it('troca seção por título e índice por posição', () => {
    assert.equal(caminhoLegivel('campanhas.campanhas.0.segmento_id'), 'Campanhas › campanhas › item 1 › segmento id');
    assert.equal(caminhoLegivel(''), 'Plano');
    assert.equal(caminhoLegivel('desconhecida.x'), 'desconhecida › x');
  });
});

describe('visão do plano: execução presa', () => {
  const MINUTOS = 60_000;
  const depois = (minutos: number) => new Date(AGORA.getTime() + minutos * MINUTOS);

  it('execução que atualizou há pouco não é parada', () => {
    const visao = visaoDoPlano({ painel: painel({ execucaoAtiva: execucao() }), papel: 'operator', clienteId: CLIENTE_ID, agora: depois(2) });
    assert.equal(visao.execucao?.parada, false);
    assert.equal(visao.avisos.some((a) => a.chave === 'execucao_parada'), false);
  });

  it('execução sem avanço há mais do limite vira aviso claro, com link para a página do plano, e continua cancelável', () => {
    const visao = visaoDoPlano({ painel: painel({ execucaoAtiva: execucao({ status: 'pendente' }) }), papel: 'operator', clienteId: CLIENTE_ID, agora: depois(11) });
    assert.equal(visao.execucao?.parada, true);
    const aviso = visao.avisos.find((a) => a.chave === 'execucao_parada');
    assert.equal(aviso?.titulo, 'A execução não está avançando');
    assert.equal(aviso?.link?.href, `/clientes/${CLIENTE_ID}/estrategia/${PLANO_ID}`);
    assert.equal(visao.acoes.find((a) => a.chave === 'cancelar_execucao')?.habilitada, true);
  });

  it('lease vencido além da tolerância conta como presa mesmo com atualização recente', () => {
    const rodando = execucao({ status: 'rodando', atualizadaEm: depois(5), leaseAte: depois(1) });
    const visao = visaoDoPlano({ painel: painel({ execucaoAtiva: rodando }), papel: 'operator', clienteId: CLIENTE_ID, agora: depois(6) });
    assert.equal(visao.execucao?.parada, true);
  });
});

describe('visão do plano: tentar de novo', () => {
  const falha = (erroCodigo: Execucao['erroCodigo'], tipo: Execucao['tipo'] = 'criar') => execucao({ status: 'falhou', erroCodigo, tipo });
  const temAcao = (papel: MemberRole, p: PainelDoPlano) => ver(papel, p).acoes.some((a) => a.chave === 'tentar_de_novo' && a.habilitada);

  it('oferece a ação a quem pode quando o erro é repetível, sem versão e com versão', () => {
    assert.equal(temAcao('operator', painel({ versaoExibida: null, ultimaExecucao: falha('ia_falha') })), true);
    assert.equal(temAcao('operator', painel({ ultimaExecucao: falha('ia_tempo', 'ajustar') })), true);
    const aviso = ver('operator', painel({ versaoExibida: null, ultimaExecucao: falha('ia_falha') })).avisos.find((a) => a.chave === 'execucao_falhou');
    assert.match(aviso?.texto ?? '', /Tentar de novo/);
  });

  it('não oferece para viewer, erro de configuração, gate reprovado, corrigir_gate, execução ativa ou última que não falhou', () => {
    assert.equal(temAcao('viewer', painel({ ultimaExecucao: falha('ia_falha') })), false);
    assert.equal(temAcao('operator', painel({ ultimaExecucao: falha('ia_nao_configurada') })), false);
    assert.equal(temAcao('operator', painel({ ultimaExecucao: falha('gate_reprovado') })), false);
    assert.equal(temAcao('operator', painel({ ultimaExecucao: falha('ia_falha', 'corrigir_gate') })), false);
    assert.equal(temAcao('operator', painel({ execucaoAtiva: execucao(), ultimaExecucao: falha('ia_falha') })), false);
    assert.equal(temAcao('operator', painel({ ultimaExecucao: execucao({ status: 'concluida' }) })), false);
  });

  it('sem botão o texto não manda tentar de novo', () => {
    const aviso = ver('viewer', painel({ ultimaExecucao: falha('ia_falha') })).avisos.find((a) => a.chave === 'execucao_falhou');
    assert.ok(!/Tentar de novo|Tente de novo/.test(aviso?.texto ?? ''));
  });

  it('criar: esconde o botão quando já existe versão da pessoa ou vigente', () => {
    const feita = painel({ versaoExibida: null, ultimaExecucao: falha('ia_falha') });
    assert.equal(temAcao('operator', feita), true);
    const daPessoa = painel({ versaoExibida: null, ultimaExecucao: falha('ia_falha'), historico: { versoes: [resumo({ autorTipo: 'usuario' })], eventos: [] } });
    assert.equal(temAcao('operator', daPessoa), false);
    const vigente = painel({ versaoExibida: null, ultimaExecucao: falha('ia_falha'), historico: { versoes: [resumo({ status: 'vigente' })], eventos: [] } });
    assert.equal(temAcao('operator', vigente), false);
  });
});

describe('visão do plano: foco e apagar', () => {
  it('mostra o foco do plano e nenhum foco para plano antigo', () => {
    const base = painel();
    assert.equal(ver('owner', base).foco, null);
    const comMarca = painel({ plano: { ...base.plano, foco: { tipo: 'marca' } } });
    assert.equal(ver('owner', comMarca).foco, 'Campanha de marca');
    const produtos = painel({
      plano: { ...base.plano, foco: { tipo: 'produtos', produtos: [{ urn: 'orla:o:c:contexto_produto:a', rotulo: 'Tênis', hash: 'a'.repeat(64) }, { urn: 'orla:o:c:contexto_produto:b', rotulo: 'Camiseta', hash: 'b'.repeat(64) }] } },
    });
    assert.equal(ver('admin', produtos).foco, 'Tênis, Camiseta');
  });

  it('só owner e admin têm Apagar plano; operator e viewer não', () => {
    for (const papel of ['owner', 'admin'] as const) assert.equal(acao(ver(papel, painel()), 'apagar_plano')?.habilitada, true, papel);
    for (const papel of ['operator', 'viewer'] as const) assert.equal(acao(ver(papel, painel()), 'apagar_plano'), undefined, papel);
  });

  it('com execução ativa o Apagar fica desabilitado, com o motivo de cancelar antes', () => {
    const visao = ver('owner', painel({ execucaoAtiva: execucao() }));
    assert.equal(acao(visao, 'apagar_plano')?.habilitada, false);
    assert.deepEqual(acao(visao, 'apagar_plano')?.motivos, ['Cancele a execução antes de apagar o plano.']);
  });

  it('plano sem versão (falhou) também pode ser apagado por owner', () => {
    const visao = ver('owner', painel({ versaoExibida: null, ultimaExecucao: null }));
    assert.equal(acao(visao, 'apagar_plano')?.habilitada, true);
  });
});
