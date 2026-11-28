import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { ConfiguracaoDoComite, Execucao, LeitorDoBrain, PedidoDeIA } from '@/modules/strategy/application/portas';
import { parecer, ponto } from '../domain/comite/fixturesDeParecer.ts';
import { CHAMADAS_DOS_COMITES, MEMBROS_DOS_COMITES, comiteDoPedido, ehPedidoDeComite, mesaQueConcorda, membroDoPedido, respostaDoComite, rodadaDoPedido } from '../domain/comite/fixturesDoComite.ts';
import { COMITES, chamadasPorRodadaDoComite } from '../domain/comite/comites.ts';
import { CLIENTE_ID, ORGANIZACAO_ID, CATALOGOS_DE_TESTE, hashDeTeste, pacoteDeTeste, planoCompleto, secoesDoGrupoDaChave, urnDeTeste } from '../domain/fixturesDeTeste.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createMotorDoPlano, COMITES_EM_ANDAMENTO, PARALELISMO_DO_COMITE, PARALELISMO_DO_COMITE_APOS_FALHA } = await import('./motorDoPlano.ts');
const { INSTRUCAO_COMUM_DOS_MEMBROS, instrucaoDoMembro, instrucaoDaMesa1, instrucaoDaMesa2 } = await import('./instrucoes/mesa.ts');
const { INSTRUCAO_DO_AGENTE_DE_PLANO, TAREFA_PARA_CRIAR_PLANO, instrucaoDoGrupo } = await import('./instrucoes/agenteDePlano.ts');
const { GRUPOS_DE_REDACAO } = await import('../domain/gruposDoPlano.ts');
const { MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA, pacoteParaEntrada } = await import('../domain/pacote.ts');
const { textoDosDados } = await import('../../ia/domain/tarefa.ts');
const { criarRepositorioEmMemoria } = await import('../infrastructure/repositorioEmMemoria.ts');
const { criarIaFalsa, aceitaTodos } = await import('../infrastructure/ia/iaFalsa.ts');
const { ok } = await import('../../../shared/result/result.ts');

type Roteiro = (pedido: PedidoDeIA<unknown>) => unknown | Promise<unknown>;

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

