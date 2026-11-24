import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { Decisao } from '@/modules/clients/domain/regras/index';
import type {
  DefinicaoDoBanco,
  Gravacao,
  NovaDecisao,
  NovoEvento,
  RegrasRepository,
} from '@/modules/clients/infrastructure/regrasRepository';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createRegrasService } = await import('./regrasService.ts');

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const AGORA = new Date('2026-11-24T12:00:00.000Z');
const ator = { userId: 'user-1', requestId: 'req-1', sourceIp: '10.0.0.1' };
const como = (papelDeQuemAge: 'owner' | 'admin' | 'operator' | 'viewer') => ({
  organizationId: ORG,
  clientId: CLIENTE,
  papelDeQuemAge,
});
const escopo = { organizationId: ORG, clientId: CLIENTE };

const TETO_MENSAL: DefinicaoDoBanco = {
  key: 'investimento.teto_mensal',
  version: 1,
  nome: 'Teto de investimento mensal',
  descricao: '',
  categoria: 'investimento',
  medida: 'gasto',
  unidade: 'brl_centavos',
  periodo: 'mes',
  sentido: 'teto',
  faixaMin: '0',
  faixaMax: '100000000',
  escoposAceitos: ['cliente'],
  tiposDeEscopo: ['cliente', 'plataforma'],
  essencial: true,
  ativo: true,
};

const centavos = (valor: string) => ({ unidade: 'brl_centavos' as const, centavos: valor, moeda: 'BRL' as const });

type Opcoes = {
  clienteVisivel?: boolean;
  falharInsercao?: Gravacao<Decisao> | null;
  falharAuditoria?: boolean;
  contagem?: { naExecucao: number; noPeriodo: number };
  tetoPorExecucao?: number;
  tetoPorClientePorDia?: number;
};

