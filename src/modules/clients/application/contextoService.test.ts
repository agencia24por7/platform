import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import type { ContextoRepository, EscopoDoLink, LinkDeContexto } from '@/modules/clients/infrastructure/contextoRepository';
import type { EntradaDeCampo, ItemDeLista } from '@/modules/clients/domain/contexto/tipos';
import type { PortaDoArmazenamento } from './portaDoArmazenamento.ts';

Object.assign(process.env, {
  DATABASE_URL: 'postgres://teste:teste@localhost:5432/teste',
  TRIA_WORKER_TOKEN: 'w'.repeat(40),
  TRIA_SESSION_SECRET: 's'.repeat(40),
  TRIA_APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'error',
});

const { createContextoService } = await import('./contextoService.ts');
const { adaptarArmazenamento } = await import('@/modules/clients/infrastructure/armazenamentoAdaptado.ts');
const { criarArmazenamentoNulo: nuloCompartilhado } = await import('@/shared/storage/armazenamentoNulo.ts');
const criarArmazenamentoNulo = () => adaptarArmazenamento(nuloCompartilhado());
const { hashDoToken, gerarTokenDeContexto } = await import('@/modules/clients/domain/contexto/link.ts');
const { ok, err } = await import('@/shared/result/result.ts');
const { failure } = await import('@/shared/result/failure.ts');

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const AGORA = new Date('2026-11-20T12:00:00.000Z');
const ator = { userId: 'user-1', requestId: 'req-1', sourceIp: '10.0.0.1' };
const comando = { organizationId: ORG, clientId: CLIENTE, papelDeQuemAge: 'operator' as const };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

type Chamada = { metodo: string; args: unknown[] };

type OpcoesDoMontar = {
  armazenamento?: PortaDoArmazenamento;
  escopo?: EscopoDoLink | null;
  liberar?: boolean;
  reserva?: string | Error;
  confirmacao?: string | Error;
  alvo?: string;
  abertura?: boolean;
  semVaga?: boolean;
  reservasAVarrer?: { id: string; organizationId: string; clientId: string; caminho: string }[];
  conhecidos?: string[];
};