async function montar(opcoes: { roteiro?: Roteiro; configuracoes?: ConfiguracaoDoComite[]; tempo?: () => Date; brain?: LeitorDoBrain; uso?: { tokensDeEntrada: number; tokensDeEntradaEmCache: number; tokensDeSaida: number } } = {}) {
  const repositorio = criarRepositorioEmMemoria();
  const ia = criarIaFalsa(opcoes.roteiro ?? roteiro(), opcoes.uso);
  const auditorias: AuditEvent[] = [];
  const motor = createMotorDoPlano({
    catalogos: CATALOGOS_DE_TESTE,
    repositorio,
    executorDeIA: ia,
    leitorDoBrain: opcoes.brain ?? brainOk,
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

describe('motor do plano: custo e velocidade do Comitê (ADR 0076)', () => {
  const pacoteGrande = (quantidade = 60) => {
    const base = pacoteDeTeste();
    const extras = Array.from({ length: quantidade }, (_, i) => ({
      urn: urnDeTeste('conhecimento', `extra-${i}`),
      hash: hashDeTeste(200 + i),
      tipo: 'conhecimento' as const,
      titulo: `Evidência extra ${i}`,
      resumo: `Texto da evidência extra ${i}. `.repeat(6),
      somenteMetadados: false,
    }));
    return { ...base, entradas: [...base.entradas, ...extras] };
  };
  const brainGrande: LeitorDoBrain = { async lerPacote() { return ok(pacoteGrande()); } };
  const ehMembro = (pedido: PedidoDeIA<unknown>) => ehPedidoDeComite(pedido) && rodadaDoPedido(pedido) === 0;
  const pausa = () => new Promise((resolver) => setTimeout(resolver, 2));

  function roteiroQueMede() {
    const medida = { ativas: 0, pico: 0, membrosAtivos: 0, membrosIniciados: 0, membrosComOPrimeiroAberto: 0, primeiroTerminou: false, comites: new Set<string>(), picoDeComites: 0, emAndamento: new Map<string, number>() };
    const medir: Roteiro = async (pedido) => {
      if (!ehPedidoDeComite(pedido)) return roteiro()(pedido);
      const comite = comiteDoPedido(pedido).chave;
      const membro = ehMembro(pedido);
      medida.ativas += 1;
      medida.pico = Math.max(medida.pico, medida.ativas);
      medida.emAndamento.set(comite, (medida.emAndamento.get(comite) ?? 0) + 1);
      medida.picoDeComites = Math.max(medida.picoDeComites, medida.emAndamento.size);
      if (membro) {
        medida.membrosIniciados += 1;
        if (medida.membrosIniciados > 1 && !medida.primeiroTerminou) medida.membrosComOPrimeiroAberto += 1;
      }
      await pausa();
      const primeiro = membro && medida.membrosIniciados === 1;
      medida.ativas -= 1;
      const restantes = medida.emAndamento.get(comite)! - 1;
      if (restantes === 0) medida.emAndamento.delete(comite);
      else medida.emAndamento.set(comite, restantes);
      if (primeiro) medida.primeiroTerminou = true;
      return respostaDoComite(pedido);
    };
    return { medida, medir };
  }

  it('todo membro recebe a mesma instrução de sistema, a parte dele no fim e o texto somado igual ao de antes', async () => {
    const m = await montar();
    await ate(m);
    const membros = doComite(m).filter(ehMembro);
    assert.equal(membros.length, MEMBROS_DOS_COMITES);
    for (const comite of COMITES) {
      for (const membro of comite.membros) {
        const pedido = membros.find((p) => p.chaveDeIdempotencia.endsWith(`:deliberacao:${comite.chave}:0:${membro.chave}`))!;
        assert.equal(pedido.instrucoes, INSTRUCAO_COMUM_DOS_MEMBROS);
        assert.equal(`${pedido.instrucoes}\n\n${pedido.instrucaoFinal}`, instrucaoDoMembro(comite, membro));
      }
    }
  });

  it('os dados do membro trazem o pacote primeiro e as mesmas entradas do recorte individual', async () => {
    const m = await montar({ brain: brainGrande });
    await ate(m);
    const membros = doComite(m).filter(ehMembro);
    const individual = pacoteParaEntrada(pacoteGrande(), MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA.comite, { comCatalogo: false });
    for (const pedido of membros) {
      const dados = pedido.dados as { pacote: { entradas: { urn: string }[] } };
      assert.deepEqual(Object.keys(dados), ['pacote', 'comite', 'persona', 'plano']);
      assert.deepEqual(dados.pacote.entradas.map((e) => e.urn).sort(), individual.entradas.map((e) => e.urn).sort());
    }
  });

  it('com pacote grande, todos os membros compartilham o mesmo prefixo estável, que é mesmo o começo dos dados de cada um', async () => {
    const m = await montar({ brain: brainGrande });
    await ate(m);
    const membros = doComite(m).filter(ehMembro);
    const prefixos = new Set(membros.map((p) => p.prefixoEstavelDosDados));
    assert.equal(prefixos.size, 1);
    const prefixo = [...prefixos][0]!;
    assert.ok(prefixo >= 4_000, `prefixo ${prefixo}`);
    const comeco = textoDosDados(membros[0]!.dados).slice(0, prefixo);
    for (const pedido of membros) assert.equal(textoDosDados(pedido.dados).slice(0, prefixo), comeco);
  });

  it('com pacote pequeno não há prefixo estável e nenhum membro espera aquecimento', async () => {
    const { medida, medir } = roteiroQueMede();
    const m = await montar({ roteiro: medir });
    await ate(m);
    for (const pedido of doComite(m).filter(ehMembro)) assert.equal(pedido.prefixoEstavelDosDados, undefined);
    assert.ok(medida.membrosComOPrimeiroAberto > 0);
  });

  it('as duas rodadas da mesa têm a mesma instrução de sistema, a rodada no fim, a mesa 1 por último nos dados e o mesmo prefixo estável', async () => {
    const m = await montar({ brain: brainGrande });
    await ate(m);
    let comPrefixo = 0;
    for (const comite of COMITES) {
      const daRodada = (rodada: number) => doComite(m).find((p) => p.chaveDeIdempotencia.endsWith(`:deliberacao:${comite.chave}:${rodada}`))!;
      const mesa1 = daRodada(1);
      const mesa2 = daRodada(2);
      assert.equal(mesa1.instrucoes, mesa2.instrucoes);
      assert.equal(`${mesa1.instrucoes}\n${mesa1.instrucaoFinal}`, instrucaoDaMesa1(comite));
      assert.equal(`${mesa2.instrucoes}\n${mesa2.instrucaoFinal}`, instrucaoDaMesa2(comite));
      assert.deepEqual(Object.keys(mesa1.dados as object), ['comite', 'membros', 'pareceres', 'plano', 'pacote']);
      assert.deepEqual(Object.keys(mesa2.dados as object), ['comite', 'membros', 'pareceres', 'plano', 'pacote', 'mesa1']);
      assert.equal(mesa1.prefixoEstavelDosDados, mesa2.prefixoEstavelDosDados);
      const prefixo = mesa1.prefixoEstavelDosDados;
      if (prefixo === undefined) continue;
      comPrefixo += 1;
      assert.ok(prefixo >= 4_000 && prefixo < textoDosDados(mesa1.dados).length, `prefixo ${prefixo}`);
      assert.equal(textoDosDados(mesa2.dados).slice(0, prefixo), textoDosDados(mesa1.dados).slice(0, prefixo));
    }
    assert.ok(comPrefixo > 0);
  });

  it('redação: os grupos de pacote completo têm a mesma instrução de sistema, o pedido do grupo no fim, o pacote primeiro e o mesmo prefixo estável', async () => {
    const m = await montar({ brain: brainGrande });
    await ate(m);
    const doGrupo = (indice: number) => m.ia.pedidos.find((p) => new RegExp(`:redigir:\\d+:g${indice}$`).test(p.chaveDeIdempotencia))!;
    const completos = [0, 1, 2].map(doGrupo);
    const individual = pacoteParaEntrada(pacoteGrande(), MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA.redigir);
    for (const [indice, pedido] of completos.entries()) {
      assert.equal(pedido.instrucoes, INSTRUCAO_DO_AGENTE_DE_PLANO);
      assert.equal(`${pedido.instrucoes}\n\n${pedido.instrucaoFinal}`, instrucaoDoGrupo(TAREFA_PARA_CRIAR_PLANO, GRUPOS_DE_REDACAO[indice]!, indice + 1, GRUPOS_DE_REDACAO.length));
      const dados = pedido.dados as { pacote: { entradas: { urn: string }[] } };
      assert.equal(Object.keys(dados)[0], 'pacote');
      assert.deepEqual(dados.pacote.entradas.map((e) => e.urn).sort(), individual.entradas.map((e) => e.urn).sort());
    }
    const prefixos = new Set(completos.map((p) => p.prefixoEstavelDosDados));
    assert.equal(prefixos.size, 1);
    const prefixo = [...prefixos][0]!;
    assert.ok(prefixo >= 4_000, `prefixo ${prefixo}`);
    const comeco = textoDosDados(completos[0]!.dados).slice(0, prefixo);
    for (const pedido of completos) assert.equal(textoDosDados(pedido.dados).slice(0, prefixo), comeco);
    for (const indice of [3, 5]) {
      const pedido = doGrupo(indice);
      assert.equal(pedido.instrucaoFinal, undefined);
      assert.equal(pedido.prefixoEstavelDosDados, undefined);
      assert.equal(pedido.instrucoes, instrucaoDoGrupo(TAREFA_PARA_CRIAR_PLANO, GRUPOS_DE_REDACAO[indice]!, indice + 1, GRUPOS_DE_REDACAO.length));
      assert.equal(Object.keys(pedido.dados as object).at(-1), 'pacote');
    }
  });

  it('redação: pacote que não cabe inteiro no limite sai como antes, sem instrução final nem prefixo', async () => {
    const acimaDoLimite = pacoteGrande(700);
    assert.ok(pacoteParaEntrada(acimaDoLimite, MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA.redigir).entradas.length < acimaDoLimite.entradas.length);
    const m = await montar({ brain: { async lerPacote() { return ok(acimaDoLimite); } } });
    await ate(m);
    const g0 = m.ia.pedidos.find((p) => /:redigir:\d+:g0$/.test(p.chaveDeIdempotencia))!;
    assert.equal(g0.instrucoes, instrucaoDoGrupo(TAREFA_PARA_CRIAR_PLANO, GRUPOS_DE_REDACAO[0]!, 1, GRUPOS_DE_REDACAO.length));
    assert.equal(g0.instrucaoFinal, undefined);
    assert.equal(g0.prefixoEstavelDosDados, undefined);
    assert.equal(Object.keys(g0.dados as object).at(-1), 'pacote');
  });

  it('aquecimento: a primeira chamada de membro termina antes de as outras começarem, e depois o leque abre até o teto', async () => {
    const { medida, medir } = roteiroQueMede();
    const m = await montar({ roteiro: medir, brain: brainGrande });
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.equal(medida.membrosComOPrimeiroAberto, 0);
    assert.ok(medida.pico > PARALELISMO_DO_COMITE_APOS_FALHA, `pico ${medida.pico}`);
    assert.ok(medida.pico <= PARALELISMO_DO_COMITE, `pico ${medida.pico}`);
    assert.ok(medida.picoDeComites <= COMITES_EM_ANDAMENTO, `comitês ${medida.picoDeComites}`);
    assert.ok(medida.picoDeComites > 1, 'mais de um comitê delibera ao mesmo tempo');
    assert.equal(doComite(m).length, CHAMADAS_DOS_COMITES);
    assert.deepEqual(repetidas(m), []);
  });

  it('falha no aquecimento não trava os outros membros do comitê e a repetição só refaz o que faltou', async () => {
    let falhou = false;
    const m = await montar({
      brain: brainGrande,
      roteiro: roteiro((pedido) => {
        if (ehMembro(pedido) && !falhou) {
          falhou = true;
          return { codigo: 'falha_do_fornecedor', mensagem: 'fora' };
        }
        return respostaDoComite(pedido);
      }),
    });
    const final = await ate(m);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.equal(repetidas(m).length, 1);
    assert.equal(doComite(m).length, CHAMADAS_DOS_COMITES + 1);
  });

  it('depois de uma falha da etapa, a repetição roda com o paralelismo reduzido', async () => {
    const { medida, medir } = roteiroQueMede();
    const montagem: { atual?: Montagem } = {};
    const etapaJaFoiAdiada = () => montagem.atual!.auditorias.some((a) => a.metadata?.etapa === 'comite' && a.metadata?.status === 'adiada');
    let falhou = false;
    montagem.atual = await montar({
      brain: brainGrande,
      roteiro: async (pedido) => {
        if (ehMembro(pedido) && !falhou) {
          falhou = true;
          return { codigo: 'falha_do_fornecedor', mensagem: 'fora' };
        }
        return etapaJaFoiAdiada() ? medir(pedido) : roteiro()(pedido);
      },
    });
    const final = await ate(montagem.atual);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    assert.ok(medida.pico > 1, `pico ${medida.pico}`);
    assert.ok(medida.pico <= PARALELISMO_DO_COMITE_APOS_FALHA, `pico ${medida.pico}`);
  });

  it('orçamento de tempo: o passo inicia vários comitês enquanto a estimativa cabe, em vez de um por passo', async () => {
    let agora = Date.parse('2026-11-25T12:00:00Z');
    const m = await montar({ tempo: () => new Date((agora += 100)) });
    const final = await ate(m, 240_000);
    assert.equal(final.status, 'concluida', JSON.stringify(final));
    const passosDoComite = m.auditorias.filter((a) => a.metadata?.etapa === 'comite' && a.metadata?.status !== 'adiada');
    assert.equal(passosDoComite.length, 1, 'os 17 comitês cabem num passo quando as chamadas são rápidas');
  });

  it('a auditoria do passo soma chamadas, tokens de entrada, tokens em cache e de saída, sem conteúdo', async () => {
    const m = await montar({ uso: { tokensDeEntrada: 1000, tokensDeEntradaEmCache: 800, tokensDeSaida: 50 } });
    await ate(m);
    const passo = m.auditorias.find((a) => a.metadata?.etapa === 'comite' && a.metadata?.proximaEtapa === 'ajustar')!;
    const uso = passo.metadata!.uso as Record<string, number>;
    assert.equal(uso.chamadas, CHAMADAS_DOS_COMITES);
    assert.equal(uso.tokensDeEntrada, CHAMADAS_DOS_COMITES * 1000);
    assert.equal(uso.tokensDeEntradaEmCache, CHAMADAS_DOS_COMITES * 800);
    assert.equal(uso.tokensDeSaida, CHAMADAS_DOS_COMITES * 50);
    assert.deepEqual(Object.keys(uso).sort(), ['chamadas', 'maiorChamadaMs', 'msDeIA', 'tokensDeEntrada', 'tokensDeEntradaEmCache', 'tokensDeSaida']);
  });
});
