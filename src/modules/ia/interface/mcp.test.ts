import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';

await import('../../brain/testes/ganchos.ts');
const { criarRotaMcp } = await import('./rotaMcp.ts');
const { criarManipuladorMcp, CORPO_MAXIMO_DO_MCP } = await import('../infrastructure/servidorMcp.ts');
const { criarRegistro, definirFerramenta, clienteNoEscopo } = await import('../domain/ferramenta.ts');
const { gerarCredencial } = await import('../domain/credencial.ts');
const { ok, err } = await import('../../../shared/result/result.ts');
const { failure } = await import('../../../shared/result/failure.ts');

type Escopo = { credencialId: string; organizationId: string; clienteIds: readonly string[] | null; ferramentas: readonly string[]; requestId: string; sourceIp: string | null };

const ORIGEM_DO_APP = 'https://app.exemplo.test';
const CLIENTE_A = '22222222-2222-4222-8222-222222222222';
const CLIENTE_B = '33333333-3333-4333-8333-333333333333';

function montar(opcoes: { habilitado?: boolean; chamadasPorMinuto?: number } = {}) {
  const execucoes: { entrada: unknown; escopo: Escopo }[] = [];
  const avisos: { evento: string; dados: Record<string, unknown> }[] = [];
  const registro = criarRegistro([
    definirFerramenta({
      nome: 'catalogo_ler',
      descricao: 'Lê o catálogo de um cliente.',
      classe: 'leitura' as const,
      entrada: z.object({ clienteId: z.uuid(), limite: z.number().int().min(1).max(50).default(10) }).strict(),
      async executar(entrada: { clienteId: string; limite: number }, escopo: Escopo) {
        execucoes.push({ entrada, escopo });
        if (!clienteNoEscopo(escopo, entrada.clienteId)) return err(failure('not_found', 'Cliente não encontrado.'));
        return ok({ organizacao: escopo.organizationId, cliente: entrada.clienteId, limite: entrada.limite });
      },
    }),
    definirFerramenta({
      nome: 'outra_ler',
      descricao: 'Outra leitura.',
      classe: 'leitura' as const,
      entrada: z.object({}).strict(),
      async executar() { throw new Error('senha do banco: hunter2'); },
    }),
  ]);

  const credenciais = new Map<string, Escopo>();
  const emitir = (escopo: Omit<Escopo, 'requestId' | 'sourceIp'>) => {
    const segredo = gerarCredencial();
    credenciais.set(segredo, { ...escopo, requestId: '', sourceIp: null });
    return segredo;
  };
  const contagem = new Map<string, number>();
  const rota = criarRotaMcp({
    habilitado: opcoes.habilitado ?? true,
    origemDoApp: ORIGEM_DO_APP,
    chamadasPorMinuto: opcoes.chamadasPorMinuto ?? 60,
    corpoMaximo: CORPO_MAXIMO_DO_MCP,
    async autenticar(candidata, origem) {
      const escopo = credenciais.get(candidata);
      return escopo ? { ...escopo, ...origem } : null;
    },
    manipular: criarManipuladorMcp(registro, (evento, dados) => avisos.push({ evento, dados })),
    consumir(dominio, chave, limite) {
      const balde = `${dominio}|${chave}`;
      const usados = (contagem.get(balde) ?? 0) + 1;
      contagem.set(balde, usados);
      return { allowed: usados <= limite, retryAfterSeconds: 30 };
    },
  });
  return { rota, emitir, execucoes, avisos, contagem };
}

function pedido(corpo: unknown, cabecalhos: Record<string, string> = {}) {
  return new Request('https://app.exemplo.test/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...cabecalhos },
    body: JSON.stringify(corpo),
  });
}

async function mensagem(resposta: Response): Promise<{ result?: Record<string, unknown>; error?: Record<string, unknown> }> {
  const texto = await resposta.text();
  const dados = texto.split('\n').find((linha) => linha.startsWith('data: '));
  return JSON.parse(dados ? dados.slice('data: '.length) : texto);
}

const listar = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
const chamar = (nome: string, argumentos: Record<string, unknown>) => ({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: nome, arguments: argumentos } });
const portador = (segredo: string) => ({ authorization: `Bearer ${segredo}` });
const conteudo = (m: { result?: Record<string, unknown> }) => (m.result?.content as { text: string }[])[0]!.text;