function montar(opcoes: Opcoes = {}) {
  const decisoes: Decisao[] = [];
  const eventos: NovoEvento[] = [];
  const auditoria: AuditEvent[] = [];
  const insercoes: NovaDecisao[] = [];
  const agendados: unknown[] = [];
  const definicoes: DefinicaoDoBanco[] = [TETO_MENSAL];
  const tetosRecebidos: unknown[] = [];
  let numero = 0;

  const repositorio: RegrasRepository = {
    async clienteVisivel() {
      return opcoes.clienteVisivel ?? true;
    },
    async listarDefinicoes() {
      return definicoes;
    },
    async definicaoAtiva(_org, chave) {
      return chave === TETO_MENSAL.key ? TETO_MENSAL : null;
    },
    async listarVigentes() {
      return decisoes.filter((d) => d.status === 'vigente');
    },
    async linhaDoTempo() {
      return { itens: decisoes, proximoCursor: null };
    },
    async historicoDaChave() {
      return [];
    },
    async listarPropostas() {
      return decisoes.filter((d) => d.status === 'proposta');
    },
    async buscarPorId(_org, _cliente, id) {
      return decisoes.find((d) => d.id === id) ?? null;
    },
    async buscarPorNumero(_org, _cliente, n) {
      return decisoes.find((d) => d.numero === n) ?? null;
    },
    async vigenteDaChave(_org, _cliente, natureza, chave, escopoDaRegra) {
      return (
        decisoes.find(
          (d) => d.status === 'vigente' && d.natureza === natureza && d.chave === chave && d.escopo === escopoDaRegra,
        ) ?? null
      );
    },
    async buscarPorIdempotencia(_org, _cliente, agentId, chave) {
      return decisoes.find((d) => d.agentId === agentId && d.chaveDeIdempotencia === chave) ?? null;
    },
    async inserirDecisao(_org, nova, _requestId, tetos) {
      insercoes.push(nova);
      tetosRecebidos.push(tetos);
      if (opcoes.falharInsercao) return opcoes.falharInsercao;
      numero += 1;
      const decisao: Decisao = {
        id: `00000000-0000-4000-8000-${String(numero).padStart(12, '0')}`,
        clienteId: nova.clienteId,
        numero,
        categoria: nova.categoria,
        natureza: nova.natureza,
        origem: nova.origem,
        forca: nova.forca,
        chave: nova.chave,
        escopo: nova.escopo,
        titulo: nova.titulo,
        contexto: nova.contexto,
        texto: nova.texto,
        valor: nova.valor,
        vigenciaInicio: AGORA,
        vigenciaFim: null,
        status: nova.status,
        supersedesId: nova.supersedesId,
        decididoPor: nova.decididoPor,
        emNomeDe: nova.emNomeDe,
        evidencia: nova.evidencia,
        semConfirmacaoDoAnunciante: nova.semConfirmacaoDoAnunciante,
        viaLinkId: null,
        agentId: nova.agentId,
        agentRunId: nova.agentRunId,
        agentSetHash: nova.agentSetHash,
        chaveDeIdempotencia: nova.chaveDeIdempotencia,
        definicaoChave: nova.definicaoChave,
        definicaoVersao: nova.definicaoVersao,
        revisarEConverterEmLimite: false,
        motivoDaRevogacao: null,
        criadoEm: AGORA,
      };
      if (nova.supersedesId) {
        const indice = decisoes.findIndex((d) => d.id === nova.supersedesId);
        if (indice >= 0 && decisao.status === 'vigente') decisoes[indice] = { ...decisoes[indice]!, status: 'superada' };
      }
      decisoes.push(decisao);
      return { ok: true, valor: decisao };
    },
    async inserirEvento(_org, evento) {
      eventos.push(evento);
      if (opcoes.falharInsercao) return opcoes.falharInsercao;
      const indice = decisoes.findIndex((d) => d.id === evento.decisaoId);
      const atual = decisoes[indice]!;
      const status = evento.tipo === 'efetivada' ? 'vigente' : evento.tipo === 'rejeitada' ? 'rejeitada' : 'revogada';
      decisoes[indice] = { ...atual, status, motivoDaRevogacao: evento.tipo === 'revogada' ? evento.motivo : null };
      return { ok: true, valor: decisoes[indice]! };
    },
    async filaDeRevisao() {
      return [];
    },
    async contagemParaProntidao() {
      return { essenciaisFaltando: [], vigentes: 0, propostasPendentes: 0, aRevisar: 0 };
    },
    async contarDoAgente() {
      return opcoes.contagem ?? { naExecucao: 0, noPeriodo: 0 };
    },
  };

  const audit = {
    async record(evento: AuditEvent) {
      if (opcoes.falharAuditoria) throw new Error('auditoria fora do ar');
      auditoria.push(evento);
    },
    async list() {
      return [];
    },
    async search() {
      return [];
    },
  };

  const servico = createRegrasService({
    repositorio,
    audit,
    agora: () => AGORA,
    agendarBrain: (e) => agendados.push(e),
    ...(opcoes.tetoPorExecucao !== undefined ? { tetoPorExecucao: opcoes.tetoPorExecucao } : {}),
    ...(opcoes.tetoPorClientePorDia !== undefined ? { tetoPorClientePorDia: opcoes.tetoPorClientePorDia } : {}),
  });
  return { servico, decisoes, eventos, auditoria, insercoes, agendados, definicoes, tetosRecebidos };
}

const limite = (valor = '1000000', extra: Record<string, unknown> = {}) => ({
  categoria: 'investimento' as const,
  natureza: 'limite' as const,
  chave: 'investimento.teto_mensal',
  valor: centavos(valor),
  ...extra,
});

const regra = {
  categoria: 'etica_marca' as const,
  natureza: 'regra' as const,
  chave: 'etica_marca.nao_citar_concorrente',
  titulo: 'Não citar concorrente',
  texto: 'Nunca citar marcas concorrentes.',
};

const doAgente = (extra: Record<string, unknown> = {}) => ({
  agenteId: 'agente-a',
  execucaoId: 'exec-1',
  idempotencyKey: 'chave-1',
  categoria: 'processo' as const,
  natureza: 'decisao' as const,
  titulo: 'Ajuste combinado',
  ...extra,
});

