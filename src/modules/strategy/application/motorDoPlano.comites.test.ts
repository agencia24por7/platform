import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { ConfiguracaoDoComite, Execucao, LeitorDoBrain, PedidoDeIA } from '@/modules/strategy/application/portas';
import { parecer, ponto } from '../domain/comite/fixturesDeParecer.ts';
import { CHAMADAS_DOS_COMITES, MEMBROS_DOS_COMITES, comiteDoPedido, ehPedidoDeComite, mesaQueConcorda, membroDoPedido, respostaDoComite, rodadaDoPedido } from '../domain/comite/fixturesDoComite.ts';
import { COMITES, chamadasPorRodadaDoComite } from '../domain/comite/comites.ts';
import { CLIENTE_ID, ORGANIZACAO_ID, CATALOGOS_DE_TESTE, pacoteDeTeste, planoCompleto, secoesDoGrupoDaChave } from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createMotorDoPlano } = await import('./motorDoPlano.ts');
const { criarRepositorioEmMemoria } = await import('../infrastructure/repositorioEmMemoria.ts');
const { criarIaFalsa, aceitaTodos } = await import('../infrastructure/ia/iaFalsa.ts');
const { ok } = await import('../../../shared/result/result.ts');

type Roteiro = (pedido: PedidoDeIA<unknown>) => unknown;

const respostasPara = (dados: unknown) =>
  (dados as { pontos: { pontos: { persona: string; pontoId: string }[] }[] }).pontos
    .flatMap((argumento) => argumento.pontos)
    .map((p) => ({ pontoId: p.pontoId, persona: p.persona, decisao: 'acatado' as const, motivo: 'acatado no ajuste' }));

function roteiro(comite: Roteiro = (pedido) => respostaDoComite(pedido)): Roteiro {
  return (pedido) => {
    if (pedido.tarefa === 'strategy_plan') {
      const secoes = secoesDoGrupoDaChave(pedido.chaveDeIdempotencia);
      return pedido.chaveDeIdempotencia.includes(':ajustar:') ? { secoes, respostas: respostasPara(pedido.dados) } : secoes;
    }
    if (ehPedidoDeComite(pedido)) return comite(pedido);
    if (pedido.tarefa === 'juiz') return aceitaTodos(pedido.dados);
    return { resultado: 'aprovado', problemas: [] };
  };
}

const brainOk: LeitorDoBrain = { async lerPacote() { return ok(pacoteDeTeste()); } };

async function montar(opcoes: { roteiro?: Roteiro; configuracoes?: ConfiguracaoDoComite[]; tempo?: () => Date } = {}) {
  const repositorio = criarRepositorioEmMemoria();
  const ia = criarIaFalsa(opcoes.roteiro ?? roteiro());
  const auditorias: AuditEvent[] = [];
  const motor = createMotorDoPlano({
    catalogos: CATALOGOS_DE_TESTE,
    repositorio,
    executorDeIA: ia,
    leitorDoBrain: brainOk,
    avaliadorDeLimites: { async avaliador() { return ok(Object.assign(() => 'ok' as const, { medidasComLimite: [] as const })); } },
    leitorDosComites: { async listar() { return opcoes.configuracoes ?? []; } },
    audit: { async record(e) { auditorias.push(e); }, async list() { return []; }, async search(_org, filtro) { return auditorias.filter((a) => a.action === filtro.action && a.targetId === filtro.targetId) as never; } },
    ...(opcoes.tempo ? { relogio: { agora: opcoes.tempo } } : {}),
  });
  const plano = await repositorio.criarPlano({ organizationId: ORGANIZACAO_ID, clientId: CLIENTE_ID }, 'aquisicao');
  assert.ok(plano.ok);
  const execucao = await repositorio.criarExecucao(ORGANIZACAO_ID, CLIENTE_ID, {
    planoId: plano.value.id,
    pedido: { tipo: 'criar', intencao: planoCompleto().intencao },
    versaoBaseId: null,
    agentRunId: 'run-comites-1',
    solicitadoPor: 'pessoa-1',
    requestId: 'r',
  });
  assert.ok(execucao.ok);
  return { repositorio, ia, motor, auditorias, execucaoId: execucao.value.id, ficha: { atual: 0 } };
}