function montar(opcoes: OpcoesDoMontar = {}) {
  const eventos: AuditEvent[] = [];
  const chamadas: Chamada[] = [];
  const agendados: string[] = [];
  const entradas = new Map<string, EntradaDeCampo>();
  const itens = new Map<string, ItemDeLista>();
  const links: LinkDeContexto[] = [];
  let estadoDoBrain: { hashExportado: string | null; versaoDoEsquema: number | null } | null = null;
  const tentativas: unknown[] = [];

  const anota = (metodo: string, ...args: unknown[]) => chamadas.push({ metodo, args });

  const repositorio = {
    async carregar() {
      return { nome: 'Padaria', contexto: { campos: [...entradas.values()], itens: [...itens.values()], arquivos: [] } };
    },
    async lerEntrada(_o: string, _c: string, chave: string) {
      return entradas.get(chave) ?? null;
    },
    async gravarEntrada(_o: string, input: Parameters<ContextoRepository['gravarEntrada']>[1]) {
      anota('gravarEntrada', input);
      const atual = entradas.get(input.fieldKey);
      if ((atual?.versao ?? 0) !== input.versaoEsperada) return { ok: false as const, versaoAtual: atual?.versao ?? 0 };
      const entrada: EntradaDeCampo = {
        secao: input.secao,
        fieldKey: input.fieldKey,
        valor: input.valor,
        ...input.marcacao,
        versao: input.versaoEsperada + 1,
        atualizadoEm: AGORA,
        atualizadoPor: input.autorId,
        viaLink: false,
      };
      entradas.set(input.fieldKey, entrada);
      return { ok: true as const, valor: entrada };
    },
    async apagarEntrada() {
      return { ok: true as const, valor: null };
    },
    async lerItem(_o: string, _c: string, id: string) {
      return itens.get(id) ?? null;
    },
    async contarItens() {
      return itens.size;
    },
    async inserirItem(_o: string, input: Parameters<ContextoRepository['inserirItem']>[1]) {
      if (opcoes.semVaga) return null;
      const item: ItemDeLista = {
        id: `00000000-0000-4000-8000-00000000000${itens.size + 1}`,
        secao: input.secao,
        listKey: input.listKey,
        posicao: itens.size,
        dados: input.dados,
        ...input.marcacao,
        versao: 1,
        atualizadoEm: AGORA,
        viaLink: false,
      };
      itens.set(item.id, item);
      return item;
    },
    async usoDeArquivos() {
      return 0;
    },
    async reservarArquivo(_o: string, input: unknown) {
      anota('reservarArquivo', input);
      if (opcoes.reserva instanceof Error) throw opcoes.reserva;
      return opcoes.reserva ?? 'ok';
    },
    async liberarReserva(_o: string, _c: string, id: string) {
      anota('liberarReserva', id);
    },
    async reservarArquivoPeloLink(hash: string, input: unknown) {
      anota('reservarArquivoPeloLink', hash, input);
      if (opcoes.reserva instanceof Error) throw opcoes.reserva;
      return opcoes.reserva ?? 'ok';
    },
    async confirmarArquivoPeloLink(hash: string, input: unknown) {
      anota('confirmarArquivoPeloLink', hash, input);
      if (opcoes.confirmacao instanceof Error) throw opcoes.confirmacao;
      return opcoes.confirmacao ?? 'ok';
    },
    async liberarReservaPeloLink(_h: string, id: string) {
      anota('liberarReservaPeloLink', id);
    },
    async registrarAberturaPeloLink(hash: string) {
      anota('registrarAberturaPeloLink', hash);
      return opcoes.abertura ?? true;
    },
    async alvoDoArmazenamento() {
      return opcoes.alvo ?? 'excluido';
    },
    async marcarBrainDespublicado(clientId: string) {
      anota('marcarBrainDespublicado', clientId);
    },
    async reservasAVarrer() {
      return opcoes.reservasAVarrer ?? [];
    },
    async marcarReservaVarrida(id: string) {
      anota('marcarReservaVarrida', id);
    },
    async clientesParaVarrerArquivos() {
      return [{ organizationId: ORG, clientId: CLIENTE }];
    },
    async caminhosConhecidos() {
      return new Set(opcoes.conhecidos ?? []);
    },
    async brainsDeExcluidos() {
      return [];
    },
    async registrarArquivo(_o: string, input: Parameters<ContextoRepository['registrarArquivo']>[1]) {
      anota('registrarArquivo', input);
      if (input.nome === 'falha.png') throw new Error('banco fora');
      return { ...input, caminho: input.caminho, criadoEm: AGORA };
    },
    async criarLink(_o: string, input: Parameters<ContextoRepository['criarLink']>[1]) {
      anota('criarLink', input);
      const link: LinkDeContexto = {
        id: `link-${links.length + 1}`,
        clientId: input.clientId,
        secoes: input.secoes,
        expiraEm: input.expiraEm,
        revogadoEm: null,
        criadoEm: AGORA,
        criadoPor: input.criadoPor,
        primeiroUsoEm: null,
        ultimoUsoEm: null,
        concluidoEm: null,
        nota: input.nota,
        conviteDeIntegracaoId: input.conviteDeIntegracaoId,
      };
      links.push(link);
      return link;
    },
    async lerLink(_o: string, _c: string, id: string) {
      return links.find((l) => l.id === id) ?? null;
    },
    async regenerarLink(_o: string, input: Parameters<ContextoRepository['regenerarLink']>[1]) {
      anota('regenerarLink', input);
      const indice = links.findIndex((l) => l.id === input.linkAnteriorId);
      if (indice < 0) return null;
      if (!links[indice]!.revogadoEm) links[indice] = { ...links[indice]!, revogadoEm: AGORA };
      const novo: LinkDeContexto = {
        id: `link-${links.length + 1}`,
        clientId: input.clientId,
        secoes: input.secoes,
        expiraEm: input.expiraEm,
        revogadoEm: null,
        criadoEm: AGORA,
        criadoPor: input.criadoPor,
        primeiroUsoEm: null,
        ultimoUsoEm: null,
        concluidoEm: null,
        nota: input.nota,
        conviteDeIntegracaoId: input.conviteDeIntegracaoId,
      };
      links.push(novo);
      return novo;
    },
    async revogarLink(_o: string, _c: string, id: string) {
      const indice = links.findIndex((l) => l.id === id && !l.revogadoEm);
      if (indice < 0) return null;
      links[indice] = { ...links[indice]!, revogadoEm: AGORA };
      return links[indice]!;
    },
    async conviteDoCliente(_o: string, _c: string, id: string) {
      if (id === 'convite-vivo') return { status: 'pending', expiraEm: new Date('2026-12-01T00:00:00Z') };
      if (id === 'convite-vencido') return { status: 'pending', expiraEm: new Date('2026-11-19T00:00:00Z') };
      return id === 'convite-revogado' ? { status: 'revoked', expiraEm: null } : null;
    },
    async estadoDoBrain() {
      return estadoDoBrain
        ? { solicitadoEm: AGORA, exportadoEm: AGORA, ultimaTentativaEm: AGORA, ultimoErro: null, tentativas: 0, ...estadoDoBrain }
        : null;
    },
    async registrarTentativaDoBrain(_o: string, _c: string, resultado: { ok: boolean; hash?: string; versaoDoEsquema?: number }) {
      tentativas.push(resultado);
      if (resultado.ok) estadoDoBrain = { hashExportado: resultado.hash ?? null, versaoDoEsquema: resultado.versaoDoEsquema ?? null };
    },
    async abrirLink(hash: string) {
      anota('abrirLink', hash);
      return opcoes.escopo === undefined ? null : opcoes.escopo;
    },
    async lerPeloLink(hash: string, campos: readonly string[]) {
      anota('lerPeloLink', hash, campos);
      return { campos: [], itens: [], arquivos: [] };
    },
    async salvarCampoPeloLink(hash: string, input: unknown) {
      anota('salvarCampoPeloLink', hash, input);
      return { resultado: 'conflito' as const, versao: 3 };
    },
    async hashPeloConvite(token: string) {
      return token === 'convite-com-contexto-123' ? 'f'.repeat(64) : null;
    },
  } as unknown as ContextoRepository;

  const audit = {
    async record(evento: AuditEvent) {
      eventos.push(evento);
    },
    async list() {
      return [];
    },
    async search() {
      return [];
    },
  };

  const servico = createContextoService({
    repositorio,
    audit,
    armazenamento: opcoes.armazenamento ?? criarArmazenamentoNulo(),
    agora: () => AGORA,
    limitar: () => ({ allowed: opcoes.liberar ?? true, remaining: 1, retryAfterSeconds: 9 }),
    agendador: () => ({ agendar: (escopo) => agendados.push(escopo.clientId) }),
    esperarMs: async () => undefined,
  });

  return { servico, eventos, chamadas, agendados, entradas, links, tentativas };
}

