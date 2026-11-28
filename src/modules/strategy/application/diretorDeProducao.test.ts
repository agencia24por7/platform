import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import { CLIENTE_ID, ORGANIZACAO_ID, planoCompletoBruto } from '../domain/fixturesDeTeste.ts';
import { pacoteDaProducao, producaoDaBusca, producaoDoSocial } from '../domain/producao/fixturesDaProducao.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createDiretorDeProducao } = await import('@/modules/strategy/application/diretorDeProducao');
const { criarProducaoEmMemoria } = await import('@/modules/strategy/infrastructure/producaoEmMemoria');
const { criarIaFalsa } = await import('@/modules/strategy/infrastructure/ia/iaFalsa');
type Pedido = Parameters<Parameters<typeof criarIaFalsa>[0]>[0];

const PLANO_ID = '44444444-4444-4444-8444-444444444444';
const VERSAO_ID = '55555555-5555-4555-8555-555555555555';

function versao(status = 'vigente', conteudo: unknown = planoCompletoBruto()) {
  return {
    id: VERSAO_ID,
    planoId: PLANO_ID,
    organizationId: ORGANIZACAO_ID,
    clientId: CLIENTE_ID,
    status,
    schemaVersion: 1,
    supersedesId: null,
    autorTipo: 'usuario',
    autorUsuarioId: null,
    agentId: null,
    agentRunId: null,
    redigidaEm: null,
    criadaEm: new Date(),
    conteudo,
    referencias: [],
  } as const;
}

const campanhaDo = (pedido: Pedido) => (pedido.dados as { campanha: { id: string } }).campanha.id;
const respostaCerta = (pedido: Pedido) => (campanhaDo(pedido) === 'cp_busca' ? producaoDaBusca() : producaoDoSocial());

async function montar(opcoes: { roteiro?: Parameters<typeof criarIaFalsa>[0]; status?: string | (() => string); agora?: () => Date; orcamentoTotalMs?: number; brainFora?: boolean; recusarEscrita?: boolean } = {}) {
  const memoria = criarProducaoEmMemoria();
  const repositorio = opcoes.recusarEscrita
    ? { ...memoria, atualizar: async (...args: Parameters<typeof memoria.atualizar>) => (args[3].progresso && Object.keys(args[3].progresso).length > 0 ? ({ ok: false, error: { codigo: 'invalido', mensagem: 'recusado' } } as const) : memoria.atualizar(...args)) }
    : memoria;
  const ia = criarIaFalsa(opcoes.roteiro ?? respostaCerta);
  const statusAtual = () => (typeof opcoes.status === 'function' ? opcoes.status() : opcoes.status);
  const diretor = createDiretorDeProducao({
    repositorio,
    estrategia: { lerVersao: async () => versao(statusAtual()) as never },
    leitorDoBrain: { lerPacote: async () => (opcoes.brainFora ? { ok: false, error: { codigo: 'brain_indisponivel', mensagem: 'fora' } } : { ok: true, value: pacoteDaProducao() }) as never },
    executorDeIA: ia,
    ...(opcoes.agora ? { relogio: { agora: opcoes.agora } } : {}),
    ...(opcoes.orcamentoTotalMs ? { orcamentoTotalMs: opcoes.orcamentoTotalMs } : {}),
  });
  const pedido = await memoria.pedir(ORGANIZACAO_ID, { clientId: CLIENTE_ID, planoId: PLANO_ID, versaoId: VERSAO_ID, agentRunId: 'producao-teste', solicitadoPor: 'u1', requestId: 'r1' });
  assert.ok(pedido.ok);
  return { repositorio: memoria, ia, diretor, id: pedido.value.id };
}

