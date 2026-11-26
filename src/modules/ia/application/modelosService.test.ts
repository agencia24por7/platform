import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../../brain/testes/ganchos.ts');
const { createModelosService } = await import('./modelosService.ts');
const { CONFIGURACAO_PADRAO, bloqueioDoDia, modelosDeTexto, aadDaChave, estadoDaTarefa } = await import('../domain/modelos.ts');
const { ok, err } = await import('../../../shared/result/result.ts');
const { failure } = await import('../../../shared/result/failure.ts');

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA_ORG = '44444444-4444-4444-8444-444444444444';
const ATOR = { userId: '55555555-5555-4555-8555-555555555555', requestId: 'req-12345678', sourceIp: null };
const CHAVE = 'chave-real-do-fornecedor-0123456789';
const TAREFA = 'teste_de_modelo';

type Linha = { bytes: Buffer; versaoDaChave: string; rotulo: string; modelos: readonly string[] };

function montar(opcoes: { catalogo?: unknown; cofreFora?: boolean; fornecedores?: readonly string[] } = {}) {
  const chaves = new Map<string, Linha>();
  const escolhas = new Map<string, { tarefa: string; fornecedor: string; modelo: string }>();
  const configuracoes = new Map<string, typeof CONFIGURACAO_PADRAO>();
  const eventos: Record<string, unknown>[] = [];
  const avisos: Record<string, unknown>[] = [];
  const estado = { versao: 'v1', listagens: 0 };
  const id = (org: string, fornecedor: string) => `${org}|${fornecedor}`;

  const repositorio = {
    async chaves(org: string) {
      return [...chaves.entries()].filter(([k]) => k.startsWith(`${org}|`)).map(([k, v]) => ({ fornecedor: k.split('|')[1], rotulo: v.rotulo, modelos: v.modelos, modelosListadosEm: new Date(), atualizadaEm: new Date() }));
    },
    async selada(org: string, fornecedor: string) {
      const linha = chaves.get(id(org, fornecedor));
      return linha ? { bytes: linha.bytes, versaoDaChave: linha.versaoDaChave } : null;
    },
    async guardarChave(nova: { organizationId: string; fornecedor: string; selado: { bytes: Buffer; versaoDaChave: string }; rotulo: string; modelos: readonly string[] }) {
      chaves.set(id(nova.organizationId, nova.fornecedor), { bytes: nova.selado.bytes, versaoDaChave: nova.selado.versaoDaChave, rotulo: nova.rotulo, modelos: nova.modelos });
    },
    async atualizarModelos(org: string, fornecedor: string, modelos: readonly string[]) {
      const linha = chaves.get(id(org, fornecedor));
      if (linha) chaves.set(id(org, fornecedor), { ...linha, modelos });
    },
    async removerChave(org: string, fornecedor: string) {
      for (const [tarefa, escolha] of escolhas) if (tarefa.startsWith(`${org}|`) && escolha.fornecedor === fornecedor) escolhas.delete(tarefa);
      return chaves.delete(id(org, fornecedor));
    },
    async regravarChave(org: string, fornecedor: string, selado: { bytes: Buffer; versaoDaChave: string }, lida: { bytes: Buffer; versaoDaChave: string }) {
      const linha = chaves.get(id(org, fornecedor));
      if (!linha || linha.versaoDaChave !== lida.versaoDaChave || !linha.bytes.equals(lida.bytes)) return false;
      chaves.set(id(org, fornecedor), { ...linha, bytes: selado.bytes, versaoDaChave: selado.versaoDaChave });
      return true;
    },
    async comVersaoAntiga(versao: string, limite: number) {
      return [...chaves.entries()].filter(([, v]) => v.versaoDaChave !== versao).slice(0, limite).map(([k]) => ({ organizationId: k.split('|')[0]!, fornecedor: k.split('|')[1]! }));
    },
    async escolhas(org: string) { return [...escolhas.entries()].filter(([k]) => k.startsWith(`${org}|`)).map(([, v]) => v); },
    async escolher(org: string, escolha: { tarefa: string; fornecedor: string; modelo: string }) { escolhas.set(`${org}|${escolha.tarefa}`, escolha); },
    async configuracao(org: string) { return configuracoes.get(org) ?? CONFIGURACAO_PADRAO; },
    async salvarConfiguracao(org: string, configuracao: typeof CONFIGURACAO_PADRAO) { configuracoes.set(org, configuracao); },
    async usoDeHoje() { return { chamadas: 3, tokens: 1200 }; },
    async reservar() { return { id: '1' }; },
    async concluir() {},
  };

  const selador = {
    async selar(texto: string, aad: Buffer) {
      if (opcoes.cofreFora) throw new Error('KMS fora');
      return { bytes: Buffer.from(`${estado.versao}#${aad.toString('utf8')}#${texto}`, 'utf8'), versaoDaChave: estado.versao, algoritmo: 'aes-256-gcm+local' };
    },
    async abrir(bytes: Buffer, aad: Buffer) {
      const [, aadGravado, texto] = bytes.toString('utf8').split('#');
      if (aadGravado !== aad.toString('utf8')) throw new Error('aad não confere');
      return texto!;
    },
  };

  const catalogo = (opcoes.catalogo ?? {
    async listar(_fornecedor: string, chave: string) {
      estado.listagens += 1;
      return chave === CHAVE ? ok(['modelo-b', 'modelo-a', 'text-embedding-x', 'modelo-a']) : err(failure('validation', 'O fornecedor recusou essa chave.'));
    },
  }) as never;

  const servico = createModelosService({
    repositorio: repositorio as never,
    selador,
    catalogo,
    audit: { record: async (e: Record<string, unknown>) => { eventos.push(e); }, list: async () => [], search: async () => [] } as never,
    fornecedores: (opcoes.fornecedores ?? ['google', 'anthropic']) as never,
    tarefas: [{ chave: TAREFA, titulo: 'Teste', classe: 'rapido_e_barato' }],
    avisar: (evento, dados) => { avisos.push({ evento, ...dados }); },
  });
  return { servico, chaves, escolhas, eventos, avisos, estado, id };
}