function armazenamentoEmMemoria(falharEm: string | null = null, listados: { caminho: string; atualizadoEm: Date }[] = []) {
  const objetos = new Map<string, Uint8Array>();
  const gravacoes: string[] = [];
  const apagados: string[] = [];
  const prefixosApagados: string[] = [];
  const armazenamento: PortaDoArmazenamento = {
    configurado: true,
    async put(caminho, conteudo, meta) {
      gravacoes.push(caminho);
      if (falharEm && caminho.endsWith(falharEm)) return err(failure('unavailable', 'bucket fora'));
      objetos.set(caminho, conteudo as Uint8Array);
      return ok({ caminho, contentType: meta.contentType, tamanhoBytes: 1, atualizadoEm: AGORA });
    },
    get: async () => err(failure('not_found', 'x')),
    list: async () =>
      ok([
        ...listados.map((l) => ({ caminho: l.caminho, contentType: 'image/png', tamanhoBytes: 1, atualizadoEm: l.atualizadoEm })),
        ...[...objetos.keys()].map((caminho) => ({ caminho, contentType: 'image/png', tamanhoBytes: 1, atualizadoEm: AGORA })),
      ]),
    async delete(caminho) {
      apagados.push(caminho);
      objetos.delete(caminho);
      return ok(undefined);
    },
    async deletePrefix(prefixo) {
      prefixosApagados.push(prefixo);
      let total = 0;
      for (const caminho of [...objetos.keys()]) {
        if (!caminho.startsWith(prefixo)) continue;
        objetos.delete(caminho);
        total += 1;
      }
      return ok({ apagados: total });
    },
    saudavel: async () => true,
  };
  return { armazenamento, objetos, gravacoes, apagados, prefixosApagados };
}

const ESCOPO: EscopoDoLink = {
  linkId: 'link-1',
  organizationId: ORG,
  clientId: CLIENTE,
  nomeDaOrganizacao: 'Agência',
  nomeDoCliente: 'Padaria',
  secoes: ['empresa'],
  expiraEm: new Date('2026-12-20T00:00:00Z'),
  concluidoEm: null,
  nota: null,
  usoDeArquivosBytes: 0,
};

describe('contexto pela equipe', () => {
  it('quem só vê não altera', async () => {
    const { servico } = montar();
    const r = await servico.salvarCampo({ ...comando, papelDeQuemAge: 'viewer', fieldKey: 'segmento', valor: 'x', versaoEsperada: 0 }, ator);
    assert.equal(r.ok ? 'ok' : r.error.code, 'forbidden');
  });

  it('salva com normalização, audita sem o valor e agenda o brain', async () => {
    const { servico, eventos, agendados } = montar({ armazenamento: armazenamentoEmMemoria().armazenamento });
    const r = await servico.salvarCampo({ ...comando, fieldKey: 'site', valor: 'padaria.com.br', versaoEsperada: 0 }, ator);
    assert.ok(r.ok);
    assert.equal(r.value?.valor, 'https://padaria.com.br');
    assert.equal(r.value?.fonte, 'equipe');
    assert.equal(r.value?.compartilhavel, false);
    assert.equal(eventos[0]?.action, 'client.context.field_saved');
    assert.ok(!JSON.stringify(eventos[0]?.metadata).includes('padaria'));
    assert.deepEqual(agendados, [CLIENTE]);
  });

  it('versão velha vira conflito com a versão atual', async () => {
    const { servico } = montar();
    await servico.salvarCampo({ ...comando, fieldKey: 'segmento', valor: 'a', versaoEsperada: 0 }, ator);
    const r = await servico.salvarCampo({ ...comando, fieldKey: 'segmento', valor: 'b', versaoEsperada: 0 }, ator);
    assert.equal(r.ok ? 'ok' : r.error.code, 'conflict');
    assert.equal(r.ok ? null : r.error.details?.versaoAtual, '1');
  });

  it('campo desconhecido, lista no lugar de campo e valor inválido são recusados', async () => {
    const { servico } = montar();
    for (const [fieldKey, valor] of [['senha', 'x'], ['produtos', 'x'], ['site', 'javascript:alert(1)']] as const) {
      const r = await servico.salvarCampo({ ...comando, fieldKey, valor, versaoEsperada: 0 }, ator);
      assert.equal(r.ok ? 'ok' : r.error.code, 'validation', fieldKey);
    }
  });

  it('a sugestão da IA entra como sugerida, só em campo vazio, e a confirmação a promove', async () => {
    const { servico, entradas } = montar();
    await servico.salvarCampo({ ...comando, fieldKey: 'cidade', valor: 'Recife', versaoEsperada: 0 }, ator);
    const r = await servico.aplicarSugestoes(
      {
        ...comando,
        sugestoes: [
          { tipo: 'campo', fieldKey: 'segmento', valor: 'Padaria', fonte: 'ia' },
          { tipo: 'campo', fieldKey: 'cidade', valor: 'Olinda', fonte: 'ia' },
          { tipo: 'item', listKey: 'produtos', dados: { nome: 'Pão' }, fonte: 'ia' },
        ],
      },
      ator,
    );
    assert.deepEqual(r.ok && r.value, { aplicadas: 2, ignoradas: 1 });
    assert.equal(entradas.get('segmento')?.revisao, 'sugerido');
    assert.equal(entradas.get('segmento')?.epistemico, 'hipotese');
    assert.equal(entradas.get('cidade')?.valor, 'Recife');

    const confirmado = await servico.confirmarSugestao({ ...comando, alvo: { tipo: 'campo', fieldKey: 'segmento' }, versaoEsperada: 1 }, ator);
    assert.ok(confirmado.ok);
    assert.equal(entradas.get('segmento')?.revisao, 'confirmado');
  });

  it('lista cheia no banco (conferida sob trava) recusa o item', async () => {
    const { servico } = montar({ semVaga: true });
    const r = await servico.adicionarItem({ ...comando, listKey: 'redes_sociais', dados: { rede: 'instagram', perfil: '@x' } }, ator);
    assert.equal(r.ok ? 'ok' : r.error.code, 'validation');
  });

  it('item de lista valida o esquema do item', async () => {
    const { servico } = montar();
    const ruim = await servico.adicionarItem({ ...comando, listKey: 'redes_sociais', dados: { perfil: '@x' } }, ator);
    assert.equal(ruim.ok ? 'ok' : ruim.error.details?.rede !== undefined, true);
    const bom = await servico.adicionarItem({ ...comando, listKey: 'redes_sociais', dados: { rede: 'instagram', perfil: 'instagram.com/padaria' } }, ator);
    assert.equal(bom.ok && bom.value.dados.perfil, '@padaria');
  });
});

