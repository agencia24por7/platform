import { err, ok, type Result } from '@/shared/result/result';
import { MAXIMO_DE_RESERVAS } from '@/modules/strategy/application/portas';
import type {
  Autoria,
  ErroDeEstrategia,
  EventoDaVersao,
  Execucao,
  NovaExecucao,
  NovaVersao,
  NovoEvento,
  Plano,
  PlanoDoCliente,
  RepositorioDeEstrategia,
  Versao,
  VersaoResumo,
} from '@/modules/strategy/application/portas';
import { vereditosDoEvento } from '@/modules/strategy/domain/index';
import {
  passouPeloComite,
  podeAplicar,
  pedidoParaOBancoEmMemoria,
  type EventoDaCadeia,
  type StatusDaVersao,
} from '@/modules/strategy/infrastructure/suporteDaMemoria';

type VersaoInterna = Omit<Versao, 'status'> & { status: StatusDaVersao; agentIdDaVersao: string | null; chave: string | null };
type EventoInterno = EventoDaVersao & { chave: string | null };
type ExecucaoInterna = { -readonly [K in keyof Execucao]: Execucao[K] };

export type RepositorioEmMemoria = RepositorioDeEstrategia & {
  readonly estado: {
    readonly planos: Plano[];
    readonly versoes: VersaoInterna[];
    readonly eventos: EventoInterno[];
    readonly execucoes: ExecucaoInterna[];
  };
  criarPlano(escopo: { readonly organizationId: string; readonly clientId: string }, tipo: string, destino?: Partial<Pick<Plano, 'plataformas' | 'whatsapp' | 'landingPageId'>>): Promise<Result<Plano, ErroDeEstrategia>>;
  falharProxima(metodo: keyof RepositorioDeEstrategia, erro: ErroDeEstrategia): void;
  contagemDeChamadas(metodo: keyof RepositorioDeEstrategia): number;
};

const FINAIS = ['concluida', 'falhou', 'cancelada'];
const TRANSICOES_DO_WORKER = [
  ['pendente', 'rodando'],
  ['rodando', 'concluida'],
  ['rodando', 'falhou'],
  ['rodando', 'pendente'],
];

