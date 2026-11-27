import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLIENTE_ID, URN_DESEMPENHO, URN_LIMITE, URN_REGRA_LEGAL, planoCompleto } from '../domain/fixturesDeTeste.ts';
import type { Execucao, EventoDaVersao, Versao, VersaoResumo } from '../application/portas.ts';
import type { PainelDoPlano } from '../application/estrategiaService.ts';
import type { MemberRole } from '../../identity/domain/user.ts';
import { SECOES_DO_PLANO } from '../domain/plano.ts';
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

function evento(tipo: EventoDaVersao['tipo'], payload: Record<string, unknown>, minutos = 0): EventoDaVersao {
  return {
    id: `evento-${tipo}-${minutos}`,
    versaoId: VERSAO_ID,
    tipo,
    atorTipo: 'agente',
    atorUsuarioId: null,
    agentId: 'agente_de_plano',
    agentRunId: 'run-1',
    payload,
    criadoEm: new Date(AGORA.getTime() + minutos * 60_000),
  };
}

function painel(sobrescrita: Partial<PainelDoPlano> = {}): PainelDoPlano {
  const exibida = sobrescrita.versaoExibida === undefined ? versao() : sobrescrita.versaoExibida;
  return {
    plano: { id: PLANO_ID, organizationId: 'org', clientId: CLIENTE_ID, tipo: 'aquisicao', plataformas: ['meta'], whatsapp: '+5511912345678', landingPageId: '00000000-0000-4000-8000-0000000000aa', criadoEm: AGORA },
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

describe('visão do plano: sem plano', () => {
  it('operator pode pedir plano novo', () => {
    const visao = ver('operator', null);
    assert.equal(visao.temPlano, false);
    assert.deepEqual(visao.acoes.map((a) => [a.chave, a.habilitada]), [['novo_plano', true]]);
  });

  it('viewer não vê ação alguma (defesa em profundidade: a página já nega a aba)', () => {
    const visao = ver('viewer', null);
    assert.equal(visao.somenteLeitura, true);
    assert.deepEqual(visao.acoes, []);
  });

  it('plano criado sem versão ainda aceita novo pedido, a menos que haja execução ativa', () => {
    const semVersao = ver('operator', painel({ versaoExibida: null }));
    assert.equal(semVersao.temPlano, false);
    assert.equal(acao(semVersao, 'novo_plano')?.habilitada, true);
    const rodando = ver('operator', painel({ versaoExibida: null, execucaoAtiva: execucao() }));
    assert.equal(acao(rodando, 'novo_plano')?.habilitada, false);
    assert.equal(acao(rodando, 'cancelar_execucao')?.habilitada, true);
    assert.equal(rodando.execucao?.etapaAtual, 'Redigindo');
  });
});

describe('visão do plano: execução em andamento', () => {
  const ETAPAS = [
    ['ler_brain', 'Lendo o Brain'],
    ['redigir', 'Redigindo'],
    ['comite', 'Comitê'],
    ['ajustar', 'Ajustando'],
    ['gates', 'Gates'],
  ] as const;

  for (const [etapa, rotulo] of ETAPAS) {
    it(`mostra a etapa ${rotulo} como atual`, () => {
      const visao = ver('operator', painel({ execucaoAtiva: execucao({ etapa }) }));
      assert.equal(visao.execucao?.etapaAtual, rotulo);
      const estados = visao.execucao?.etapas.map((e) => e.estado) ?? [];
      const indice = ETAPAS.findIndex(([chave]) => chave === etapa);
      assert.equal(estados[indice], 'atual');
      assert.ok(estados.slice(0, indice).every((e) => e === 'feita'));
      assert.ok(estados.slice(indice + 1).every((e) => e === 'pendente'));
      const aviso = visao.avisos.find((a) => a.chave === 'em_andamento');
      assert.ok(aviso?.titulo.includes(rotulo));
    });
  }

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
    ['brain_indisponivel', 'Não foi possível ler o Brain do cliente agora', null],
    ['gate_reprovado', 'Os Gates reprovaram o plano', `/clientes/${CLIENTE_ID}/estrategia?secao=gates`],
    ['interno', 'Algo deu errado ao montar o plano', null],
  ];

  for (const [codigo, titulo, link] of CASOS) {
    it(`explica ${codigo} sem jargão`, () => {
      const visao = ver('operator', painel({ ultimaExecucao: execucao({ status: 'falhou', erroCodigo: codigo as Execucao['erroCodigo'] }) }));
      const aviso = visao.avisos.find((a) => a.chave === 'execucao_falhou');
      assert.equal(aviso?.titulo, titulo);
      assert.equal(aviso?.tom, 'danger');
      assert.equal(aviso?.link?.href ?? null, link);
      assert.ok(!/ia_|erro_|codigo/i.test(`${aviso?.titulo} ${aviso?.texto}`));
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

  it('lista os motivos de cada falta para aplicar', () => {
    const visao = ver('operator', painel({ faltaParaAplicar: ['falta_parecer', 'gate_reprovado'] }));
    const aplicar = acao(visao, 'aplicar');
    assert.equal(aplicar?.habilitada, false);
    assert.deepEqual(aplicar?.motivos, [
      'Falta parecer do Comitê (próprio ou de uma versão que o ajuste responde).',
      'O Gate mais recente reprovou.',
    ]);
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

describe('visão do plano: só versões encerradas', () => {
  const encerrada = (id: string, status: VersaoResumo['status'], minutos: number): VersaoResumo =>
    resumo({ id, status, criadaEm: new Date(AGORA.getTime() - minutos * 60_000) });

  it('sem versão aberta nem vigente, o histórico ainda lista as versões e avisa onde ver', () => {
    const versoes = [encerrada('v1', 'rejeitado', 30), encerrada('v2', 'revogado', 20), encerrada('v3', 'cancelado', 10)];
    const visao = ver('operator', painel({ versaoExibida: null, historico: { versoes, eventos: [] } }));
    assert.equal(visao.temPlano, false);
    assert.deepEqual(visao.versoes.map((v) => v.rotuloDoStatus), ['Cancelado', 'Revogado', 'Rejeitado']);
    const aviso = visao.avisos.find((a) => a.chave === 'sem_versao_ativa');
    assert.match(aviso?.texto ?? '', /Status da última versão: cancelado/);
    assert.match(aviso?.link?.href ?? '', /secao=historico/);
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

  it('o item do aviso mostra o título da entrada do Brain quando ela é conhecida e o tipo legível quando não', () => {
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

describe('visão do plano: seções e lacunas', () => {
  it('monta as 16 seções do esquema com JSON editável', () => {
    const visao = ver('operator', painel());
    assert.deepEqual(visao.secoes.map((s) => s.chave), [...SECOES_DO_PLANO]);
    for (const secao of visao.secoes) assert.doesNotThrow(() => JSON.parse(secao.json));
  });

  it('mostra dinheiro em reais e datas em pt-BR, sem JSON cru', () => {
    const visao = ver('operator', painel());
    const texto = JSON.stringify(visao.secoes.map((s) => s.blocos));
    assert.match(texto, /R\$ [\d.]+,\d{2}/);
    assert.match(texto, /\d{2}\/\d{2}\/\d{4}/);
    assert.doesNotMatch(texto, /"centavos"/);
  });

  it('evidência vira marca com nota quando o Brain é conhecido e aponta ao Brain', () => {
    const visao = ver('operator', painel(), { entradasDoBrain: new Map([[URN_DESEMPENHO, { titulo: 'Desempenho de anúncios', nota: 'B' as const }]]) });
    const marcas = JSON.stringify(visao.secoes);
    assert.ok(marcas.includes('Desempenho de anúncios'));
    assert.ok(marcas.includes(`/clientes/${CLIENTE_ID}/contexto?secao=brain`));
    assert.ok(marcas.includes(URN_DESEMPENHO));
  });

  it('regra legal sem verificação e evidência vencida ganham indicação na marca e o aviso em Riscos e regras', () => {
    const naoVerificada = { titulo: 'Lei', nota: 'D' as const, categoria: 'regra_legal' };
    const visao = ver('operator', painel(), { entradasDoBrain: new Map([[URN_REGRA_LEGAL, naoVerificada]]) });
    const riscos = JSON.stringify(visao.secoes.find((s) => s.chave === 'riscos_e_regras')!.blocos);
    assert.ok(riscos.includes('"indicacoes":["não verificada"]'));
    assert.ok(riscos.includes(AVISO_REGRA_LEGAL_NAO_VERIFICADA));
    assert.ok(riscos.includes(`${URN_REGRA_LEGAL} · não verificada`));

    const verificada = ver('operator', painel(), { entradasDoBrain: new Map([[URN_REGRA_LEGAL, { ...naoVerificada, verificadoEm: '2026-11-01' }]]) });
    assert.ok(!JSON.stringify(verificada.secoes).includes(AVISO_REGRA_LEGAL_NAO_VERIFICADA));
  });

  it('indicacoesDaEvidencia: vencida só quando validoAte é anterior a hoje', () => {
    const base = { titulo: 'x', nota: 'B' as const };
    assert.deepEqual(indicacoesDaEvidencia({ ...base, validoAte: '2026-11-24' }, '2026-11-25'), ['vencida']);
    assert.deepEqual(indicacoesDaEvidencia({ ...base, validoAte: '2026-11-25' }, '2026-11-25'), []);
    assert.deepEqual(indicacoesDaEvidencia({ ...base, categoria: 'regra_legal', validoAte: '2026-01-01' }, '2026-11-25'), ['não verificada', 'vencida']);
    assert.deepEqual(indicacoesDaEvidencia({ ...base, categoria: 'benchmark' }, '2026-11-25'), []);
    assert.deepEqual(indicacoesDaEvidencia(undefined, '2026-11-25'), []);
  });

  it('regra de apostas verificada em 26/11/2026 mostra vencida só depois de 04/03/2027, sem a marca de não verificada', () => {
    const apostas = { titulo: 'Apostas: publicidade proibida no Brasil por medida provisória', nota: 'A' as const, categoria: 'regra_legal', validoAte: '2027-03-04', verificadoEm: '2026-11-26' };
    const entradasDoBrain = new Map([[URN_REGRA_LEGAL, apostas]]);
    const riscosEm = (agora: string) => JSON.stringify(ver('operator', painel(), { entradasDoBrain, agora: new Date(`${agora}T13:00:00.000Z`) }).secoes.find((s) => s.chave === 'riscos_e_regras')!.blocos);
    const noDiaDoVencimento = riscosEm('2027-03-04');
    assert.ok(!noDiaDoVencimento.includes('vencida'));
    assert.ok(!noDiaDoVencimento.includes('não verificada'));
    const depois = riscosEm('2027-03-05');
    assert.ok(depois.includes('"indicacoes":["vencida"]'));
    assert.ok(depois.includes(`${URN_REGRA_LEGAL} · vencida`));
    assert.ok(!depois.includes('não verificada'));
    assert.ok(!depois.includes(AVISO_REGRA_LEGAL_NAO_VERIFICADA));
  });

  it('lacuna de limite leva a Regras', () => {
    const plano = planoCompleto();
    const comLacuna = {
      ...plano,
      lacunas: { itens: [{ id: 'sem_teto', tipo: 'limite_ausente', medida: 'gasto', descricao: 'Falta o teto de investimento', impacto: 'Sem teto não dá para validar a verba' }] },
    };
    const visao = ver('operator', painel({ versaoExibida: versao({ conteudo: comLacuna }) }));
    const aviso = visao.avisos.find((a) => a.chave === 'lacunas');
    assert.ok(aviso);
    assert.match(aviso?.link?.href ?? '', new RegExp(`^/clientes/${CLIENTE_ID}/regras\\?secao=registrar&natureza=limite&definicao=gasto$`));
  });

  it('conteúdo fora do esquema vira aviso e não derruba a tela', () => {
    const visao = ver('operator', painel({ versaoExibida: versao({ conteudo: { antigo: true } }) }));
    assert.equal(visao.secoes.length, 0);
    assert.ok(visao.avisos.some((a) => a.chave === 'plano_ilegivel'));
  });
});

describe('visão do plano: limite declarado como não aplicável e novas checagens', () => {
  it('destaca o limite que o plano declara não aplicável, para quem autoriza ver', () => {
    const plano = planoCompleto();
    const conteudo = { ...plano, riscos_e_regras: { ...plano.riscos_e_regras, limites_nao_aplicaveis: [{ medida: 'custo_por_lead', motivo: 'Sem histórico de leads' }] } };
    const visao = ver('admin', painel({ versaoExibida: versao({ status: 'proposto', conteudo }) }));
    const secao = visao.secoes.find((s) => s.chave === 'riscos_e_regras');
    const bloco = secao?.blocos.find((b) => b.tipo === 'cartao' && b.destaque);
    assert.ok(bloco && bloco.tipo === 'cartao');
    assert.equal(bloco.titulo, 'O plano declara que o limite custo por lead não se aplica');
    assert.deepEqual(bloco.fatos, [{ rotulo: 'Motivo', valor: 'Sem histórico de leads' }]);
    assert.equal(bloco.selo, 'Confira antes de autorizar');
  });

  it('sem limite declarado nenhum cartão fica em destaque', () => {
    const visao = ver('operator', painel());
    const secao = visao.secoes.find((s) => s.chave === 'riscos_e_regras');
    assert.equal(secao?.blocos.some((b) => b.tipo === 'cartao' && b.destaque), false);
  });

  it('a checagem nova tem nome legível e a falta de outra execução aparece como motivo', () => {
    const payload = { resultado: 'aprovado', checagens: [{ chave: 'nao_faremos_preservado', resultado: 'aprovado', motivo: 'Ok', onde: [] }], modelo: null };
    const gate = evento('gate', payload, 3);
    const visao = ver('operator', painel({ gate: { resultado: 'aprovado', checagens: payload.checagens, criadoEm: gate.criadoEm }, historico: { versoes: [resumo()], eventos: [gate] }, faltaParaAplicar: ['gate_de_outra_execucao'] }));
    assert.equal(visao.gates?.checagens[0]?.rotulo, 'O que "não faremos" da versão base foi mantido');
    assert.deepEqual(acao(visao, 'aplicar')?.motivos, ['O Gate mais recente é de outra execução que a do Comitê desta versão; rode os Gates de novo.']);
  });
});

describe('visão do plano: Comitê, Gates e histórico', () => {
  const parecerPayload = {
    persona: 'redator',
    veredito: 'aprova_com_ajuste',
    motivo: 'Promessa genérica.',
    pontos: [
      { id: 'p1', trecho: 'posicionamento_e_mensagem', problema: 'Promessa vaga', ajustePedido: 'Dar número', fontes: [] },
      { id: 'p2', trecho: 'campanhas/c1', problema: 'Tom', ajustePedido: 'Ajustar tom', fontes: [] },
    ],
  };

  it('junta ponto e resposta do ajuste por persona', () => {
    const ajuste = evento('ajuste', { responde_a: VERSAO_ID, respostas: [{ pontoId: 'p1', persona: 'redator', decisao: 'acatado', motivo: 'Feito' }] }, 2);
    const visao = ver(
      'operator',
      painel({
        pareceres: [{ persona: 'redator', veredito: 'aprova_com_ajuste', criadoEm: AGORA, payload: parecerPayload }],
        ajuste,
      }),
    );
    const parecer = visao.pareceres[0];
    assert.equal(parecer?.nome, 'Redator');
    assert.equal(parecer?.rotuloDoVeredito, 'Aprova com ajuste');
    assert.deepEqual(parecer?.pontos.map((p) => p.resposta?.rotulo ?? null), ['Acatado', null]);
    assert.equal(visao.pontosPendentesDoComite, 1);
  });

  it('reprovação usa ícone e cor de erro', () => {
    const visao = ver('operator', painel({ pareceres: [{ persona: 'risco_legal', veredito: 'reprova', criadoEm: AGORA, payload: { ...parecerPayload, persona: 'risco_legal', veredito: 'reprova' } }] }));
    assert.equal(visao.pareceres[0]?.icone, 'erro');
    assert.equal(visao.pareceres[0]?.classe, 'pill--danger');
  });

  it('checagens dos Gates com nome legível, estado e problemas do modelo', () => {
    const payload = {
      resultado: 'reprovado',
      checagens: [
        { chave: 'orcamento_fecha', resultado: 'reprovado', motivo: 'Soma diferente', onde: ['orcamento'] },
        { chave: 'comite_completo', resultado: 'aprovado', motivo: 'Ok', onde: [] },
        { chave: 'regra_legal_presente', resultado: 'nao_rodou', motivo: 'Sem pacote', onde: [] },
      ],
      modelo: { resultado: 'reprovado', problemas: [{ trecho: 'campanhas', problema: 'Meta incoerente' }] },
    };
    const gate = evento('gate', payload, 3);
    const visao = ver(
      'operator',
      painel({
        gate: { resultado: 'reprovado', checagens: payload.checagens, criadoEm: gate.criadoEm },
        historico: { versoes: [resumo()], eventos: [gate] },
      }),
    );
    assert.equal(visao.gates?.rotuloDoResultado, 'Gates reprovaram');
    assert.deepEqual(visao.gates?.checagens.map((c) => [c.rotulo, c.rotuloDoResultado]), [
      ['A verba fecha com a soma das campanhas', 'Reprovada'],
      ['Comitê completo e todos os pontos respondidos', 'Aprovada'],
      ['Regra legal aplicável presente', 'Não rodou'],
    ]);
    assert.deepEqual(visao.gates?.problemasDoModelo, [{ trecho: 'campanhas', problema: 'Meta incoerente' }]);
    assert.equal(visao.checagensReprovadas, 2);
  });

  it('histórico numera versões da mais antiga e ordena eventos', () => {
    const antiga = resumo({ id: 'v-antiga', status: 'cancelado', criadaEm: new Date(AGORA.getTime() - 3_600_000) });
    const atual = resumo({ status: 'vigente', autorTipo: 'usuario', autorUsuarioId: USUARIO_ID, agentId: null });
    const e2 = { ...evento('gate', { resultado: 'aprovado', checagens: [] }, 5), id: 'e2' };
    const e1 = { ...evento('parecer', parecerPayload, 1), id: 'e1' };
    const visao = ver('operator', painel({ versaoExibida: versao({ status: 'vigente', autorTipo: 'usuario', autorUsuarioId: USUARIO_ID, agentId: null }), historico: { versoes: [atual, antiga], eventos: [e2, e1] } }), {
      nomes: new Map([[USUARIO_ID, 'Ana']]),
    });
    assert.deepEqual(visao.versoes.map((v) => [v.numero, v.rotuloDoStatus]), [[2, 'Autorizado'], [1, 'Cancelado']]);
    assert.equal(visao.versoes[0]?.autor.rotulo, 'Ana');
    assert.equal(visao.versoes[0]?.autor.tipo, 'pessoa');
    assert.equal(visao.versoes[1]?.autor.tipo, 'agente');
    assert.deepEqual(visao.eventos.map((e) => e.id), ['e1', 'e2']);
    assert.equal(visao.eventos[0]?.detalhe, 'Redator: Aprova com ajuste');
  });
});

describe('caminho legível de erro de validação', () => {
  it('troca seção por título e índice por posição', () => {
    assert.equal(caminhoLegivel('campanhas.campanhas.0.segmento_id'), 'Campanhas › campanhas › item 1 › segmento id');
    assert.equal(caminhoLegivel(''), 'Plano');
    assert.equal(caminhoLegivel('desconhecida.x'), 'desconhecida › x');
  });
});

describe('visão do plano: execução presa e sem plano com execução', () => {
  const MINUTOS = 60_000;
  const depois = (minutos: number) => new Date(AGORA.getTime() + minutos * MINUTOS);

  it('execução que atualizou há pouco não é parada', () => {
    const visao = visaoDoPlano({ painel: painel({ execucaoAtiva: execucao() }), papel: 'operator', clienteId: CLIENTE_ID, agora: depois(2) });
    assert.equal(visao.execucao?.parada, false);
    assert.ok(visao.avisos.some((a) => a.chave === 'em_andamento'));
  });

  it('execução sem avanço há mais do limite vira aviso claro e continua cancelável', () => {
    const visao = visaoDoPlano({ painel: painel({ execucaoAtiva: execucao({ status: 'pendente' }) }), papel: 'operator', clienteId: CLIENTE_ID, agora: depois(11) });
    assert.equal(visao.execucao?.parada, true);
    const aviso = visao.avisos.find((a) => a.chave === 'execucao_parada');
    assert.equal(aviso?.titulo, 'A execução não está avançando');
    assert.equal(aviso?.link?.rotulo, 'Atualizar');
    assert.equal(visao.avisos.some((a) => a.chave === 'em_andamento'), false);
    assert.equal(visao.acoes.find((a) => a.chave === 'cancelar_execucao')?.habilitada, true);
  });

  it('lease vencido além da tolerância conta como presa mesmo com atualização recente', () => {
    const rodando = execucao({ status: 'rodando', atualizadaEm: depois(5), leaseAte: depois(1) });
    const visao = visaoDoPlano({ painel: painel({ execucaoAtiva: rodando }), papel: 'operator', clienteId: CLIENTE_ID, agora: depois(6) });
    assert.equal(visao.execucao?.parada, true);
  });

  it('sem plano e com execução ativa: Cancelar execução existe e Novo plano fica desabilitado', () => {
    const visao = visaoDoPlano({ painel: painel({ versaoExibida: null, execucaoAtiva: execucao({ status: 'pendente' }) }), papel: 'operator', clienteId: CLIENTE_ID, agora: depois(1) });
    assert.equal(visao.temPlano, false);
    assert.equal(visao.acoes.find((a) => a.chave === 'cancelar_execucao')?.habilitada, true);
    assert.equal(visao.acoes.find((a) => a.chave === 'novo_plano')?.habilitada, false);
  });

  it('exige a versão exibida para os formulários de edição e mudança', () => {
    const visao = ver('operator', painel());
    assert.equal(visao.versao?.id, VERSAO_ID);
  });
});