type Montagem = Awaited<ReturnType<typeof montar>>;

async function reservar(m: Montagem) {
  const reservada = await m.repositorio.reservarExecucao(ORGANIZACAO_ID, m.execucaoId, { leaseMs: 60_000, agora: new Date('2026-11-25T12:00:00Z') });
  m.ficha.atual = reservada?.tentativas ?? m.ficha.atual;
}

async function ate(m: Montagem, orcamentoMs = 10_000_000): Promise<Execucao> {
  for (let i = 0; i < 40; i += 1) {
    await reservar(m);
    const resumo = await m.motor.avancarExecucao(ORGANIZACAO_ID, m.execucaoId, { orcamentoMs, ficha: m.ficha.atual });
    if (resumo.execucao && ['concluida', 'falhou', 'cancelada'].includes(resumo.execucao.status)) return resumo.execucao;
  }
  throw new Error('a execução não terminou');
}

const doComite = (m: Montagem) => m.ia.pedidos.filter(ehPedidoDeComite);
const pareceres = (m: Montagem) => m.repositorio.estado.eventos.filter((e) => e.tipo === 'parecer');
const repetidas = (m: Montagem) => {
  const vistas = new Map<string, number>();
  for (const pedido of doComite(m)) vistas.set(pedido.chaveDeIdempotencia, (vistas.get(pedido.chaveDeIdempotencia) ?? 0) + 1);
  return [...vistas.entries()].filter(([, vezes]) => vezes > 1).map(([chave]) => chave);
};