export function criarRepositorioEmMemoria(): RepositorioEmMemoria {
  const planos: Plano[] = [];
  const versoes: VersaoInterna[] = [];
  const eventos: EventoInterno[] = [];
  const execucoes: ExecucaoInterna[] = [];
  const falhas = new Map<string, ErroDeEstrategia[]>();
  const chamadas = new Map<string, number>();
  let contador = 0;
  let relogio = Date.parse('2026-11-25T12:00:00.000Z');

  const id = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, '0')}`;
  const agora = () => new Date((relogio += 10));

  const erro = (codigo: ErroDeEstrategia['codigo'], mensagem: string): ErroDeEstrategia => ({ codigo, mensagem });
  const resumo = (v: VersaoInterna): VersaoResumo => {
    const { conteudo: _c, referencias: _r, agentIdDaVersao: _a, chave: _k, ...resto } = v;
    return resto;
  };
  const injetada = (metodo: string): ErroDeEstrategia | null => falhas.get(metodo)?.shift() ?? null;
  const contar = (metodo: string) => chamadas.set(metodo, (chamadas.get(metodo) ?? 0) + 1);
  const entrada = (metodo: string): ErroDeEstrategia | null => {
    contar(metodo);
    return injetada(metodo);
  };

  const execucaoAtivaDoAgente = (agentRunId: string, planoId: string, ficha: number) =>
    execucoes.some((e) => e.agentRunId === agentRunId && e.planoId === planoId && e.status === 'rodando' && e.tentativas === ficha);

  const reservarNaMemoria = (alvo: ExecucaoInterna, opcoes: { readonly leaseMs: number; readonly agora: Date }): ExecucaoInterna | null => {
    if (alvo.tentativas + 1 > MAXIMO_DE_RESERVAS) {
      Object.assign(alvo, { status: 'falhou', erroCodigo: 'interno', leaseAte: null, tentativas: alvo.tentativas + 1, atualizadaEm: agora() });
      return null;
    }
    Object.assign(alvo, { status: 'rodando', tentativas: alvo.tentativas + 1, leaseAte: new Date(opcoes.agora.getTime() + opcoes.leaseMs) });
    return alvo;
  };

  const cadeia = () => {
    const mapa = new Map<string, EventoDaCadeia[]>();
    for (const e of eventos) {
      const lista = mapa.get(e.versaoId) ?? [];
      lista.push({ tipo: e.tipo, atorTipo: e.atorTipo, agentRunId: e.agentRunId, payload: e.payload });
      mapa.set(e.versaoId, lista);
    }
    return mapa;
  };

  function inserirEvento(novo: NovoEvento): Result<EventoDaVersao, ErroDeEstrategia> {
    const versao = versoes.find((v) => v.id === novo.versaoId);
    if (!versao) return err(erro('nao_encontrado', 'versão'));
    const agente = novo.autoria.tipo === 'agente' ? novo.autoria : null;
    if (agente && !execucaoAtivaDoAgente(agente.agentRunId, versao.planoId, agente.ficha)) return err(erro('execucao_perdida', 'execução do agente inativa'));
    if (agente) {
      if (['efetivada', 'rejeitada', 'revogada', 'proposta'].includes(novo.tipo)) return err(erro('sem_permissao', 'agente'));
      if (eventos.some((e) => e.versaoId === versao.id && e.agentId === agente.agentId && e.chave === agente.chaveDeIdempotencia)) {
        return err(erro('ja_feito', 'idempotência'));
      }
    } else if (['parecer', 'ajuste', 'gate', 'veredito_juiz'].includes(novo.tipo)) {
      return err(erro('sem_permissao', 'pessoa'));
    }
    if (['parecer', 'ajuste', 'gate', 'veredito_juiz'].includes(novo.tipo) && versao.status !== 'rascunho') {
      return err(erro('transicao_invalida', 'só valem em versão rascunho'));
    }
    if (novo.tipo === 'parecer') {
      if (typeof novo.payload.persona !== 'string' || typeof novo.payload.veredito !== 'string') return err(erro('invalido', 'parecer'));
      if (eventos.some((e) => e.versaoId === versao.id && e.tipo === 'parecer' && e.payload.persona === novo.payload.persona)) {
        return err(erro('ja_feito', 'parecer por persona'));
      }
    }
    if (novo.tipo === 'ajuste') {
      const respondida = novo.payload.responde_a;
      if (typeof respondida !== 'string' || respondida === versao.id) return err(erro('invalido', 'ajuste'));
      if (eventos.some((e) => e.versaoId === versao.id && e.tipo === 'ajuste')) return err(erro('ja_feito', 'um ajuste'));
      const mapa = cadeia();
      const substituida = (mapa.get(respondida) ?? []).some(
        (e) => e.tipo === 'cancelada' && e.atorTipo === 'sistema' && e.payload.por === versao.id,
      );
      if (!substituida || !passouPeloComite(respondida, mapa, agente?.agentRunId ?? null)) return err(erro('invalido', 'ajuste.responde_a'));
    }
    if (novo.tipo === 'gate' && !['aprovado', 'reprovado'].includes(String(novo.payload.resultado))) return err(erro('invalido', 'gate'));
    if (novo.tipo === 'veredito_juiz') {
      if (!vereditosDoEvento(novo.payload)) return err(erro('invalido', 'veredito do juiz'));
      if (eventos.some((e) => e.versaoId === versao.id && e.tipo === 'veredito_juiz')) return err(erro('ja_feito', 'um veredito por versão'));
    }

    const evento: EventoInterno = {
      id: id(),
      versaoId: versao.id,
      tipo: novo.tipo,
      atorTipo: agente ? 'agente' : 'usuario',
      atorUsuarioId: novo.autoria.tipo === 'pessoa' ? novo.autoria.userId : null,
      agentId: agente?.agentId ?? null,
      agentRunId: agente?.agentRunId ?? null,
      payload: novo.payload,
      criadoEm: agora(),
      chave: agente?.chaveDeIdempotencia ?? null,
    };

    if (novo.tipo === 'proposta') {
      const lista = eventos.filter((e) => e.versaoId === versao.id);
      const paraAplicar = lista.map((e) =>
        e.tipo === 'parecer'
          ? ({ tipo: 'parecer', agentRunId: e.agentRunId } as const)
          : e.tipo === 'ajuste'
            ? ({ tipo: 'ajuste', respondeA: String(e.payload.responde_a ?? ''), agentRunId: e.agentRunId } as const)
            : e.tipo === 'gate'
              ? ({ tipo: 'gate', resultado: e.payload.resultado === 'aprovado' ? 'aprovado' : 'reprovado', agentRunId: e.agentRunId } as const)
              : ({ tipo: 'outro' } as const),
      );
      const mapa = cadeia();
      const aplicavel = podeAplicar({ eventosDaVersao: paraAplicar, respondidaPassouPeloComite: passouPeloComite(versao.id, mapa) });
      if (!aplicavel.ok) return err(erro('falta_para_aplicar', aplicavel.error.join(',')));
    }
    const alvo: Record<string, StatusDaVersao> = { proposta: 'proposto', efetivada: 'vigente', rejeitada: 'rejeitado', revogada: 'revogado', cancelada: 'cancelado' };
    eventos.push(evento);
    if (alvo[novo.tipo]) versao.status = alvo[novo.tipo]!;
    const { chave: _chave, ...publico } = evento;
    return ok(publico);
  }

  const estadoDe = (plano: Plano): PlanoDoCliente => {
    const doPlano = versoes.filter((v) => v.planoId === plano.id);
    const recente = doPlano.at(-1);
    const vigente = doPlano.find((v) => v.status === 'vigente');
    const aberta = doPlano.find((v) => v.status === 'rascunho' || v.status === 'proposto');
    const ultima = execucoes.filter((e) => e.planoId === plano.id).at(-1);
    const primeiraDeCriar = execucoes.find((e) => e.planoId === plano.id && e.tipo === 'criar');
    const objetivo = typeof primeiraDeCriar?.pedido.objetivo === 'string' ? primeiraDeCriar.pedido.objetivo : null;
    const datas = [plano.criadoEm, recente?.criadaEm, ultima?.atualizadaEm].filter((data): data is Date => data instanceof Date);
    return {
      plano,
      maisRecente: recente ? resumo(recente) : null,
      vigente: vigente ? resumo(vigente) : null,
      aberta: aberta ? resumo(aberta) : null,
      objetivo,
      ultimaExecucao: ultima ? { ...ultima } : null,
      atualizadoEm: new Date(Math.max(...datas.map((data) => data.getTime()))),
    };
  };

  const repositorio: RepositorioDeEstrategia = {
    async clienteVisivel() {
      return true;
    },
    async buscarPlanoPorId(_org, planoId) {
      return planos.find((p) => p.id === planoId) ?? null;
    },
    async clienteDoRecurso(_org, tipo, recursoId) {
      const lista = tipo === 'plano' ? planos : tipo === 'versao' ? versoes : execucoes;
      return lista.find((item) => item.id === recursoId)?.clientId ?? null;
    },
    async criarPlanoComExecucao(escopo, novo, execucao) {
      const falha = entrada('criarPlanoComExecucao');
      if (falha) return err(falha);
      const plano: Plano = {
        id: id(),
        organizationId: escopo.organizationId,
        clientId: escopo.clientId,
        tipo: novo.tipo,
        plataformas: novo.plataformas,
        whatsapp: novo.whatsapp,
        landingPageId: novo.landingPageId,
        criadoEm: agora(),
      };
      planos.push(plano);
      const criada = await repositorio.criarExecucao(escopo.organizationId, escopo.clientId, { ...execucao, planoId: plano.id });
      if (!criada.ok) {
        planos.splice(planos.indexOf(plano), 1);
        return err(criada.error);
      }
      return ok({ plano, execucao: criada.value });
    },
    async listarPlanosDoCliente(escopo) {
      contar('listarPlanosDoCliente');
      return planos
        .filter((p) => p.clientId === escopo.clientId)
        .map(estadoDe)
        .reverse();
    },
    async estadoDoPlano(_org, planoId) {
      contar('estadoDoPlano');
      const plano = planos.find((p) => p.id === planoId);
      return plano ? estadoDe(plano) : null;
    },
    async criarVersaoRascunho(org, nova: NovaVersao) {
      const falha = entrada('criarVersaoRascunho');
      if (falha) return err(falha);
      const plano = planos.find((p) => p.id === nova.planoId && p.organizationId === org);
      if (!plano) return err(erro('nao_encontrado', 'plano'));
      const agente = nova.autoria.tipo === 'agente' ? nova.autoria : null;
      if (agente && !execucaoAtivaDoAgente(agente.agentRunId, plano.id, agente.ficha)) return err(erro('execucao_perdida', 'execução do agente inativa'));
      if (agente && versoes.some((v) => v.planoId === plano.id && v.agentIdDaVersao === agente.agentId && v.chave === agente.chaveDeIdempotencia)) {
        return err(erro('ja_feito', 'idempotência'));
      }
      const vigente = versoes.find((v) => v.planoId === plano.id && v.status === 'vigente');
      if (vigente && nova.supersedesId !== vigente.id) return err(erro('conflito', 'o plano já tem versão vigente'));
      const novaId = id();
      const aberta = versoes.find((v) => v.planoId === plano.id && (v.status === 'rascunho' || v.status === 'proposto'));
      if (aberta) {
        eventos.push({
          id: id(),
          versaoId: aberta.id,
          tipo: 'cancelada',
          atorTipo: 'sistema',
          atorUsuarioId: null,
          agentId: null,
          agentRunId: null,
          payload: { motivo: 'substituida_por_edicao', por: novaId },
          criadoEm: agora(),
          chave: null,
        });
        aberta.status = 'cancelado';
      }
      const versao: VersaoInterna = {
        id: novaId,
        planoId: plano.id,
        organizationId: org,
        clientId: plano.clientId,
        status: 'rascunho',
        schemaVersion: nova.schemaVersion,
        supersedesId: nova.supersedesId,
        autorTipo: agente ? 'agente' : 'usuario',
        autorUsuarioId: nova.autoria.tipo === 'pessoa' ? nova.autoria.userId : null,
        agentId: agente?.agentId ?? null,
        agentRunId: agente?.agentRunId ?? null,
        redigidaEm: null,
        criadaEm: agora(),
        conteudo: nova.conteudo,
        referencias: nova.referencias,
        agentIdDaVersao: agente?.agentId ?? null,
        chave: agente?.chaveDeIdempotencia ?? null,
      };
      versoes.push(versao);
      for (const inicial of nova.eventosIniciais ?? []) {
        const resultado = inserirEvento({ ...inicial, versaoId: versao.id, requestId: nova.requestId });
        if (!resultado.ok) {
          versoes.splice(versoes.indexOf(versao), 1);
          return err(resultado.error);
        }
      }
      return ok(versao);
    },
    async registrarEvento(_org, novo) {
      const falha = entrada('registrarEvento');
      if (falha) return err(falha);
      return inserirEvento(novo);
    },
    async lerVersao(_org, versaoId) {
      contar('lerVersao');
      return versoes.find((v) => v.id === versaoId) ?? null;
    },
    async listarVersoes(_org, planoId, limite) {
      contar('listarVersoes');
      return versoes.filter((v) => v.planoId === planoId).map(resumo).reverse().slice(0, limite);
    },
    async eventosDaVersao(_org, versaoId) {
      contar('eventosDaVersao');
      return eventos.filter((e) => e.versaoId === versaoId).map(({ chave: _c, ...resto }) => resto);
    },
    async criarExecucao(org, clientId, nova: NovaExecucao) {
      if (execucoes.some((e) => e.planoId === nova.planoId && (e.status === 'pendente' || e.status === 'rodando'))) {
        return err(erro('execucao_ativa', 'já há execução ativa'));
      }
      const execucao: ExecucaoInterna = {
        id: id(),
        planoId: nova.planoId,
        organizationId: org,
        clientId,
        tipo: nova.pedido.tipo,
        pedido: pedidoParaOBancoEmMemoria(nova.pedido),
        versaoBaseId: nova.versaoBaseId,
        status: 'pendente',
        etapa: 'ler_brain',
        rodada: 0,
        tentativas: 0,
        falhas: 0,
        erroCodigo: null,
        agentRunId: nova.agentRunId,
        solicitadoPor: nova.solicitadoPor,
        solicitadoTipo: 'usuario',
        leaseAte: null,
        criadaEm: agora(),
        atualizadaEm: agora(),
      };
      execucoes.push(execucao);
      return ok(execucao);
    },
    async lerExecucao(_org, execucaoId) {
      contar('lerExecucao');
      const execucao = execucoes.find((e) => e.id === execucaoId);
      return execucao ? { ...execucao } : null;
    },
    async execucaoAtiva(_org, planoId) {
      const execucao = execucoes.find((e) => e.planoId === planoId && (e.status === 'pendente' || e.status === 'rodando'));
      return execucao ? { ...execucao } : null;
    },
    async execucoesDoPlano(_org, planoId, limite) {
      return execucoes.filter((e) => e.planoId === planoId).map((e) => ({ ...e })).reverse().slice(0, limite);
    },
    async ultimaExecucao(_org, planoId) {
      const execucao = execucoes.filter((e) => e.planoId === planoId).at(-1);
      return execucao ? { ...execucao } : null;
    },
    async cancelarExecucao(_org, execucaoId) {
      const execucao = execucoes.find((e) => e.id === execucaoId);
      if (!execucao) return err(erro('nao_encontrado', 'execução'));
      if (FINAIS.includes(execucao.status)) return err(erro('transicao_invalida', 'estado final'));
      execucao.status = 'cancelada';
      return ok({ ...execucao });
    },
    async atualizarExecucao(_org, execucaoId, mudanca, ficha) {
      const falha = entrada('atualizarExecucao');
      if (falha) return err(falha);
      const execucao = execucoes.find((e) => e.id === execucaoId);
      if (!execucao || execucao.status !== 'rodando' || execucao.tentativas !== ficha) {
        return err(erro('execucao_perdida', 'execução não é mais deste worker'));
      }
      if (!execucao) return err(erro('nao_encontrado', 'execução'));
      if (FINAIS.includes(execucao.status)) return err(erro('transicao_invalida', 'execução em estado final'));
      const novoStatus = mudanca.status ?? execucao.status;
      if (novoStatus !== execucao.status && !TRANSICOES_DO_WORKER.some(([de, para]) => de === execucao.status && para === novoStatus)) {
        return err(erro('transicao_invalida', 'transição inválida de execução'));
      }
      if ((mudanca.rodada ?? execucao.rodada) < execucao.rodada ||
        (mudanca.tentativas ?? execucao.tentativas) < execucao.tentativas ||
        (mudanca.falhas ?? execucao.falhas) < execucao.falhas) {
        return err(erro('invalido', 'rodada e tentativas só crescem'));
      }
      const proximo = { ...execucao, ...Object.fromEntries(Object.entries(mudanca).filter(([, valor]) => valor !== undefined)) } as ExecucaoInterna;
      if (proximo.status === 'falhou' && proximo.erroCodigo === null) return err(erro('invalido', 'falha exige código'));
      if (proximo.status === 'concluida' && (proximo.erroCodigo !== null || proximo.etapa !== 'fim')) return err(erro('invalido', 'concluída'));
      Object.assign(execucao, proximo, { atualizadaEm: agora() });
      return ok({ ...execucao });
    },
    async reservarProximaExecucao(org, opcoes) {
      const alvo = execucoes.find(
        (e) => e.organizationId === org && (e.status === 'pendente' || (e.status === 'rodando' && e.leaseAte !== null && e.leaseAte < opcoes.agora)),
      );
      if (!alvo) return null;
      const reservada = reservarNaMemoria(alvo, opcoes);
      return reservada ? { ...reservada } : null;
    },
    async descobrirExecucoesPendentes(limite) {
      return execucoes
        .filter((e) => e.tentativas <= MAXIMO_DE_RESERVAS)
        .filter((e) => e.status === 'pendente' || (e.status === 'rodando' && e.leaseAte !== null && e.leaseAte.getTime() < relogio))
        .slice(0, Math.min(limite, 50))
        .map((e) => ({ organizationId: e.organizationId, clientId: e.clientId, id: e.id }));
    },
    async reservarExecucao(org, execucaoId, opcoes) {
      const alvo = execucoes.find(
        (e) =>
          e.id === execucaoId &&
          e.organizationId === org &&
          (e.status === 'pendente' || (e.status === 'rodando' && e.leaseAte !== null && e.leaseAte < opcoes.agora)),
      );
      if (!alvo) return null;
      const reservada = reservarNaMemoria(alvo, opcoes);
      return reservada ? { ...reservada } : null;
    },
    async criarVersaoManualComRevisao(org, clientId, versao, execucao) {
      if (execucoes.some((e) => e.planoId === execucao.planoId && (e.status === 'pendente' || e.status === 'rodando'))) {
        return err(erro('execucao_ativa', 'já há execução ativa'));
      }
      const criada = await repositorio.criarVersaoRascunho(org, versao);
      if (!criada.ok) return err(criada.error);
      const gravada = await repositorio.criarExecucao(org, clientId, { ...execucao, versaoBaseId: criada.value.id });
      if (!gravada.ok) return err(gravada.error);
      return ok({ versao: criada.value, execucao: gravada.value });
    },
  };

  return {
    ...repositorio,
    estado: { planos, versoes, eventos, execucoes },
    async criarPlano(escopo, tipo, destino = {}) {
      const plano: Plano = {
        id: id(),
        organizationId: escopo.organizationId,
        clientId: escopo.clientId,
        tipo,
        plataformas: destino.plataformas ?? ['meta'],
        whatsapp: destino.whatsapp ?? '+5511912345678',
        landingPageId: destino.landingPageId ?? '00000000-0000-4000-8000-0000000000aa',
        criadoEm: agora(),
      };
      planos.push(plano);
      return ok(plano);
    },
    falharProxima(metodo, erroInjetado) {
      falhas.set(metodo, [...(falhas.get(metodo) ?? []), erroInjetado]);
    },
    contagemDeChamadas: (metodo) => chamadas.get(metodo) ?? 0,
  };
}

export type { Autoria };