describe('servidor MCP (ADR 0057 §6)', () => {
  it('desligado responde 404 antes de qualquer coisa', async () => {
    const { rota, emitir } = montar({ habilitado: false });
    const segredo = emitir({ credencialId: 'c1', organizationId: 'org-a', clienteIds: null, ferramentas: ['catalogo_ler'] });
    assert.equal((await rota(pedido(listar, portador(segredo)))).status, 404);
  });

  it('sem credencial, com credencial errada ou com o formato de outro esquema responde 401 igual', async () => {
    const { rota, execucoes } = montar();
    const respostas = [
      await rota(pedido(listar)),
      await rota(pedido(listar, portador(gerarCredencial()))),
      await rota(pedido(listar, { authorization: 'Basic abc' })),
      await rota(pedido(listar, { authorization: 'Bearer ' })),
    ];
    const corpos = await Promise.all(respostas.map(async (r) => ({ status: r.status, titulo: (await r.json()).title, desafio: r.headers.get('www-authenticate') })));
    for (const corpo of corpos) assert.deepEqual(corpo, corpos[0]);
    assert.equal(corpos[0]!.status, 401);
    assert.equal(execucoes.length, 0);
  });

  it('origem de navegador diferente da do app é recusada', async () => {
    const { rota, emitir } = montar();
    const segredo = emitir({ credencialId: 'c1', organizationId: 'org-a', clienteIds: null, ferramentas: ['catalogo_ler'] });
    assert.equal((await rota(pedido(listar, { ...portador(segredo), origin: 'https://malicioso.test' }))).status, 403);
    assert.equal((await rota(pedido(listar, { ...portador(segredo), origin: ORIGEM_DO_APP }))).status, 200);
  });

  it('corpo declarado acima do limite responde 413', async () => {
    const { rota, emitir } = montar();
    const segredo = emitir({ credencialId: 'c1', organizationId: 'org-a', clienteIds: null, ferramentas: ['catalogo_ler'] });
    const resposta = await rota(pedido(listar, { ...portador(segredo), 'content-length': String(CORPO_MAXIMO_DO_MCP + 1) }));
    assert.equal(resposta.status, 413);
  });

  it('lote de mensagens, método fora da lista e corpo que não é JSON são recusados sem executar', async () => {
    const { rota, emitir, execucoes } = montar();
    const segredo = emitir({ credencialId: 'c1', organizationId: 'org-a', clienteIds: null, ferramentas: ['catalogo_ler'] });
    const lote = Array.from({ length: 100 }, (_, i) => ({ ...chamar('catalogo_ler', { clienteId: CLIENTE_A }), id: i }));
    const recusados = [
      lote,
      [chamar('catalogo_ler', { clienteId: CLIENTE_A })],
      { jsonrpc: '2.0', id: 1, method: 'subscriptions/listen' },
      { jsonrpc: '2.0', id: 1, method: 'resources/list' },
      { jsonrpc: '2.0', id: 1 },
      'texto solto',
      null,
    ];
    for (const corpo of recusados) assert.equal((await rota(pedido(corpo, portador(segredo)))).status, 400);
    const naoJson = new Request('https://app.exemplo.test/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...portador(segredo) }, body: '{"method":' });
    assert.equal((await rota(naoJson)).status, 400);
    assert.equal(execucoes.length, 0);
  });

  it('corpo grande sem tamanho declarado é cortado no teto', async () => {
    const { rota, emitir, execucoes } = montar();
    const segredo = emitir({ credencialId: 'c1', organizationId: 'org-a', clienteIds: null, ferramentas: ['catalogo_ler'] });
    const grande = new Request('https://app.exemplo.test/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...portador(segredo) },
      body: JSON.stringify({ ...chamar('catalogo_ler', { clienteId: CLIENTE_A }), enchimento: 'x'.repeat(CORPO_MAXIMO_DO_MCP) }),
    });
    assert.equal((await rota(grande)).status, 413);
    assert.equal(execucoes.length, 0);
  });

  it('lista só as ferramentas do escopo da credencial', async () => {
    const { rota, emitir } = montar();
    const umaSo = emitir({ credencialId: 'c1', organizationId: 'org-a', clienteIds: null, ferramentas: ['catalogo_ler'] });
    const nenhuma = emitir({ credencialId: 'c2', organizationId: 'org-a', clienteIds: null, ferramentas: [] });
    const nomes = async (segredo: string) => ((await mensagem(await rota(pedido(listar, portador(segredo))))).result?.tools as { name: string }[] | undefined ?? []).map((t) => t.name);
    assert.deepEqual(await nomes(umaSo), ['catalogo_ler']);
    assert.deepEqual(await nomes(nenhuma), []);
  });

  it('a ferramenta recebe o escopo de quem chamou e nunca o de outra credencial', async () => {
    const { rota, emitir, execucoes } = montar();
    const deA = emitir({ credencialId: 'cred-a', organizationId: 'org-a', clienteIds: [CLIENTE_A], ferramentas: ['catalogo_ler'] });
    const deB = emitir({ credencialId: 'cred-b', organizationId: 'org-b', clienteIds: [CLIENTE_B], ferramentas: ['catalogo_ler'] });

    const [respostaA, respostaB] = await Promise.all([
      rota(pedido(chamar('catalogo_ler', { clienteId: CLIENTE_A }), portador(deA))),
      rota(pedido(chamar('catalogo_ler', { clienteId: CLIENTE_B }), portador(deB))),
    ]);
    assert.deepEqual(JSON.parse(conteudo(await mensagem(respostaA))), { organizacao: 'org-a', cliente: CLIENTE_A, limite: 10 });
    assert.deepEqual(JSON.parse(conteudo(await mensagem(respostaB))), { organizacao: 'org-b', cliente: CLIENTE_B, limite: 10 });

    const cruzada = await mensagem(await rota(pedido(chamar('catalogo_ler', { clienteId: CLIENTE_B }), portador(deA))));
    assert.equal(cruzada.result?.isError, true);
    assert.equal(conteudo(cruzada), 'Cliente não encontrado.');
    assert.deepEqual(execucoes.map((e) => e.escopo.organizationId).sort(), ['org-a', 'org-a', 'org-b']);
  });

  it('ferramenta fora do escopo não executa, mesmo existindo no registro', async () => {
    const { rota, emitir, execucoes } = montar();
    const segredo = emitir({ credencialId: 'c1', organizationId: 'org-a', clienteIds: null, ferramentas: ['outra_ler'] });
    const resposta = await mensagem(await rota(pedido(chamar('catalogo_ler', { clienteId: CLIENTE_A }), portador(segredo))));
    assert.equal(resposta.result?.isError === true || resposta.error !== undefined, true);
    assert.equal(execucoes.length, 0);
  });

  it('entrada fora do esquema não executa', async () => {
    const { rota, emitir, execucoes } = montar();
    const segredo = emitir({ credencialId: 'c1', organizationId: 'org-a', clienteIds: null, ferramentas: ['catalogo_ler'] });
    for (const argumentos of [{ clienteId: 'nao-e-uuid' }, { clienteId: CLIENTE_A, limite: 5000 }, { clienteId: CLIENTE_A, organizationId: 'org-b' }, {}]) {
      const resposta = await mensagem(await rota(pedido(chamar('catalogo_ler', argumentos), portador(segredo))));
      assert.equal(resposta.result?.isError === true || resposta.error !== undefined, true);
    }
    assert.equal(execucoes.length, 0);
  });

  it('exceção da ferramenta vira falha genérica e não vaza a mensagem', async () => {
    const { rota, emitir, avisos } = montar();
    const segredo = emitir({ credencialId: 'c1', organizationId: 'org-a', clienteIds: null, ferramentas: ['outra_ler'] });
    const resposta = await rota(pedido(chamar('outra_ler', {}), portador(segredo)));
    const texto = await resposta.text();
    assert.equal(texto.includes('hunter2'), false);
    assert.equal(texto.includes('não pôde ser executada'), true);
    assert.equal(JSON.stringify(avisos).includes('hunter2'), false);
    assert.equal(avisos[0]!.evento, 'ia.mcp.ferramenta_falhou');
  });

  it('limite por credencial responde 429 com Retry-After e não afeta outra credencial', async () => {
    const { rota, emitir } = montar({ chamadasPorMinuto: 2 });
    const a = emitir({ credencialId: 'cred-a', organizationId: 'org-a', clienteIds: null, ferramentas: ['catalogo_ler'] });
    const b = emitir({ credencialId: 'cred-b', organizationId: 'org-b', clienteIds: null, ferramentas: ['catalogo_ler'] });
    assert.equal((await rota(pedido(listar, portador(a)))).status, 200);
    assert.equal((await rota(pedido(listar, portador(a)))).status, 200);
    const barrada = await rota(pedido(listar, portador(a)));
    assert.equal(barrada.status, 429);
    assert.equal(barrada.headers.get('retry-after'), '30');
    assert.equal((await rota(pedido(listar, portador(b)))).status, 200);
  });

  it('a origem é cobrada no domínio ip e a credencial, só depois de validada, no domínio ia', async () => {
    const { rota, emitir, contagem } = montar();
    await rota(pedido(listar, portador('orla_ag_inventada')));
    assert.deepEqual([...contagem.keys()], ['ip|mcp:origem:desconhecida']);
    const segredo = emitir({ credencialId: 'cred-a', organizationId: 'org-a', clienteIds: null, ferramentas: ['catalogo_ler'] });
    await rota(pedido(listar, { ...portador(segredo), 'x-forwarded-for': '203.0.113.7' }));
    assert.deepEqual([...contagem.keys()], ['ip|mcp:origem:desconhecida', 'ip|mcp:origem:203.0.113.7', 'ia|mcp:credencial:cred-a']);
  });

  it('a resposta nunca devolve a credencial', async () => {
    const { rota, emitir } = montar();
    const segredo = emitir({ credencialId: 'c1', organizationId: 'org-a', clienteIds: null, ferramentas: ['catalogo_ler'] });
    const resposta = await rota(pedido(chamar('catalogo_ler', { clienteId: CLIENTE_A }), portador(segredo)));
    assert.equal((await resposta.text()).includes(segredo), false);
    assert.equal([...resposta.headers.values()].join(' ').includes(segredo), false);
  });
});