describe('regrasService.registrar', () => {
  it('admin registra limite vigente, marca sem confirmação, audita sem conteúdo e agenda o Brain', async () => {
    const { servico, insercoes, auditoria, agendados } = montar();
    const resultado = await servico.registrar(como('admin'), limite(), ator);
    assert.equal(resultado.ok, true);
    if (!resultado.ok) return;
    assert.equal(resultado.value.status, 'vigente');
    assert.equal(resultado.value.origem, 'agencia');
    assert.equal(resultado.value.titulo, TETO_MENSAL.nome);
    assert.equal(insercoes[0]?.semConfirmacaoDoAnunciante, true);
    assert.equal(insercoes[0]?.definicaoVersao, 1);
    assert.equal(auditoria[0]?.action, 'client.rule.registered');
    assert.equal(auditoria[0]?.requestId, 'req-1');
    assert.equal(JSON.stringify(auditoria[0]).includes('Nunca citar'), false);
    assert.equal(agendados.length, 1);
  });

  it('com evidência não marca sem confirmação', async () => {
    const { servico, insercoes } = montar();
    await servico.registrar(como('owner'), limite('1000000', { evidencia: 'e-mail de 20/11' }), ator);
    assert.equal(insercoes[0]?.semConfirmacaoDoAnunciante, false);
  });

  it('operator registra regra, mas não limite; viewer não registra nada', async () => {
    const { servico } = montar();
    assert.equal((await servico.registrar(como('operator'), regra, ator)).ok, true);
    const negado = await servico.registrar(como('operator'), limite(), ator);
    assert.equal(!negado.ok && negado.error.code, 'forbidden');
    const viewer = await servico.registrar(como('viewer'), regra, ator);
    assert.equal(!viewer.ok && viewer.error.code, 'forbidden');
  });

  it('rejeita origem no corpo, valor fora da faixa e chave desconhecida', async () => {
    const { servico } = montar();
    const comOrigem = await servico.registrar(como('admin'), { ...regra, origem: 'agente' } as never, ator);
    assert.equal(!comOrigem.ok && comOrigem.error.code, 'validation');
    const acima = await servico.registrar(como('admin'), limite('999999999999'), ator);
    assert.equal(!acima.ok && acima.error.code, 'validation');
    const desconhecida = await servico.registrar(como('admin'), limite('1', { chave: 'investimento.outro' }), ator);
    assert.equal(!desconhecida.ok && desconhecida.error.code, 'validation');
  });

  it('já existindo vigente na chave devolve conflito, e conflito do banco vira "alguém alterou antes"', async () => {
    const { servico } = montar();
    await servico.registrar(como('admin'), limite(), ator);
    const repetido = await servico.registrar(como('admin'), limite('2000000'), ator);
    assert.equal(!repetido.ok && repetido.error.code, 'conflict');

    const concorrente = montar({ falharInsercao: { ok: false, motivo: 'conflito', restricao: null } });
    const falha = await concorrente.servico.registrar(como('admin'), regra, ator);
    assert.equal(!falha.ok && falha.error.code, 'conflict');
    assert.equal(concorrente.auditoria.length, 0);
  });

  it('cliente fora do recorte devolve not_found', async () => {
    const { servico } = montar({ clienteVisivel: false });
    const resultado = await servico.registrar(como('admin'), regra, ator);
    assert.equal(!resultado.ok && resultado.error.code, 'not_found');
  });

  it('falha de auditoria não derruba o fluxo', async () => {
    const { servico } = montar({ falharAuditoria: true });
    assert.equal((await servico.registrar(como('admin'), regra, ator)).ok, true);
  });
});