const admin = { organizationId: ORG, papelDeQuemAge: 'admin' as const };
const dono = { organizationId: ORG, papelDeQuemAge: 'owner' as const };

describe('chave de fornecedor de IA (ADR 0058)', () => {
  it('testa a chave no fornecedor, sela e guarda só o selado, o rótulo e os modelos de texto', async () => {
    const { servico, chaves, eventos, id } = montar();
    const r = await servico.guardarChave(admin, 'google', `  ${CHAVE}  `, ATOR);
    assert.ok(r.ok);
    const linha = chaves.get(id(ORG, 'google'))!;
    assert.deepEqual(linha.modelos, ['modelo-a', 'modelo-b']);
    assert.equal(linha.rotulo, '••••6789');
    assert.equal(JSON.stringify(r).includes(CHAVE), false);
    assert.equal(JSON.stringify(eventos).includes(CHAVE), false);
    assert.deepEqual(eventos[0]!.metadata, { fornecedor: 'google', modelos: 2 });
  });

  it('chave recusada pelo fornecedor, malformada ou de fornecedor não habilitado não é guardada', async () => {
    const { servico, chaves } = montar();
    const casos: [string, string][] = [['google', 'chave-errada-mas-comprida-0123456789'], ['google', 'curta'], ['google', 'com espaco no meio da chave 0123'], ['moonshot', CHAVE], ['inexistente', CHAVE]];
    for (const [fornecedor, chave] of casos) {
      const r = await servico.guardarChave(admin, fornecedor, chave, ATOR);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error.code, 'validation');
    }
    assert.equal(chaves.size, 0);
  });

  it('cofre fora do ar não guarda nada e não vaza o motivo', async () => {
    const { servico, chaves, avisos } = montar({ cofreFora: true });
    const r = await servico.guardarChave(admin, 'google', CHAVE, ATOR);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, 'unavailable');
    assert.equal(chaves.size, 0);
    assert.equal(JSON.stringify(avisos).includes(CHAVE), false);
  });

  it('operador e leitor não veem o painel nem mexem em chave, modelo ou botão de desligar', async () => {
    for (const papel of ['operator', 'viewer'] as const) {
      const { servico, chaves } = montar();
      const quem = { organizationId: ORG, papelDeQuemAge: papel };
      const tentativas = [
        await servico.painel(quem),
        await servico.guardarChave(quem, 'google', CHAVE, ATOR),
        await servico.removerChave(quem, 'google', ATOR),
        await servico.atualizarModelos(quem, 'google', ATOR),
        await servico.escolherModelo(quem, TAREFA, 'google', 'modelo-a', ATOR),
        await servico.ligarOuDesligar(quem, false, ATOR),
        await servico.definirTetos(quem, { chamadasPorDia: 5, tokensPorDia: 5000 }, ATOR),
      ];
      for (const r of tentativas) {
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.error.code, 'forbidden');
      }
      assert.equal(chaves.size, 0);
    }
  });

  it('só quem responde pela organização muda os tetos, e só dentro do intervalo', async () => {
    const { servico } = montar();
    const doAdmin = await servico.definirTetos(admin, { chamadasPorDia: 5, tokensPorDia: 5000 }, ATOR);
    assert.equal(!doAdmin.ok && doAdmin.error.code, 'forbidden');
    for (const ruim of [{ chamadasPorDia: 0, tokensPorDia: 5000 }, { chamadasPorDia: 5, tokensPorDia: 10 }, { chamadasPorDia: 5 }, 'x']) {
      const r = await servico.definirTetos(dono, ruim, ATOR);
      assert.equal(!r.ok && r.error.code, 'validation');
    }
    assert.ok((await servico.definirTetos(dono, { chamadasPorDia: 5, tokensPorDia: 5000 }, ATOR)).ok);
    const painel = await servico.painel(dono);
    assert.ok(painel.ok);
    if (painel.ok) assert.deepEqual(painel.value.configuracao, { ligada: true, chamadasPorDia: 5, tokensPorDia: 5000 });
  });

  it('desligar preserva os tetos', async () => {
    const { servico } = montar();
    await servico.definirTetos(dono, { chamadasPorDia: 7, tokensPorDia: 7000 }, ATOR);
    await servico.ligarOuDesligar(admin, false, ATOR);
    const painel = await servico.painel(admin);
    if (painel.ok) assert.deepEqual(painel.value.configuracao, { ligada: false, chamadasPorDia: 7, tokensPorDia: 7000 });
  });
});