describe('motor do plano: comitês com membros e mesas (24K-134)', () => {
  it('rodada 1 convoca todos os comitês ligados: membros mais duas mesas por comitê, deliberações gravadas e um parecer por comitê', async () => {
    const m = await montar();
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.equal(CHAMADAS_DOS_COMITES, MEMBROS_DOS_COMITES + 2 * COMITES.length);
    assert.equal(doComite(m).length, CHAMADAS_DOS_COMITES);
    assert.equal(MEMBROS_DOS_COMITES, 35);
    assert.equal(CHAMADAS_DOS_COMITES, 69);
    assert.equal(m.repositorio.estado.deliberacoes.length, CHAMADAS_DOS_COMITES);
    assert.deepEqual(new Set(pareceres(m).map((e) => e.payload.persona)), new Set(COMITES.map((c) => c.chave)));
    assert.ok(pareceres(m).every((e) => e.agentId === e.payload.persona));
    assert.deepEqual(repetidas(m), []);
    const tokensPedidos = doComite(m).reduce((soma, pedido) => soma + pedido.orcamento.tokensMaximos, 0);
    assert.equal(tokensPedidos, CHAMADAS_DOS_COMITES * 5_000, 'teto de saída por rodada: 69 chamadas de até 5.000 tokens');
  });

  it('o parecer do comitê sai da mesa: veredito mais severo dos membros, persona igual à chave do comitê', async () => {
    const m = await montar({
      roteiro: roteiro((pedido) =>
        respostaDoComite(pedido, (membro) =>
          membro === 'checador_de_promessas' ? parecer(membro, 'aprova_com_ajuste', [ponto('c1', 'campanhas')]) : parecer(membro, 'aprova'),
        ),
      ),
    });
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    const doRedator = pareceres(m).find((e) => e.payload.persona === 'redator')!;
    assert.equal(doRedator.payload.veredito, 'aprova_com_ajuste');
    assert.deepEqual((doRedator.payload.pontos as { id: string }[]).map((p) => p.id), ['c1']);
    const ajuste = m.repositorio.estado.eventos.find((e) => e.tipo === 'ajuste')!;
    assert.deepEqual((ajuste.payload.respostas as { persona: string; pontoId: string }[]).map((r) => `${r.persona}/${r.pontoId}`), ['redator/c1']);
  });

  it('retomada depois de falha na mesa 2 não refaz membros nem mesa 1: só a chamada que falhou volta', async () => {
    let falhou = false;
    const m = await montar({
      roteiro: roteiro((pedido) => {
        if (!falhou && comiteDoPedido(pedido).chave === 'marca' && rodadaDoPedido(pedido) === 2) {
          falhou = true;
          return { codigo: 'falha_do_fornecedor', mensagem: 'fora do ar' };
        }
        return respostaDoComite(pedido);
      }),
    });
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.equal(doComite(m).length, CHAMADAS_DOS_COMITES + 1);
    assert.deepEqual(repetidas(m), [`${m.execucaoId}:deliberacao:marca:2`]);
    assert.equal(m.repositorio.estado.deliberacoes.length, CHAMADAS_DOS_COMITES);
  });

  it('perda da execução no meio do Comitê: o worker para, e quem retoma lê o que já foi deliberado', async () => {
    const m = await montar();
    m.repositorio.falharProxima('registrarDeliberacao', { codigo: 'execucao_perdida', mensagem: 'outro worker' });
    for (let i = 0; i < 3; i += 1) {
      await reservar(m);
      await m.motor.passo(ORGANIZACAO_ID, m.execucaoId, m.ficha.atual);
    }
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.ok(repetidas(m).length <= 1, `só a chamada cuja gravação caiu se repete: ${repetidas(m).join(',')}`);
    assert.equal(m.repositorio.estado.deliberacoes.length, CHAMADAS_DOS_COMITES);
  });

  it('comitê desligado não é convocado; risco e legal desligado na configuração segue convocado', async () => {
    const m = await montar({
      configuracoes: [
        { comite: 'cultura', ligado: false, atualizadoPor: null, atualizadoEm: null },
        { comite: 'risco_legal', ligado: false, atualizadoPor: null, atualizadoEm: null },
        { comite: 'marca', ligado: true, atualizadoPor: null, atualizadoEm: null },
      ],
    });
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    const cultura = COMITES.find((c) => c.chave === 'cultura')!;
    assert.equal(doComite(m).filter((p) => p.tarefa === 'comite_cultura').length, 0);
    assert.ok(doComite(m).some((p) => p.tarefa === 'comite_risco_legal'));
    assert.equal(doComite(m).length, CHAMADAS_DOS_COMITES - chamadasPorRodadaDoComite(cultura));
    assert.ok(!pareceres(m).some((e) => e.payload.persona === 'cultura'));
  });

  async function ateOAjuste(m: Awaited<ReturnType<typeof montar>>) {
    for (let i = 0; i < 10; i += 1) {
      await reservar(m);
      const passo = await m.motor.passo(ORGANIZACAO_ID, m.execucaoId, m.ficha.atual);
      if (passo.execucao?.etapa === 'ajustar' || passo.execucao?.etapa === 'gates') break;
    }
  }

  it('ligar um comitê entre a etapa do comitê e o Gate não o torna devido: o Gate cobra só quem foi convocado', async () => {
    const configuracoes: ConfiguracaoDoComite[] = [{ comite: 'cultura', ligado: false, atualizadoPor: null, atualizadoEm: null }];
    const m = await montar({ configuracoes });
    await ateOAjuste(m);
    configuracoes.length = 0;
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.ok(!pareceres(m).some((e) => e.payload.persona === 'cultura'));
  });

  it('desligar um comitê entre a etapa do comitê e o Gate não dispensa quem já foi convocado', async () => {
    const configuracoes: ConfiguracaoDoComite[] = [];
    const m = await montar({ configuracoes });
    await ateOAjuste(m);
    configuracoes.push({ comite: 'cultura', ligado: false, atualizadoPor: null, atualizadoEm: null });
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.ok(pareceres(m).some((e) => e.payload.persona === 'cultura'));
    const gate = m.repositorio.estado.eventos.find((e) => e.tipo === 'gate')!;
    const comite = (gate.payload.checagens as { chave: string; resultado: string }[]).find((c) => c.chave === 'comite_completo')!;
    assert.equal(comite.resultado, 'aprovado');
  });

  it('comitê com falha não repetível derruba a execução com motivo compacto e sem texto do modelo', async () => {
    const m = await montar({
      roteiro: roteiro((pedido) => (comiteDoPedido(pedido).chave === 'producao' ? { codigo: 'nao_configurada', mensagem: 'SEGREDO do fornecedor' } : respostaDoComite(pedido))),
    });
    const final = await ate(m);
    assert.equal(final.status, 'falhou');
    assert.equal(final.erroCodigo, 'ia_nao_configurada');
    const falha = m.auditorias.find((a) => a.metadata?.status === 'falhou')!;
    assert.match(String(falha.metadata?.motivo), /^comite:producao:ia:nao_configurada/);
    assert.ok(!JSON.stringify(m.auditorias).includes('SEGREDO'));
  });

  it('mesa que esquece um membro é saída inválida repetível; persistindo, falha com só os códigos do problema', async () => {
    const m = await montar({
      roteiro: roteiro((pedido) => {
        const comite = comiteDoPedido(pedido);
        const rodada = rodadaDoPedido(pedido);
        if (comite.chave === 'sdr' && rodada === 1) {
          const mesa = mesaQueConcorda(comite, 1);
          return { ...mesa, debate: [{ ...mesa.debate[0]!, posicao: 'TEXTO_DO_MODELO' }] };
        }
        return respostaDoComite(pedido);
      }),
    });
    const final = await ate(m);
    assert.equal(final.status, 'falhou');
    assert.equal(final.erroCodigo, 'ia_saida_invalida');
    const motivos = m.auditorias.map((a) => String(a.metadata?.motivo ?? ''));
    assert.ok(motivos.some((motivo) => motivo === 'comite:sdr:mesa_invalida:membro_ausente'), motivos.join('|'));
    assert.ok(!JSON.stringify(m.auditorias).includes('TEXTO_DO_MODELO'));
    assert.equal(m.repositorio.estado.deliberacoes.filter((d) => d.comite === 'sdr' && d.rodada === 1).length, 0, 'mesa inválida não é gravada');
    assert.equal(doComite(m).filter((p) => p.chaveDeIdempotencia.endsWith(':deliberacao:sdr:0:sdr')).length, 1, 'os membros não são refeitos nas repetições');
  });

  it('pontos que passariam do teto do juiz são cortados por cota e o motor conclui sem juiz_acima_do_teto', async () => {
    const m = await montar({
      roteiro: roteiro((pedido) =>
        respostaDoComite(pedido, (membro, comite) =>
          membro === comite.membros[0]!.chave && comite.chave !== 'risco_legal'
            ? parecer(membro, 'aprova_com_ajuste', [ponto('a1', 'campanhas'), ponto('a2', 'estrategia'), ponto('a3', 'orcamento')])
            : parecer(membro, 'aprova'),
        ),
      ),
    });
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.equal(m.ia.pedidos.filter((p) => p.tarefa === 'juiz').length, 1);
    const pontos = pareceres(m).reduce((soma, e) => soma + (e.payload.pontos as unknown[]).length, 0);
    assert.ok(pontos <= 45, `pontos no juiz: ${pontos}`);
    assert.ok(!m.auditorias.some((a) => String(a.metadata?.motivo ?? '').startsWith('juiz_acima_do_teto')));
  });

  it('orçamento de tempo curto divide o Comitê em vários passos sem refazer chamadas', async () => {
    let agora = Date.parse('2026-11-25T12:00:00Z');
    const m = await montar({ tempo: () => new Date((agora += 20_000)) });
    const final = await ate(m, 100_000);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    const passosDoComite = m.auditorias.filter((a) => a.metadata?.etapa === 'comite' && a.metadata?.proximaEtapa === 'comite');
    assert.ok(passosDoComite.length > 0, 'o Comitê foi retomado em mais de um passo');
    assert.equal(doComite(m).length, CHAMADAS_DOS_COMITES);
    assert.deepEqual(repetidas(m), []);
  });

  it('o pedido ao membro leva só as seções dele e o do mesa não leva o pacote inteiro', async () => {
    const m = await montar();
    await ate(m);
    const membro = doComite(m).find((p) => membroDoPedido(p) === 'checador_de_promessas')!;
    assert.deepEqual(Object.keys((membro.dados as { plano: object }).plano).sort(), ['campanhas', 'intencao', 'plano_de_midia', 'posicionamento_e_mensagem', 'schema_version']);
    const mesa = doComite(m).find((p) => p.chaveDeIdempotencia.endsWith(':deliberacao:redator:2'))!;
    const dados = mesa.dados as { pareceres: unknown[]; mesa1: unknown; membros: unknown[] };
    assert.equal(dados.pareceres.length, 2);
    assert.ok(dados.mesa1);
    assert.equal(dados.membros.length, 2);
  });
});