describe('regrasService.superar', () => {
  it('exige motivo para limite e supera marcando aumento sem evidência', async () => {
    const { servico, decisoes, insercoes, auditoria } = montar();
    const criada = await servico.registrar(como('admin'), limite('1000000', { evidencia: 'contrato' }), ator);
    assert.equal(criada.ok, true);
    if (!criada.ok) return;

    const semMotivo = await servico.superar(como('admin'), { decisaoId: criada.value.id, valor: centavos('2000000') }, ator);
    assert.equal(!semMotivo.ok && semMotivo.error.code, 'validation');

    const aumento = await servico.superar(
      como('admin'),
      { decisaoId: criada.value.id, valor: centavos('2000000'), motivo: 'Verba ampliada' },
      ator,
    );
    assert.equal(aumento.ok, true);
    assert.equal(insercoes[1]?.supersedesId, criada.value.id);
    assert.equal(insercoes[1]?.semConfirmacaoDoAnunciante, true);
    assert.equal(decisoes.find((d) => d.id === criada.value.id)?.status, 'superada');
    assert.equal(auditoria.at(-1)?.action, 'client.rule.superseded');

    if (!aumento.ok) return;
    const reducao = await servico.superar(
      como('admin'),
      { decisaoId: aumento.value.id, valor: centavos('500000'), motivo: 'Corte de verba' },
      ator,
    );
    assert.equal(reducao.ok, true);
    assert.equal(insercoes[2]?.semConfirmacaoDoAnunciante, false);
  });

  it('operator não supera limite; supera regra herdando chave e escopo', async () => {
    const { servico, insercoes } = montar();
    const limiteCriado = await servico.registrar(como('admin'), limite(), ator);
    const regraCriada = await servico.registrar(como('operator'), regra, ator);
    if (!limiteCriado.ok || !regraCriada.ok) throw new Error('preparo');

    const negado = await servico.superar(
      como('operator'),
      { decisaoId: limiteCriado.value.id, valor: centavos('1'), motivo: 'teste' },
      ator,
    );
    assert.equal(!negado.ok && negado.error.code, 'forbidden');

    const ok = await servico.superar(como('operator'), { decisaoId: regraCriada.value.id, texto: 'Nova redação.' }, ator);
    assert.equal(ok.ok, true);
    assert.equal(insercoes.at(-1)?.chave, regra.chave);
    assert.equal(insercoes.at(-1)?.escopo, 'cliente');
  });

  it('decisão inexistente, já superada e concorrência viram not_found e conflict', async () => {
    const { servico } = montar();
    const inexistente = await servico.superar(como('admin'), { decisaoId: '99999999-9999-4999-8999-999999999999', texto: 'x' }, ator);
    assert.equal(!inexistente.ok && inexistente.error.code, 'not_found');

    const criada = await servico.registrar(como('admin'), regra, ator);
    if (!criada.ok) throw new Error('preparo');
    await servico.superar(como('admin'), { decisaoId: criada.value.id, texto: 'v2' }, ator);
    const jaSuperada = await servico.superar(como('admin'), { decisaoId: criada.value.id, texto: 'v3' }, ator);
    assert.equal(!jaSuperada.ok && jaSuperada.error.code, 'conflict');

    const corrida = montar();
    const base = await corrida.servico.registrar(como('admin'), regra, ator);
    if (!base.ok) throw new Error('preparo');
    const racing = montar({ falharInsercao: { ok: false, motivo: 'conflito', restricao: null } });
    racing.decisoes.push(base.value);
    const perdeu = await racing.servico.superar(como('admin'), { decisaoId: base.value.id, texto: 'v2' }, ator);
    assert.equal(!perdeu.ok && perdeu.error.code, 'conflict');
  });
});

describe('regrasService.revogar e propostas', () => {
  it('revogar exige motivo e respeita papel', async () => {
    const { servico, eventos, auditoria } = montar();
    const criada = await servico.registrar(como('operator'), regra, ator);
    if (!criada.ok) throw new Error('preparo');

    const semMotivo = await servico.revogar(como('operator'), { decisaoId: criada.value.id, motivo: ' ' }, ator);
    assert.equal(!semMotivo.ok && semMotivo.error.code, 'validation');

    const revogada = await servico.revogar(como('operator'), { decisaoId: criada.value.id, motivo: 'Cliente mudou' }, ator);
    assert.equal(revogada.ok, true);
    assert.equal(eventos[0]?.tipo, 'revogada');
    assert.equal(auditoria.at(-1)?.action, 'client.rule.revoked');
    assert.equal(JSON.stringify(auditoria.at(-1)).includes('Cliente mudou'), false);

    const denovo = await servico.revogar(como('operator'), { decisaoId: criada.value.id, motivo: 'de novo' }, ator);
    assert.equal(!denovo.ok && denovo.error.code, 'conflict');

    const limiteCriado = await servico.registrar(como('admin'), limite(), ator);
    if (!limiteCriado.ok) throw new Error('preparo');
    const negado = await servico.revogar(como('operator'), { decisaoId: limiteCriado.value.id, motivo: 'tentativa' }, ator);
    assert.equal(!negado.ok && negado.error.code, 'forbidden');
  });

  it('proposta de agente: operator não efetiva limite, admin efetiva, operator rejeita regra', async () => {
    const { servico, auditoria } = montar();
    const proposta = await servico.registrarPorAgente(escopo, doAgente({ ...limite(), categoria: 'investimento', natureza: 'limite', titulo: undefined }));
    assert.equal(proposta.ok, true);
    if (!proposta.ok) return;
    assert.equal(proposta.value.decisao.status, 'proposta');

    const negado = await servico.efetivarProposta(como('operator'), { decisaoId: proposta.value.decisao.id }, ator);
    assert.equal(!negado.ok && negado.error.code, 'forbidden');

    const efetivada = await servico.efetivarProposta(como('admin'), { decisaoId: proposta.value.decisao.id }, ator);
    assert.equal(efetivada.ok && efetivada.value.status, 'vigente');
    assert.equal(auditoria.at(-1)?.action, 'client.rule.proposal_accepted');

    const outra = await servico.registrarPorAgente(
      escopo,
      doAgente({ idempotencyKey: 'chave-2', categoria: 'etica_marca', natureza: 'regra', chave: 'etica_marca.tom', texto: 'Tom formal.', titulo: 'Tom' }),
    );
    if (!outra.ok) throw new Error('preparo');
    const rejeitada = await servico.rejeitarProposta(como('operator'), { decisaoId: outra.value.decisao.id, motivo: 'Não vale' }, ator);
    assert.equal(rejeitada.ok && rejeitada.value.status, 'rejeitada');
    assert.equal(auditoria.at(-1)?.action, 'client.rule.proposal_rejected');

    const jaDecidida = await servico.efetivarProposta(como('admin'), { decisaoId: outra.value.decisao.id }, ator);
    assert.equal(!jaDecidida.ok && jaDecidida.error.code, 'conflict');
  });
});