describe('modelo por tarefa (ADR 0057 §2)', () => {
  it('só aceita tarefa registrada, fornecedor com chave e modelo da lista que a chave alcança', async () => {
    const { servico, escolhas } = montar();
    assert.equal((await servico.escolherModelo(admin, TAREFA, 'google', 'modelo-a', ATOR)).ok, false);
    await servico.guardarChave(admin, 'google', CHAVE, ATOR);
    for (const [tarefa, fornecedor, modelo] of [['tarefa_inexistente', 'google', 'modelo-a'], [TAREFA, 'anthropic', 'modelo-a'], [TAREFA, 'google', 'modelo-fora-da-lista'], [TAREFA, 'google', 'modelo com espaço']]) {
      assert.equal((await servico.escolherModelo(admin, tarefa!, fornecedor!, modelo!, ATOR)).ok, false);
    }
    assert.equal(escolhas.size, 0);
    assert.ok((await servico.escolherModelo(admin, TAREFA, 'google', 'modelo-a', ATOR)).ok);
    const painel = await servico.painel(admin);
    if (painel.ok) assert.deepEqual(painel.value.tarefas.map((t) => [t.chave, t.estado, t.escolha?.modelo]), [[TAREFA, 'configurada', 'modelo-a']]);
  });

  it('modelo que sai da lista marca a tarefa como indisponível, sem trocar sozinho', () => {
    const chave = { fornecedor: 'google' as const, rotulo: 'x', modelos: ['modelo-b'], modelosListadosEm: null, atualizadaEm: new Date() };
    const escolha = { tarefa: TAREFA, fornecedor: 'google' as const, modelo: 'modelo-a' };
    assert.equal(estadoDaTarefa(escolha, [chave]), 'modelo_indisponivel');
    assert.equal(estadoDaTarefa(escolha, []), 'modelo_indisponivel');
    assert.equal(estadoDaTarefa(undefined, [chave]), 'sem_modelo');
    assert.equal(estadoDaTarefa({ ...escolha, modelo: 'modelo-b' }, [chave]), 'configurada');
  });

  it('resolver: sem escolha bloqueia; com escolha devolve o modelo e só abre a chave quando pedido', async () => {
    const { servico } = montar();
    const sem = await servico.resolver(ORG, TAREFA);
    assert.equal(!sem.ok && sem.error.code, 'unavailable');
    await servico.guardarChave(admin, 'google', CHAVE, ATOR);
    await servico.escolherModelo(admin, TAREFA, 'google', 'modelo-a', ATOR);
    const com = await servico.resolver(ORG, TAREFA);
    assert.ok(com.ok);
    if (!com.ok) return;
    assert.deepEqual([com.value.fornecedor, com.value.modelo], ['google', 'modelo-a']);
    assert.equal(JSON.stringify(com.value).includes(CHAVE), false);
    assert.deepEqual(await com.value.abrirChave(), { ok: true, value: CHAVE });
    assert.equal((await servico.resolver(OUTRA_ORG, TAREFA)).ok, false);
  });

  it('remover a chave bloqueia as tarefas que dependiam dela', async () => {
    const { servico } = montar();
    await servico.guardarChave(admin, 'google', CHAVE, ATOR);
    await servico.escolherModelo(admin, TAREFA, 'google', 'modelo-a', ATOR);
    assert.ok((await servico.removerChave(admin, 'google', ATOR)).ok);
    assert.equal((await servico.resolver(ORG, TAREFA)).ok, false);
    assert.equal((await servico.removerChave(admin, 'google', ATOR)).ok, false);
  });

  it('selado de uma organização não abre em outra: o contexto de cifra amarra organização e fornecedor', async () => {
    const { servico, chaves, id, avisos } = montar();
    await servico.guardarChave(admin, 'google', CHAVE, ATOR);
    chaves.set(id(OUTRA_ORG, 'google'), chaves.get(id(ORG, 'google'))!);
    const r = await servico.atualizarModelos({ organizationId: OUTRA_ORG, papelDeQuemAge: 'owner' }, 'google', ATOR);
    assert.equal(!r.ok && r.error.code, 'unavailable');
    assert.equal(avisos[0]!.evento, 'ia.chave.ilegivel');
    assert.notDeepEqual(aadDaChave(ORG, 'google'), aadDaChave(OUTRA_ORG, 'google'));
    assert.notDeepEqual(aadDaChave(ORG, 'google'), aadDaChave(ORG, 'anthropic'));
  });
});