describe('Production Director (motor do plano de produção)', () => {
  it('gera por campanha, confere e grava pronto com as referências do pacote', async () => {
    const { repositorio, ia, diretor, id } = await montar();
    const resumo = await diretor.avancar({ limite: 5 });
    assert.ok(resumo.ok);
    assert.equal(resumo.value.prontas, 1);
    assert.equal(ia.pedidos.length, 2);
    assert.ok(ia.pedidos.every((pedido) => pedido.tarefa === 'diretor_de_producao'));
    const final = repositorio.registros.get(id)!;
    assert.equal(final.status, 'pronto');
    const conteudo = final.conteudo as { campanhas: { campanha_id: string }[]; referencias: { tipo: string; titulo: string }[] };
    assert.deepEqual(conteudo.campanhas.map((c) => c.campanha_id), ['cp_busca', 'cp_social']);
    assert.ok(conteudo.referencias.some((ref) => ref.tipo === 'culture_anti_referencia'));
    assert.deepEqual(final.progresso, {});
  });

  it('o pedido leva só refs curtos do pacote, sem URN nem hash, e as especificações do catálogo', async () => {
    const { ia, diretor } = await montar();
    await diretor.avancar({ limite: 5 });
    const dados = ia.pedidos[0]!.dados as { pacote: Record<string, unknown>[]; especificacoes: string[] | null };
    assert.ok(dados.pacote.length > 0 && dados.pacote.every((entrada) => typeof entrada['ref'] === 'string' && !('urn' in entrada) && !('hash' in entrada)));
    assert.ok(dados.especificacoes?.includes('ad_headlines:textox15<=30c'));
  });

  it('reprovada na conferência, faz uma única correção com os erros e aceita a corrigida', async () => {
    let chamadas = 0;
    const roteiro = (pedido: Pedido) => {
      if (campanhaDo(pedido) !== 'cp_busca') return producaoDoSocial();
      chamadas += 1;
      if (chamadas === 1) {
        const errada = producaoDaBusca();
        errada.entregaveis[0]!.textos[0]!.texto = 'Um título bem maior que trinta caracteres';
        return errada;
      }
      return producaoDaBusca();
    };
    const { repositorio, ia, diretor, id } = await montar({ roteiro });
    await diretor.avancar({ limite: 5 });
    assert.equal(repositorio.registros.get(id)!.status, 'pronto');
    const correcao = ia.pedidos.find((pedido) => 'erros' in (pedido.dados as object))!;
    const erros = (correcao.dados as { erros: { codigo: string }[] }).erros;
    assert.ok(erros.some((erro) => erro.codigo === 'texto_acima_do_limite'));
    assert.ok('respostaAnterior' in (correcao.dados as object));
    assert.equal(ia.pedidos.length, 3);
  });

  it('reprovada de novo depois da correção, falha com motivo compacto sem texto do modelo', async () => {
    const roteiro = (pedido: Pedido) => {
      const resposta = respostaCerta(pedido);
      resposta.entregaveis[0]!.textos = [{ campo: 'ad_headlines', texto: 'TEXTO SECRETO DO MODELO MUITO LONGO AQUI' }];
      return resposta;
    };
    const { repositorio, ia, diretor, id } = await montar({ roteiro });
    await diretor.avancar({ limite: 5 });
    const final = repositorio.registros.get(id)!;
    assert.equal(final.status, 'falhou');
    assert.equal(final.erroCodigo, 'conferencia_reprovada');
    assert.match(final.motivo ?? '', /^[A-Za-z0-9_.:;,=-]{1,240}$/);
    assert.ok(!(final.motivo ?? '').includes('SECRETO'));
    assert.equal(ia.pedidos.length, 2);
  });

  it('IA não configurada falha sem nova tentativa; falha do fornecedor adia e conta a falha', async () => {
    const naoConfigurada = await montar({ roteiro: () => ({ codigo: 'nao_configurada', mensagem: 'sem modelo' }) });
    await naoConfigurada.diretor.avancar({ limite: 5 });
    assert.equal(naoConfigurada.repositorio.registros.get(naoConfigurada.id)!.erroCodigo, 'ia_nao_configurada');

    const fora = await montar({ roteiro: () => ({ codigo: 'falha_do_fornecedor', mensagem: 'fora' }) });
    await fora.diretor.avancar({ limite: 5 });
    const adiada = fora.repositorio.registros.get(fora.id)!;
    assert.equal(adiada.status, 'pendente');
    assert.equal(adiada.falhas, 1);
    assert.equal(adiada.leaseAte, null);
    await fora.diretor.avancar({ limite: 5 });
    await fora.diretor.avancar({ limite: 5 });
    assert.equal(fora.repositorio.registros.get(fora.id)!.erroCodigo, 'ia_falha');
  });

  it('versão que deixou de ser vigente falha sem chamar a IA', async () => {
    const { repositorio, ia, diretor, id } = await montar({ status: 'revogado' });
    await diretor.avancar({ limite: 5 });
    assert.equal(repositorio.registros.get(id)!.erroCodigo, 'plano_fora_do_estado');
    assert.equal(ia.pedidos.length, 0);
  });

  it('versão revogada no meio da geração para antes da próxima campanha', async () => {
    let leituras = 0;
    const { repositorio, ia, diretor, id } = await montar({ status: () => (++leituras <= 2 ? 'vigente' : 'revogado') });
    await diretor.avancar({ limite: 5 });
    assert.equal(repositorio.registros.get(id)!.erroCodigo, 'plano_fora_do_estado');
    assert.equal(ia.pedidos.length, 1);
  });

  it('escrita recusada pelo banco falha como interno, sem repetir a geração', async () => {
    const { repositorio, ia, diretor, id } = await montar({ recusarEscrita: true });
    await diretor.avancar({ limite: 5 });
    const final = repositorio.registros.get(id)!;
    assert.equal(final.status, 'falhou');
    assert.equal(final.motivo, 'escrita_recusada');
    await diretor.avancar({ limite: 5 });
    assert.equal(ia.pedidos.length, 1);
  });

  it('Brain fora do ar adia sem chamar a IA', async () => {
    const { repositorio, ia, diretor, id } = await montar({ brainFora: true });
    await diretor.avancar({ limite: 5 });
    assert.equal(repositorio.registros.get(id)!.status, 'pendente');
    assert.equal(ia.pedidos.length, 0);
  });

  it('sem tempo para outra chamada, grava o progresso e retoma sem pagar de novo a campanha pronta', async () => {
    let agora = 0;
    const roteiro = (pedido: Pedido) => {
      agora += 130_000;
      return respostaCerta(pedido);
    };
    const { repositorio, ia, diretor, id } = await montar({ roteiro, agora: () => new Date(1_800_000_000_000 + agora), orcamentoTotalMs: 240_000 });
    await diretor.avancar({ limite: 5 });
    const parcial = repositorio.registros.get(id)!;
    assert.equal(parcial.status, 'pendente');
    assert.deepEqual(Object.keys(parcial.progresso), ['cp_busca']);
    assert.equal(ia.pedidos.length, 1);
    await diretor.avancar({ limite: 5 });
    assert.equal(repositorio.registros.get(id)!.status, 'pronto');
    assert.deepEqual(ia.pedidos.map(campanhaDo), ['cp_busca', 'cp_social']);
  });
});