describe('regrasService.superar com vigência futura', () => {
  it('recusa alterar com início futuro (a anterior ficaria sem valer até a data) e aceita hoje ou passado', async () => {
    const { servico, insercoes } = montar();
    const criada = await servico.registrar(como('admin'), regra, ator);
    if (!criada.ok) throw new Error('preparo');
    const futura = await servico.superar(como('admin'), { decisaoId: criada.value.id, texto: 'v2', vigenciaInicio: '2026-12-01' }, ator);
    assert.equal(!futura.ok && futura.error.code, 'validation');
    assert.equal(!futura.ok && Boolean(futura.error.details?.['vigenciaInicio']), true);
    assert.equal(insercoes.length, 1);
    const hoje = await servico.superar(como('admin'), { decisaoId: criada.value.id, texto: 'v2', vigenciaInicio: '2026-11-24' }, ator);
    assert.equal(hoje.ok, true);
  });

  it('registro novo sem supersessão continua aceitando início futuro', async () => {
    const { servico } = montar();
    assert.equal((await servico.registrar(como('admin'), { ...regra, vigenciaInicio: '2027-01-01' }, ator)).ok, true);
  });

  it('agente não propõe alteração com início futuro', async () => {
    const { servico } = montar();
    await servico.registrar(como('admin'), limite(), ator);
    const r = await servico.registrarPorAgente(
      escopo,
      doAgente({ idempotencyKey: 'fut', categoria: 'investimento', natureza: 'limite', chave: TETO_MENSAL.key, valor: centavos('10'), vigenciaInicio: '2027-01-01' }),
    );
    assert.equal(!r.ok && r.error.code, 'validation');
  });
});

