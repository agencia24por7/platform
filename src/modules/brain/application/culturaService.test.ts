import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';
import { SinalRecusadoPeloBanco, type SinalDeCultura } from '../domain/cultura.ts';
import type { CulturaRepository, EscopoDeCultura, ItemDoLote } from '../infrastructure/culturaRepository.ts';
import type { MemberRole } from '@/modules/identity/domain/user';

const { createCulturaService } = await import('./culturaService.ts');

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const SINAL = '44444444-4444-4444-8444-444444444444';
const AGORA = new Date('2026-11-20T15:00:00Z');
const ator = { userId: 'user-1', requestId: 'req-1', sourceIp: null };
const worker = { requestId: 'req-w', callerFingerprint: 'fp', sourceIp: null };
const escopo = { organizationId: ORG, clientId: CLIENTE };

const dados = (extra: Record<string, unknown> = {}) => ({
  tipo: 'tendencia',
  titulo: 'Corrida de rua',
  resumo: 'Cresce a conversa sobre corrida.',
  fonteNome: 'Fonte',
  fonteUrl: 'https://exemplo.com.br/a',
  plataforma: '',
  observadoEm: '2026-11-18',
  validoAte: '2026-12-18',
  nota: 'B',
  ...extra,
});

function montar() {
  const guardados: SinalDeCultura[] = [];
  const eventos: AuditEvent[] = [];
  const chamadas: string[] = [];
  const chave = (e: EscopoDeCultura) => `${e.organizationId}/${e.clientId}`;
  const repositorio: CulturaRepository = {
    async inserir(e, novo) {
      chamadas.push('inserir');
      if (chave(e) !== chave(escopo)) return { ok: false, motivo: 'cliente_inexistente' };
      if (guardados.some((s) => s.fonteUrl === novo.fonteUrl && s.observadoEm === novo.observadoEm)) return { ok: false, motivo: 'duplicado' };
      const sinal: SinalDeCultura = { ...novo, id: SINAL, origem: 'manual', criadoEm: AGORA };
      guardados.push(sinal);
      return { ok: true, valor: sinal };
    },
    async inserirLote(_e, lote) {
      chamadas.push('lote');
      return lote.map((novo, i): ItemDoLote => {
        const existente = guardados.find((s) => s.fonteUrl === novo.fonteUrl && s.observadoEm === novo.observadoEm);
        if (existente) return { id: existente.id, fonteUrl: novo.fonteUrl, observadoEm: novo.observadoEm, repetido: true };
        guardados.push({ ...novo, id: `00000000-0000-4000-8000-00000000000${i}`, origem: 'coletor', criadoEm: AGORA });
        return { id: guardados.at(-1)!.id, fonteUrl: novo.fonteUrl, observadoEm: novo.observadoEm, repetido: false };
      });
    },
    async listar(e) {
      return chave(e) === chave(escopo) ? guardados : [];
    },
    async arquivar(e, id) {
      chamadas.push('arquivar');
      const i = guardados.findIndex((s) => s.id === id);
      if (i < 0 || chave(e) !== chave(escopo)) return null;
      return guardados.splice(i, 1)[0]!;
    },
  };
  const service = createCulturaService(repositorio, { record: async (evento: AuditEvent) => void eventos.push(evento) } as never, {
    relogio: () => AGORA,
    resolverCliente: async (id) => (id === CLIENTE ? { organizationId: ORG, clienteId: CLIENTE } : null),
  });
  return { service, guardados, eventos, chamadas };
}

const comPapel = (papelDeQuemAge: MemberRole) => ({ ...escopo, papelDeQuemAge });

describe('serviço de sinais de cultura: escrita pela tela', () => {
  for (const papel of ['owner', 'admin', 'operator'] as const) {
    it(`${papel} cria e arquiva, com auditoria sem o conteúdo`, async () => {
      const { service, eventos } = montar();
      const criado = await service.criar({ ...comPapel(papel), dados: dados() }, ator);
      assert.ok(criado.ok);
      const arquivado = await service.arquivar({ ...comPapel(papel), sinalId: SINAL }, ator);
      assert.ok(arquivado.ok);
      assert.deepEqual(eventos.map((e) => e.action), ['client.culture_signal.create', 'client.culture_signal.archive']);
      assert.ok(!JSON.stringify(eventos).includes('Corrida de rua'));
    });
  }

  it('viewer não escreve nem arquiva e nada chega ao repositório', async () => {
    const { service, chamadas } = montar();
    const criar = await service.criar({ ...comPapel('viewer'), dados: dados() }, ator);
    const arquivar = await service.arquivar({ ...comPapel('viewer'), sinalId: SINAL }, ator);
    assert.ok(!criar.ok && criar.error.code === 'forbidden');
    assert.ok(!arquivar.ok && arquivar.error.code === 'forbidden');
    assert.deepEqual(chamadas, []);
  });

  it('valida antes de gravar e devolve o campo com problema', async () => {
    const { service, chamadas } = montar();
    const r = await service.criar({ ...comPapel('admin'), dados: dados({ titulo: '@perfil famoso' }) }, ator);
    assert.ok(!r.ok && r.error.code === 'validation' && 'titulo' in (r.error.details ?? {}));
    assert.deepEqual(chamadas, []);
  });

  it('mesma fonte e mesmo dia é conflito; id inválido de arquivamento é validação', async () => {
    const { service } = montar();
    await service.criar({ ...comPapel('admin'), dados: dados() }, ator);
    const repetido = await service.criar({ ...comPapel('admin'), dados: dados() }, ator);
    assert.ok(!repetido.ok && repetido.error.code === 'conflict');
    const invalido = await service.arquivar({ ...comPapel('admin'), sinalId: 'x' }, ator);
    assert.ok(!invalido.ok && invalido.error.code === 'validation');
  });

  it('organização ou cliente malformados são recusados', async () => {
    const { service } = montar();
    const r = await service.criar({ organizationId: 'x', clientId: CLIENTE, papelDeQuemAge: 'admin', dados: dados() }, ator);
    assert.ok(!r.ok && r.error.code === 'validation');
  });
});