describe('links de contexto', () => {
  it('devolve o token uma vez e o repositório só recebe o hash', async () => {
    const { servico, chamadas, eventos } = montar();
    const r = await servico.criarLink({ ...comando, secoes: ['marca', 'empresa'], nota: 'Oi!' }, ator);
    assert.ok(r.ok);
    const enviado = chamadas.find((c) => c.metodo === 'criarLink')!.args[0] as { tokenHash: string };
    assert.equal(enviado.tokenHash, hashDoToken(r.value.token));
    assert.ok(!JSON.stringify(chamadas).includes(r.value.token));
    assert.ok(!JSON.stringify(eventos).includes(r.value.token));
    assert.deepEqual(r.value.link.secoes, ['empresa', 'marca']);
    assert.equal(r.value.link.estado, 'ativo');
    assert.equal(r.value.link.expiraEm.getTime() - AGORA.getTime(), 30 * 86_400_000);
  });

  it('recusa seção inexistente e convite de integração que não vale', async () => {
    const { servico } = montar();
    const secao = await servico.criarLink({ ...comando, secoes: ['senhas'] }, ator);
    assert.equal(secao.ok ? 'ok' : secao.error.details?.motivo, 'secao_invalida');
    const revogado = await servico.criarLink({ ...comando, secoes: ['empresa'], conviteDeIntegracaoId: 'convite-revogado' }, ator);
    assert.equal(revogado.ok ? 'ok' : revogado.error.code, 'validation');
    const vivo = await servico.criarLink({ ...comando, secoes: ['empresa'], conviteDeIntegracaoId: 'convite-vivo' }, ator);
    assert.equal(vivo.ok && vivo.value.link.conviteDeIntegracaoId, 'convite-vivo');
  });

  it('regenerar com o convite vencido falha sem revogar o link atual', async () => {
    const { servico, links } = montar();
    links.push({
      id: 'link-convite',
      clientId: CLIENTE,
      secoes: ['empresa'],
      expiraEm: new Date('2026-12-20T00:00:00Z'),
      revogadoEm: null,
      criadoEm: AGORA,
      criadoPor: null,
      primeiroUsoEm: null,
      ultimoUsoEm: null,
      concluidoEm: null,
      nota: null,
      conviteDeIntegracaoId: 'convite-vencido',
    });
    const r = await servico.regenerarLink({ ...comando, linkId: 'link-convite' }, ator);
    assert.equal(r.ok ? 'ok' : r.error.code, 'validation');
    assert.equal(links[0]?.revogadoEm, null);
    assert.equal(links.length, 1);
  });

  it('regenerar revoga o anterior e cria outro com o mesmo recorte', async () => {
    const { servico, links } = montar();
    const primeiro = await servico.criarLink({ ...comando, secoes: ['marca'], expiraEmDias: 10 }, ator);
    assert.ok(primeiro.ok);
    const novo = await servico.regenerarLink({ ...comando, linkId: primeiro.value.link.id }, ator);
    assert.ok(novo.ok);
    assert.notEqual(novo.value.token, primeiro.value.token);
    assert.ok(links[0]?.revogadoEm);
    assert.deepEqual(novo.value.link.secoes, ['marca']);
    assert.equal(novo.value.link.expiraEm.getTime() - AGORA.getTime(), 10 * 86_400_000);
  });
});