describe('tarefa de IA diretor_de_producao', () => {
  it('aparece na Config da IA, na camada, no orçamento e na IA falsa, com raciocínio low e uma chamada', async () => {
    const { DIRETOR_DE_PRODUCAO, TAREFAS_CONFIGURAVEIS } = await import('@/modules/ia/domain/tarefasInternas');
    const { TAREFAS_REGISTRADAS } = await import('@/modules/strategy/infrastructure/ia/iaDaCamada');
    const { ORCAMENTO_DA_IA } = await import('@/modules/strategy/application/motorDoPlano');
    const { INSTRUCAO_DO_DIRETOR_DE_PRODUCAO, REGRAS_COMUNS } = await import('@/modules/strategy/application/instrucoes/index');
    assert.equal(DIRETOR_DE_PRODUCAO.classe, 'raciocinio_forte');
    assert.equal(DIRETOR_DE_PRODUCAO.raciocinio, 'low');
    assert.equal(DIRETOR_DE_PRODUCAO.orcamento.passos, 1);
    assert.equal(DIRETOR_DE_PRODUCAO.ferramentas.length, 0);
    assert.ok(TAREFAS_CONFIGURAVEIS.some((tarefa) => tarefa.chave === 'diretor_de_producao' && tarefa.herdaDe === undefined));
    assert.equal(TAREFAS_REGISTRADAS.get('diretor_de_producao'), DIRETOR_DE_PRODUCAO);
    assert.ok(ORCAMENTO_DA_IA.diretor_de_producao.tokensMaximos <= DIRETOR_DE_PRODUCAO.orcamento.tokensDeSaida);
    assert.ok(INSTRUCAO_DO_DIRETOR_DE_PRODUCAO.includes(REGRAS_COMUNS));
    assert.ok(INSTRUCAO_DO_DIRETOR_DE_PRODUCAO.length < 4000);
  });
});