describe('regrasService.efetivarProposta revalida', () => {
  const propostaDeLimite = async (m: ReturnType<typeof montar>, valor: string, extra: Record<string, unknown> = {}) => {
    const r = await m.servico.registrarPorAgente(
      escopo,
      doAgente({ idempotencyKey: `p-${valor}-${m.insercoes.length}`, categoria: 'investimento', natureza: 'limite', chave: TETO_MENSAL.key, valor: centavos(valor), titulo: undefined, ...extra }),
    );
    if (!r.ok) throw new Error(`preparo: ${r.error.message}`);
    return r.value.decisao;
  };

  it('proposta que afrouxa o limite vigente sem evidência exige motivo, que vai para o evento', async () => {
    const m = montar();
    await m.servico.registrar(como('admin'), limite('1000000', { evidencia: 'contrato' }), ator);
    const proposta = await propostaDeLimite(m, '2000000');
    const semMotivo = await m.servico.efetivarProposta(como('admin'), { decisaoId: proposta.id }, ator);
    assert.equal(!semMotivo.ok && semMotivo.error.code, 'validation');
    assert.equal(!semMotivo.ok && Boolean(semMotivo.error.details?.['motivo']), true);
    assert.equal(m.eventos.length, 0);

    const comMotivo = await m.servico.efetivarProposta(como('admin'), { decisaoId: proposta.id, motivo: 'Cliente aprovou por telefone' }, ator);
    assert.equal(comMotivo.ok && comMotivo.value.status, 'vigente');
    assert.equal(m.eventos.at(-1)?.motivo, 'Cliente aprovou por telefone');
    assert.equal((m.auditoria.at(-1)?.metadata as Record<string, unknown>)['flexibilizaSemEvidencia'], true);
  });

  it('proposta que aperta o limite, ou que tem evidência, não exige motivo', async () => {
    const m = montar();
    await m.servico.registrar(como('admin'), limite('1000000'), ator);
    const aperta = await propostaDeLimite(m, '500000');
    assert.equal((await m.servico.efetivarProposta(como('admin'), { decisaoId: aperta.id }, ator)).ok, true);
    const comEvidencia = await propostaDeLimite(m, '9000000', { evidencia: 'e-mail do anunciante' });
    assert.equal((await m.servico.efetivarProposta(como('admin'), { decisaoId: comEvidencia.id }, ator)).ok, true);
  });

  it('recusa efetivar se a definição foi desativada ou se a vigência da proposta venceu', async () => {
    const m = montar();
    const desativavel = await propostaDeLimite(m, '100');
    m.definicoes.splice(0, 1, { ...TETO_MENSAL, ativo: false });
    const desativada = await m.servico.efetivarProposta(como('admin'), { decisaoId: desativavel.id }, ator);
    assert.equal(!desativada.ok && desativada.error.code, 'validation');
    m.definicoes.splice(0, 1, TETO_MENSAL);

    const vencida = await propostaDeLimite(m, '200');
    const indice = m.decisoes.findIndex((d) => d.id === vencida.id);
    m.decisoes[indice] = { ...m.decisoes[indice]!, vigenciaFim: new Date('2026-11-01T00:00:00.000Z') };
    const r = await m.servico.efetivarProposta(como('admin'), { decisaoId: vencida.id }, ator);
    assert.equal(!r.ok && r.error.code, 'validation');
    assert.equal(m.eventos.length, 0);
  });
});