describe('formulário público', () => {
  it('token malformado nem chega ao banco', async () => {
    const { servico, chamadas } = montar({ escopo: ESCOPO });
    const r = await servico.carregarPeloLink({ credencial: { tipo: 'link', token: '../x' }, ip: null, requestId: 'r' });
    assert.equal(r.ok ? 'ok' : r.error.code, 'not_found');
    assert.equal(chamadas.length, 0);
  });

  it('respeita o limite de tentativas', async () => {
    const { servico, chamadas } = montar({ escopo: ESCOPO, liberar: false });
    const r = await servico.carregarPeloLink({ credencial: { tipo: 'link', token: gerarTokenDeContexto() }, ip: '1.1.1.1', requestId: 'r' });
    assert.equal(r.ok ? 'ok' : r.error.code, 'rate_limited');
    assert.equal(chamadas.length, 0);
  });

  it('pede ao banco só campos que o catálogo libera e audita sem IP', async () => {
    const { servico, chamadas, eventos } = montar({ escopo: ESCOPO });
    const token = gerarTokenDeContexto();
    const r = await servico.carregarPeloLink({ credencial: { tipo: 'link', token }, ip: '1.1.1.1', requestId: 'r' });
    assert.ok(r.ok);
    const [hash, campos] = chamadas.find((c) => c.metodo === 'lerPeloLink')!.args as [string, string[]];
    assert.equal(hash, hashDoToken(token));
    assert.ok(campos.includes('descricao_do_cliente'));
    assert.ok(!campos.includes('notas_internas_empresa'));
    assert.ok(!campos.includes('tagline'));
    assert.deepEqual(r.value.secoes.map((s) => s.key), ['empresa']);
    assert.ok(r.value.secoes[0]!.campos.every((c) => c.visivelAoCliente));
    assert.equal(eventos[0]?.actorType, 'invite');
    assert.equal(eventos[0]?.sourceIp, null);
  });

  it('a abertura do formulário vai à trilha no máximo uma vez por hora', async () => {
    const { servico, eventos } = montar({ escopo: ESCOPO, abertura: false });
    const r = await servico.carregarPeloLink({ credencial: { tipo: 'link', token: gerarTokenDeContexto() }, ip: null, requestId: 'r' });
    assert.ok(r.ok);
    assert.ok(!eventos.some((e) => e.action === 'client.context.link_opened'));
  });

  it('o convite de integração abre o formulário amarrado a ele', async () => {
    const { servico, chamadas } = montar({ escopo: ESCOPO });
    const r = await servico.carregarPeloLink({ credencial: { tipo: 'convite', token: 'convite-com-contexto-123' }, ip: null, requestId: 'r' });
    assert.ok(r.ok);
    assert.equal(chamadas.find((c) => c.metodo === 'abrirLink')?.args[0], 'f'.repeat(64));
  });

  it('link vencido ou revogado (o banco não devolve escopo) é recusado', async () => {
    const { servico } = montar({ escopo: null });
    const r = await servico.carregarPeloLink({ credencial: { tipo: 'link', token: gerarTokenDeContexto() }, ip: null, requestId: 'r' });
    assert.equal(r.ok ? 'ok' : r.error.code, 'not_found');
  });

  it('não grava fora das seções do link nem em campo interno', async () => {
    const { servico, chamadas } = montar({ escopo: ESCOPO });
    const acesso = { credencial: { tipo: 'link' as const, token: gerarTokenDeContexto() }, ip: null, requestId: 'r' };
    for (const fieldKey of ['tagline', 'notas_internas_empresa', 'nao_existe']) {
      const r = await servico.salvarPeloLink(acesso, { tipo: 'campo', fieldKey, valor: 'x', versaoEsperada: 0 });
      assert.equal(r.ok ? 'ok' : r.error.code, 'forbidden', fieldKey);
    }
    assert.ok(!chamadas.some((c) => c.metodo === 'salvarCampoPeloLink'));
  });

  it('conflito do banco volta como conflict com a versão atual', async () => {
    const { servico, eventos } = montar({ escopo: ESCOPO });
    const acesso = { credencial: { tipo: 'link' as const, token: gerarTokenDeContexto() }, ip: null, requestId: 'r' };
    const r = await servico.salvarPeloLink(acesso, { tipo: 'campo', fieldKey: 'segmento', valor: 'Padaria', versaoEsperada: 0 });
    assert.equal(r.ok ? 'ok' : r.error.details?.versaoAtual, '3');
    const salvo = eventos.find((e) => e.action === 'client.context.link_saved');
    assert.equal(salvo?.metadata?.resultado, 'conflito');
    assert.ok(!JSON.stringify(salvo).includes('Padaria'));
  });
});

const lerDe = (conteudo: Uint8Array) => {
  const chamadas: number[] = [];
  const ler = async (esperado: number) => {
    chamadas.push(esperado);
    return ok(conteudo);
  };
  return { ler, chamadas };
};

const anexo = (fieldKey: string, nome: string, mime: string, conteudo: Uint8Array, extra: { listKey?: string; itemId?: string } = {}) => ({
  fieldKey,
  nome,
  mime,
  listKey: extra.listKey ?? null,
  itemId: extra.itemId ?? null,
  tamanhoDeclarado: conteudo.byteLength,
});

const ACESSO = { credencial: { tipo: 'link' as const, token: gerarTokenDeContexto() }, ip: null, requestId: 'r' };
const ESCOPO_DE_MARCA: EscopoDoLink = { ...ESCOPO, secoes: ['marca'] };