describe('serviço de sinais de cultura: ingestão do coletor', () => {
  it('cria, é idempotente na repetição e audita só contagens', async () => {
    const { service, eventos, guardados } = montar();
    const lote = { sinais: [dados(), dados({ fonteUrl: 'https://exemplo.com.br/b' })] };
    const primeira = await service.ingerirDoColetor(CLIENTE, lote, worker);
    assert.ok(primeira.ok && primeira.value.criados === 2 && primeira.value.repetidos === 0);
    const segunda = await service.ingerirDoColetor(CLIENTE, lote, worker);
    assert.ok(segunda.ok && segunda.value.criados === 0 && segunda.value.repetidos === 2);
    assert.equal(guardados.length, 2);
    assert.ok(guardados.every((s) => s.origem === 'coletor'));
    assert.deepEqual(eventos[0]!.metadata, { enviados: 2, criados: 2, repetidos: 0 });
    assert.equal(eventos[0]!.actorType, 'worker');
  });

  it('repetido dentro do próprio lote conta uma vez', async () => {
    const { service } = montar();
    const r = await service.ingerirDoColetor(CLIENTE, { sinais: [dados(), dados({ titulo: 'Outro' })] }, worker);
    assert.ok(r.ok && r.value.itens.length === 1);
  });

  it('lote inválido não grava nada; cliente desconhecido ou malformado dá o mesmo not_found', async () => {
    const { service, chamadas } = montar();
    const invalido = await service.ingerirDoColetor(CLIENTE, { sinais: [dados(), dados({ nota: 'Z' })] }, worker);
    assert.ok(!invalido.ok && invalido.error.code === 'validation');
    assert.deepEqual(chamadas, []);
    const desconhecido = await service.ingerirDoColetor('99999999-9999-4999-8999-999999999999', { sinais: [dados()] }, worker);
    const malformado = await service.ingerirDoColetor('nao-uuid', { sinais: [dados()] }, worker);
    const nulo = await service.ingerirDoColetor(null, { sinais: [dados()] }, worker);
    for (const r of [desconhecido, malformado, nulo]) assert.ok(!r.ok && r.error.code === 'not_found' && r.error.message === 'Cliente não encontrado.');
  });

  it('o coletor não escolhe a origem: campo origem no item é recusado', async () => {
    const { service } = montar();
    const r = await service.ingerirDoColetor(CLIENTE, { sinais: [dados({ origem: 'manual' })] }, worker);
    assert.ok(!r.ok && r.error.code === 'validation');
  });
});

describe('serviço de sinais de cultura: recusa do banco', () => {
  function comRepositorio(sobrescrito: Partial<CulturaRepository>) {
    const { service } = montar();
    const base = montar();
    const repositorio = { ...(base as unknown as { repositorio?: CulturaRepository }).repositorio, ...sobrescrito } as CulturaRepository;
    return createCulturaService(repositorio, { record: async () => undefined } as never, {
      relogio: () => AGORA,
      resolverCliente: async (id) => (id === CLIENTE ? { organizationId: ORG, clienteId: CLIENTE } : null),
    });
    void service;
  }

  it('sinal que o banco recusa vira falha de validação, não erro interno', async () => {
    const service = comRepositorio({ inserir: async () => ({ ok: false, motivo: 'sinal_invalido' }) });
    const r = await service.criar({ ...escopo, papelDeQuemAge: 'operator', dados: dados() }, ator);
    assert.ok(!r.ok && r.error.code === 'validation' && r.error.message === 'Sinal inválido.');
  });

  it('no lote, a recusa do banco devolve validação com o índice do item', async () => {
    const service = comRepositorio({
      inserirLote: async () => {
        throw new SinalRecusadoPeloBanco(1);
      },
    });
    const lote = { sinais: [dados(), dados({ fonteUrl: 'https://exemplo.com.br/b' })] };
    const r = await service.ingerirDoColetor(CLIENTE, lote, worker);
    assert.ok(!r.ok && r.error.code === 'validation');
    if (!r.ok) assert.deepEqual(Object.keys(r.error.details ?? {}), ['sinais.1']);
  });
});