describe('recifragem das chaves de IA depois da rotação do KMS (ADR 0058)', () => {
  it('recifra o que está em versão antiga e a chave continua abrindo', async () => {
    const { servico, chaves, estado, id } = montar();
    await servico.guardarChave(admin, 'google', CHAVE, ATOR);
    await servico.guardarChave(admin, 'anthropic', CHAVE, ATOR);
    assert.deepEqual(await servico.recifrar('v1', 50), { avaliadas: 0, recifradas: 0, falhas: 0 });
    estado.versao = 'v2';
    assert.deepEqual(await servico.recifrar('v2', 50), { avaliadas: 2, recifradas: 2, falhas: 0 });
    assert.equal(chaves.get(id(ORG, 'google'))!.versaoDaChave, 'v2');
    assert.deepEqual(await servico.recifrar('v2', 50), { avaliadas: 0, recifradas: 0, falhas: 0 });
    await servico.escolherModelo(admin, TAREFA, 'google', 'modelo-a', ATOR);
    const resolvido = await servico.resolver(ORG, TAREFA);
    if (resolvido.ok) assert.deepEqual(await resolvido.value.abrirChave(), { ok: true, value: CHAVE });
  });

  it('chave que não abre conta como falha e as outras seguem', async () => {
    const { servico, chaves, estado, id } = montar();
    await servico.guardarChave(admin, 'google', CHAVE, ATOR);
    await servico.guardarChave(admin, 'anthropic', CHAVE, ATOR);
    chaves.set(id(ORG, 'google'), { ...chaves.get(id(ORG, 'google'))!, bytes: Buffer.from('v1#aad-adulterado#x') });
    estado.versao = 'v2';
    assert.deepEqual(await servico.recifrar('v2', 50), { avaliadas: 2, recifradas: 1, falhas: 1 });
  });
});

describe('teto diário e lista de modelos', () => {
  it('bloqueia por desligada, por chamadas e por tokens contando a reserva', () => {
    const config = { ligada: true, chamadasPorDia: 10, tokensPorDia: 1000 };
    assert.equal(bloqueioDoDia({ ...config, ligada: false }, { chamadas: 0, tokens: 0 }, 1), 'desligada');
    assert.equal(bloqueioDoDia(config, { chamadas: 10, tokens: 0 }, 1), 'teto_de_chamadas');
    assert.equal(bloqueioDoDia(config, { chamadas: 9, tokens: 900 }, 101), 'teto_de_tokens');
    assert.equal(bloqueioDoDia(config, { chamadas: 9, tokens: 900 }, 100), null);
  });

  it('lista de modelos: sem repetição, sem modelo que não gera texto, sem id fora do padrão', () => {
    assert.deepEqual(modelosDeTexto(['b', 'a', 'a', 'text-embedding-3', 'whisper-1', 'id com espaço', '<script>', 'gerador/de-texto:1.0']), ['a', 'b', 'gerador/de-texto:1.0']);
  });
});