describe('regrasService.registrarPorAgente', () => {
  it('decisão de processo nasce vigente com origem agente; auditoria do agente', async () => {
    const { servico, insercoes, auditoria, agendados } = montar();
    const resultado = await servico.registrarPorAgente(escopo, doAgente({ hashDoConjuntoLido: 'a'.repeat(64) }), {
      requestId: 'req-agente',
    });
    assert.equal(resultado.ok && resultado.value.decisao.status, 'vigente');
    assert.equal(resultado.ok && resultado.value.decisao.origem, 'agente');
    assert.equal(insercoes[0]?.agentSetHash, 'a'.repeat(64));
    assert.equal(insercoes[0]?.agentRunId, 'exec-1');
    assert.equal(auditoria[0]?.actorType, 'agent');
    assert.equal(auditoria[0]?.requestId, 'req-agente');
    assert.equal(agendados.length, 1);
  });

  it('recusa decisão fora de processo e origem no corpo', async () => {
    const { servico } = montar();
    const recusada = await servico.registrarPorAgente(escopo, doAgente({ categoria: 'publico' }));
    assert.equal(!recusada.ok && recusada.error.code, 'forbidden');
    const comOrigem = await servico.registrarPorAgente(escopo, doAgente({ origem: 'agencia' }) as never);
    assert.equal(!comOrigem.ok && comOrigem.error.code, 'validation');
  });

  it('limite e regra do agente só como proposta, ligadas ao vigente que substituiriam', async () => {
    const { servico, insercoes, agendados } = montar();
    const base = await servico.registrar(como('admin'), limite(), ator);
    if (!base.ok) throw new Error('preparo');
    agendados.length = 0;
    const proposta = await servico.registrarPorAgente(
      escopo,
      doAgente({ idempotencyKey: 'k-limite', categoria: 'investimento', natureza: 'limite', chave: TETO_MENSAL.key, valor: centavos('3000000') }),
    );
    assert.equal(proposta.ok && proposta.value.decisao.status, 'proposta');
    assert.equal(insercoes.at(-1)?.supersedesId, base.value.id);
    assert.equal(agendados.length, 0);
  });

  it('é idempotente: a mesma chave devolve a decisão existente sem inserir de novo', async () => {
    const { servico, insercoes } = montar();
    const primeira = await servico.registrarPorAgente(escopo, doAgente());
    const segunda = await servico.registrarPorAgente(escopo, doAgente({ titulo: 'Outro título' }));
    assert.equal(primeira.ok && !primeira.value.repetida, true);
    assert.equal(segunda.ok && segunda.value.repetida, true);
    assert.equal(segunda.ok && primeira.ok && segunda.value.decisao.id === primeira.value.decisao.id, true);
    assert.equal(insercoes.length, 1);
  });

  it('respeita os tetos por execução e por cliente por dia, e devolve rate_limited', async () => {
    const porExecucao = montar({ contagem: { naExecucao: 2, noPeriodo: 2 }, tetoPorExecucao: 2 });
    const a = await porExecucao.servico.registrarPorAgente(escopo, doAgente());
    assert.equal(!a.ok && a.error.code, 'rate_limited');

    const porDia = montar({ contagem: { naExecucao: 0, noPeriodo: 5 }, tetoPorClientePorDia: 5 });
    const b = await porDia.servico.registrarPorAgente(escopo, doAgente());
    assert.equal(!b.ok && b.error.code, 'rate_limited');

    const padrao = montar({ contagem: { naExecucao: 49, noPeriodo: 199 } });
    assert.equal((await padrao.servico.registrarPorAgente(escopo, doAgente())).ok, true);
    const estourou = montar({ contagem: { naExecucao: 50, noPeriodo: 0 } });
    const c = await estourou.servico.registrarPorAgente(escopo, doAgente());
    assert.equal(!c.ok && c.error.code, 'rate_limited');
  });

  it('repassa os tetos ao banco e traduz o teto imposto pelo gatilho em rate_limited', async () => {
    const m = montar({ tetoPorExecucao: 7, tetoPorClientePorDia: 9 });
    await m.servico.registrarPorAgente(escopo, doAgente());
    assert.deepEqual(m.tetosRecebidos[0], { porExecucao: 7, porDia: 9 });
    for (const teto of ['execucao', 'dia'] as const) {
      const barrado = montar({ falharInsercao: { ok: false, motivo: 'teto', teto } });
      const r = await barrado.servico.registrarPorAgente(escopo, doAgente());
      assert.equal(!r.ok && r.error.code, 'rate_limited', teto);
      assert.equal(barrado.auditoria.length, 0);
    }
  });

  it('corrida de idempotência no banco devolve a decisão do concorrente', async () => {
    const { servico, decisoes } = montar();
    const primeira = await servico.registrarPorAgente(escopo, doAgente());
    if (!primeira.ok) throw new Error('preparo');
    decisoes.length = 0;
    const concorrente = montar({
      falharInsercao: { ok: false, motivo: 'conflito', restricao: 'client_decisions_idempotencia' },
    });
    const resultado = await concorrente.servico.registrarPorAgente(escopo, doAgente({ idempotencyKey: 'outra' }));
    assert.equal(!resultado.ok && resultado.error.code, 'conflict');
  });
});

describe('regrasService leituras', () => {
  it('viewer lê vigentes e o conjunto para agente traz hash estável e definições', async () => {
    const { servico } = montar();
    await servico.registrar(como('admin'), limite(), ator);
    const vigentes = await servico.listarVigentes(escopo);
    assert.equal(vigentes.ok && vigentes.value.decisoes.length, 1);

    const a = await servico.conjuntoParaAgente(escopo);
    const b = await servico.conjuntoParaAgente(escopo);
    assert.equal(a.ok && b.ok && a.value.hash === b.value.hash, true);
    assert.equal(a.ok && a.value.definicoes.length, 1);
  });

  it('filtro inválido na linha do tempo é validation e cliente invisível é not_found', async () => {
    const { servico } = montar();
    const invalido = await servico.linhaDoTempo(escopo, { status: 'qualquer' } as never);
    assert.equal(!invalido.ok && invalido.error.code, 'validation');
    const invisivel = montar({ clienteVisivel: false });
    const resultado = await invisivel.servico.listarVigentes(escopo);
    assert.equal(!resultado.ok && resultado.error.code, 'not_found');
  });
});