describe('arquivos', () => {
  it('sem bucket, anexar fica indisponível e nada é reservado', async () => {
    const { servico, chamadas } = montar();
    const r = await servico.anexarArquivo({ ...comando, ...anexo('logo', 'logo.png', 'image/png', PNG) }, lerDe(PNG).ler, ator);
    assert.equal(r.ok ? 'ok' : r.error.code, 'unavailable');
    assert.ok(!chamadas.some((c) => c.metodo === 'reservarArquivo'));
  });

  it('recusa SVG e conteúdo que não bate com o tipo, devolvendo a reserva', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico, chamadas } = montar({ armazenamento: memoria.armazenamento });
    const svgBytes = new TextEncoder().encode('<svg/>');
    const svg = await servico.anexarArquivo({ ...comando, ...anexo('logo', 'logo.svg', 'image/svg+xml', svgBytes) }, lerDe(svgBytes).ler, ator);
    assert.equal(svg.ok ? 'ok' : svg.error.details?.motivo, 'tipo_nao_permitido');
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1]);
    const zip = await servico.anexarArquivo({ ...comando, ...anexo('banco_de_midia', 'midia.zip', 'application/zip', zipBytes) }, lerDe(zipBytes).ler, ator);
    assert.equal(zip.ok ? 'ok' : zip.error.details?.motivo, 'tipo_nao_permitido');
    const html = new TextEncoder().encode('<html>');
    const falso = await servico.anexarArquivo({ ...comando, ...anexo('logo', 'logo.png', 'image/png', html) }, lerDe(html).ler, ator);
    assert.equal(falso.ok ? 'ok' : falso.error.details?.motivo, 'tipo_nao_permitido');
    assert.equal(memoria.gravacoes.length, 0);
    assert.equal(chamadas.filter((c) => c.metodo === 'liberarReserva').length, 3);
  });

  it('grava sob o prefixo do cliente e desfaz o objeto e a reserva se o registro falhar', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico, chamadas } = montar({ armazenamento: memoria.armazenamento });
    const r = await servico.anexarArquivo({ ...comando, ...anexo('logo', 'Logo Final.png', 'image/png', PNG) }, lerDe(PNG).ler, ator);
    assert.ok(r.ok);
    assert.match(r.value.caminho, new RegExp(`^orgs/${ORG}/clientes/${CLIENTE}/arquivos/[0-9a-f-]{36}-logo-final[.]png$`));

    await assert.rejects(
      servico.anexarArquivo({ ...comando, ...anexo('logo', 'falha.png', 'image/png', PNG) }, lerDe(PNG).ler, ator),
    );
    assert.equal(memoria.apagados.length, 1);
    assert.equal(memoria.objetos.size, 1);
    assert.equal(chamadas.filter((c) => c.metodo === 'liberarReserva').length, 1);
  });

  it('cota excedida na reserva: o corpo nem é lido e nada vai ao bucket', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico } = montar({ armazenamento: memoria.armazenamento, reserva: 'cota_excedida' });
    const leitor = lerDe(PNG);
    const r = await servico.anexarArquivo({ ...comando, ...anexo('logo', 'logo.png', 'image/png', PNG) }, leitor.ler, ator);
    assert.equal(r.ok ? 'ok' : r.error.details?.motivo, 'cota_excedida');
    assert.equal(leitor.chamadas.length, 0);
    assert.equal(memoria.gravacoes.length, 0);
  });
});

describe('arquivos pelo link público', () => {
  it('token malformado ou limite de tentativas: o corpo nunca é lido', async () => {
    const malformado = montar({ escopo: ESCOPO_DE_MARCA, armazenamento: armazenamentoEmMemoria().armazenamento });
    const leitor = lerDe(PNG);
    const r = await malformado.servico.anexarArquivoPeloLink(
      { credencial: { tipo: 'link', token: '../x' }, ip: null, requestId: 'r' },
      anexo('logo', 'logo.png', 'image/png', PNG),
      leitor.ler,
    );
    assert.equal(r.ok ? 'ok' : r.error.code, 'not_found');

    const contido = montar({ escopo: ESCOPO_DE_MARCA, liberar: false, armazenamento: armazenamentoEmMemoria().armazenamento });
    const limitado = await contido.servico.anexarArquivoPeloLink(ACESSO, anexo('logo', 'logo.png', 'image/png', PNG), leitor.ler);
    assert.equal(limitado.ok ? 'ok' : limitado.error.code, 'rate_limited');

    const vencido = montar({ escopo: null, armazenamento: armazenamentoEmMemoria().armazenamento });
    const semLink = await vencido.servico.anexarArquivoPeloLink(ACESSO, anexo('logo', 'logo.png', 'image/png', PNG), leitor.ler);
    assert.equal(semLink.ok ? 'ok' : semLink.error.code, 'not_found');
    assert.equal(leitor.chamadas.length, 0);
  });

  it('campo fora do recorte do link é recusado antes de reservar', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico, chamadas } = montar({ escopo: ESCOPO, armazenamento: memoria.armazenamento });
    const leitor = lerDe(PNG);
    const r = await servico.anexarArquivoPeloLink(ACESSO, anexo('logo', 'logo.png', 'image/png', PNG), leitor.ler);
    assert.equal(r.ok ? 'ok' : r.error.code, 'forbidden');
    assert.ok(!chamadas.some((c) => c.metodo === 'reservarArquivoPeloLink'));
    assert.equal(leitor.chamadas.length, 0);
  });

  it('item inválido derruba a reserva no banco: nenhum objeto fica no bucket', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico } = montar({ escopo: ESCOPO_DE_MARCA, armazenamento: memoria.armazenamento, reserva: new Error('invalid input syntax for type uuid') });
    const leitor = lerDe(PNG);
    await assert.rejects(servico.anexarArquivoPeloLink(ACESSO, anexo('logo', 'logo.png', 'image/png', PNG), leitor.ler));
    assert.equal(leitor.chamadas.length, 0);
    assert.equal(memoria.gravacoes.length, 0);
    assert.equal(memoria.objetos.size, 0);
  });

  it('falha do banco depois de gravar apaga o objeto e devolve a reserva', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico, chamadas } = montar({ escopo: ESCOPO_DE_MARCA, armazenamento: memoria.armazenamento, confirmacao: new Error('banco fora') });
    await assert.rejects(servico.anexarArquivoPeloLink(ACESSO, anexo('logo', 'logo.png', 'image/png', PNG), lerDe(PNG).ler));
    assert.equal(memoria.gravacoes.length, 1);
    assert.equal(memoria.objetos.size, 0);
    assert.equal(chamadas.filter((c) => c.metodo === 'liberarReservaPeloLink').length, 1);

    const recusado = montar({ escopo: ESCOPO_DE_MARCA, armazenamento: memoria.armazenamento, confirmacao: 'recusado' });
    const r = await recusado.servico.anexarArquivoPeloLink(ACESSO, anexo('logo', 'logo.png', 'image/png', PNG), lerDe(PNG).ler);
    assert.equal(r.ok ? 'ok' : r.error.code, 'not_found');
    assert.equal(memoria.objetos.size, 0);
  });

  it('orçamento do link esgotado volta 429 sem ler o corpo', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico } = montar({ escopo: ESCOPO_DE_MARCA, armazenamento: memoria.armazenamento, reserva: 'orcamento_excedido' });
    const leitor = lerDe(PNG);
    const r = await servico.anexarArquivoPeloLink(ACESSO, anexo('logo', 'logo.png', 'image/png', PNG), leitor.ler);
    assert.equal(r.ok ? 'ok' : r.error.code, 'rate_limited');
    assert.equal(leitor.chamadas.length, 0);
    assert.equal(memoria.gravacoes.length, 0);
  });

  it('envio completo lê exatamente o tamanho declarado, grava e confirma pela reserva', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico, chamadas } = montar({ escopo: ESCOPO_DE_MARCA, armazenamento: memoria.armazenamento });
    const leitor = lerDe(PNG);
    const r = await servico.anexarArquivoPeloLink(ACESSO, anexo('logo', 'logo.png', 'image/png', PNG), leitor.ler);
    assert.ok(r.ok);
    assert.deepEqual(leitor.chamadas, [PNG.byteLength]);
    const reserva = chamadas.find((c) => c.metodo === 'reservarArquivoPeloLink')!.args[1] as { caminho: string; tamanhoBytes: number };
    assert.equal(reserva.tamanhoBytes, PNG.byteLength);
    assert.ok(memoria.objetos.has(reserva.caminho));
  });
});

describe('armazenamento do cliente excluído', () => {
  it('cliente ativo não tem o bucket apagado', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico } = montar({ armazenamento: memoria.armazenamento, alvo: 'ativo' });
    const r = await servico.expurgarArmazenamento({ organizationId: ORG, clientId: CLIENTE }, 'tudo');
    assert.equal(r.ok ? 'ok' : r.error.code, 'conflict');
    assert.equal(memoria.prefixosApagados.length, 0);
  });

  it('expurgo apaga o prefixo inteiro, audita e é idempotente', async () => {
    const memoria = armazenamentoEmMemoria();
    const prefixo = `orgs/${ORG}/clientes/${CLIENTE}/`;
    memoria.objetos.set(`${prefixo}arquivos/a.png`, PNG);
    memoria.objetos.set(`${prefixo}contexto/brain/perfil.md`, PNG);
    memoria.objetos.set(`${prefixo}brain/catalogo.md`, PNG);
    memoria.objetos.set(`orgs/${ORG}/clientes/33333333-3333-4333-8333-333333333333/arquivos/b.png`, PNG);
    const { servico, eventos } = montar({ armazenamento: memoria.armazenamento, alvo: 'expurgado' });
    const primeira = await servico.expurgarArmazenamento({ organizationId: ORG, clientId: CLIENTE }, 'tudo');
    assert.ok(primeira.ok);
    assert.equal(primeira.value.apagados, 3);
    assert.deepEqual(memoria.prefixosApagados, [prefixo]);
    assert.equal(memoria.objetos.size, 1);
    const segunda = await servico.expurgarArmazenamento({ organizationId: ORG, clientId: CLIENTE }, 'tudo');
    assert.ok(segunda.ok);
    assert.equal(segunda.value.apagados, 0);
    assert.equal(eventos.filter((e) => e.action === 'client.context.storage_purged').length, 2);
  });

  it('exclusão lógica despublica só os derivados do brain', async () => {
    const memoria = armazenamentoEmMemoria();
    const prefixo = `orgs/${ORG}/clientes/${CLIENTE}/`;
    memoria.objetos.set(`${prefixo}arquivos/a.png`, PNG);
    memoria.objetos.set(`${prefixo}contexto/brain/perfil.md`, PNG);
    memoria.objetos.set(`${prefixo}brain/catalogo.md`, PNG);
    const { servico, chamadas } = montar({ armazenamento: memoria.armazenamento, alvo: 'excluido' });
    const r = await servico.expurgarArmazenamento({ organizationId: ORG, clientId: CLIENTE }, 'derivados');
    assert.ok(r.ok);
    assert.deepEqual([...memoria.objetos.keys()], [`${prefixo}arquivos/a.png`]);
    assert.ok(chamadas.some((c) => c.metodo === 'marcarBrainDespublicado'));
  });
});

describe('varredura de órfãos', () => {
  it('apaga objeto de reserva não consumida e objeto velho sem registro; mantém conhecido e recente', async () => {
    const prefixo = `orgs/${ORG}/clientes/${CLIENTE}/arquivos/`;
    const velho = new Date(AGORA.getTime() - 2 * 3_600_000);
    const memoria = armazenamentoEmMemoria(null, [
      { caminho: `${prefixo}orfao.png`, atualizadoEm: velho },
      { caminho: `${prefixo}conhecido.png`, atualizadoEm: velho },
      { caminho: `${prefixo}recente.png`, atualizadoEm: new Date(AGORA.getTime() - 60_000) },
    ]);
    const { servico, chamadas } = montar({
      armazenamento: memoria.armazenamento,
      conhecidos: [`${prefixo}conhecido.png`],
      reservasAVarrer: [{ id: 'r1', organizationId: ORG, clientId: CLIENTE, caminho: `${prefixo}reservado.png` }],
    });
    const resumo = await servico.varrerArquivos();
    assert.equal(resumo.reservasVarridas, 1);
    assert.equal(resumo.orfaosApagados, 1);
    assert.deepEqual(memoria.apagados.sort(), [`${prefixo}orfao.png`, `${prefixo}reservado.png`]);
    assert.ok(chamadas.some((c) => c.metodo === 'marcarReservaVarrida'));
  });

  it('sem bucket a varredura não faz nada', async () => {
    const { servico } = montar();
    assert.equal((await servico.varrerArquivos()).desativado, true);
  });
});

describe('publicação do brain', () => {
  it('sem bucket não publica, não agenda e o estado diz desativado', async () => {
    const { servico, agendados } = montar();
    const r = await servico.publicarBrain({ organizationId: ORG, clientId: CLIENTE });
    assert.equal(r.ok && r.value.situacao, 'sem_armazenamento');
    await servico.salvarCampo({ ...comando, fieldKey: 'segmento', valor: 'x', versaoEsperada: 0 }, ator);
    assert.deepEqual(agendados, []);
    const contexto = await servico.carregar({ organizationId: ORG, clientId: CLIENTE });
    assert.equal(contexto.ok && contexto.value.brain.situacao, 'desativado');
    assert.deepEqual(await servico.publicarPendentes(), { publicados: 0, inalterados: 0, falhas: 0, desativado: true });
  });

  it('reconstruir força a regravação mesmo sem mudança', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico } = montar({ armazenamento: memoria.armazenamento });
    await servico.publicarBrain({ organizationId: ORG, clientId: CLIENTE });
    const antes = memoria.gravacoes.length;
    const r = await servico.reconstruirBrains({ tipo: 'cliente', organizationId: ORG, clientId: CLIENTE });
    assert.deepEqual(r.ok && r.value, { publicados: 1, inalterados: 0, falhas: 0, desativado: false });
    assert.equal(memoria.gravacoes.length, antes * 2);
  });

  it('grava todos os arquivos com o manifest por último e pula quando nada mudou', async () => {
    const memoria = armazenamentoEmMemoria();
    const { servico } = montar({ armazenamento: memoria.armazenamento });
    const primeira = await servico.publicarBrain({ organizationId: ORG, clientId: CLIENTE });
    assert.equal(primeira.ok && primeira.value.situacao, 'publicado');
    assert.ok(memoria.gravacoes.at(-1)?.endsWith('brain/manifest.json'));
    assert.ok(memoria.gravacoes.some((c) => c.endsWith('brain/perfil.md')));

    const total = memoria.gravacoes.length;
    const segunda = await servico.publicarBrain({ organizationId: ORG, clientId: CLIENTE });
    assert.equal(segunda.ok && segunda.value.situacao, 'inalterado');
    assert.equal(memoria.gravacoes.length, total);
  });

  it('falha depois das retentativas fica registrada e auditada', async () => {
    const memoria = armazenamentoEmMemoria('perfil.json');
    const { servico, eventos, tentativas } = montar({ armazenamento: memoria.armazenamento });
    const r = await servico.publicarBrain({ organizationId: ORG, clientId: CLIENTE });
    assert.equal(r.ok ? 'ok' : r.error.code, 'unavailable');
    assert.equal(memoria.gravacoes.filter((c) => c.endsWith('perfil.json')).length, 3);
    assert.ok(!memoria.gravacoes.some((c) => c.endsWith('manifest.json')));
    assert.equal((tentativas.at(-1) as { ok: boolean }).ok, false);
    assert.ok(eventos.some((e) => e.action === 'client.context.brain_failed'));
  });
});
