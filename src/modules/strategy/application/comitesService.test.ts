import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';
import type { AuditEvent } from '@/modules/audit/domain/auditEvent';

const { createComitesService } = await import('./comitesService.ts');
const { criarRepositorioDosComitesEmMemoria } = await import('../infrastructure/comitesEmMemoria.ts');
const { visaoDosComites, tarefasForaDosComites, VALOR_DO_MODELO_PADRAO } = await import('../interface/comitesNaConfiguracao.ts');
const { COMITES } = await import('../domain/comite/comites.ts');

const ORG = '11111111-1111-4111-8111-111111111111';
const ATOR = { userId: '55555555-5555-4555-8555-555555555555', requestId: 'req-12345678', sourceIp: null };

function montar() {
  const repositorio = criarRepositorioDosComitesEmMemoria();
  const eventos: AuditEvent[] = [];
  const servico = createComitesService({ repositorio, audit: { async record(e) { eventos.push(e); }, async list() { return []; }, async search() { return []; } } });
  return { repositorio, eventos, servico };
}

describe('configuração dos comitês do planejador (24K-134)', () => {
  it('sem linha, todo comitê está ligado; owner e admin ligam e desligam com auditoria só da chave', async () => {
    const { servico, eventos } = montar();
    const lista = await servico.listar({ organizationId: ORG, papelDeQuemAge: 'admin' });
    assert.ok(lista.ok);
    assert.equal(lista.value.length, COMITES.length);
    assert.ok(lista.value.every((c) => c.ligado));
    assert.ok((await servico.definirLigado({ organizationId: ORG, papelDeQuemAge: 'owner' }, 'cultura', false, ATOR)).ok);
    const depois = await servico.listar({ organizationId: ORG, papelDeQuemAge: 'owner' });
    assert.ok(depois.ok);
    assert.equal(depois.value.find((c) => c.comite.chave === 'cultura')?.ligado, false);
    assert.deepEqual(eventos.map((e) => [e.action, e.metadata]), [['strategy.comite.desligado', { comite: 'cultura' }]]);
  });

  it('risco e legal fica travado ligado; comitê desconhecido é recusado; operador e leitor não mexem', async () => {
    const { servico, repositorio } = montar();
    const legal = await servico.definirLigado({ organizationId: ORG, papelDeQuemAge: 'admin' }, 'risco_legal', false, ATOR);
    assert.ok(!legal.ok && legal.error.code === 'validation');
    assert.equal(repositorio.linhas.size, 0);
    assert.ok((await servico.definirLigado({ organizationId: ORG, papelDeQuemAge: 'admin' }, 'risco_legal', true, ATOR)).ok);
    const desconhecido = await servico.definirLigado({ organizationId: ORG, papelDeQuemAge: 'admin' }, 'nao_existe', false, ATOR);
    assert.ok(!desconhecido.ok && desconhecido.error.code === 'validation');
    for (const papel of ['operator', 'viewer'] as const) {
      const r = await servico.definirLigado({ organizationId: ORG, papelDeQuemAge: papel }, 'cultura', false, ATOR);
      assert.ok(!r.ok && r.error.code === 'forbidden');
      assert.ok(!(await servico.listar({ organizationId: ORG, papelDeQuemAge: papel })).ok);
    }
  });

  it('a visão da tela mostra custo por rodada, trava de risco e legal, modelo padrão herdado e o aviso com os ligados', async () => {
    const { servico } = montar();
    await servico.definirLigado({ organizationId: ORG, papelDeQuemAge: 'admin' }, 'cultura', false, ATOR);
    const lista = await servico.listar({ organizationId: ORG, papelDeQuemAge: 'admin' });
    assert.ok(lista.ok);
    const tarefas = [
      { chave: 'comite_marca', escolha: { fornecedor: 'google', modelo: 'modelo-a' }, herdada: true, estado: 'configurada' as const },
      { chave: 'comite_redator', escolha: { fornecedor: 'google', modelo: 'modelo-b' }, herdada: false, estado: 'configurada' as const },
    ];
    const visao = visaoDosComites(lista.value, tarefas);
    const legal = visao.cartoes.find((c) => c.chave === 'risco_legal')!;
    assert.equal(legal.travado, true);
    assert.equal(legal.acao, null);
    assert.ok(legal.explicacaoDaTrava);
    assert.match(legal.custo, /^5 chamadas por rodada \(3 membros e 2 mesas\)/);
    const cultura = visao.cartoes.find((c) => c.chave === 'cultura')!;
    assert.equal(cultura.estado.rotulo, 'Desligado');
    assert.equal(cultura.acao?.ligado, 'sim');
    assert.equal(visao.cartoes.find((c) => c.chave === 'marca')!.modelo.valor, VALOR_DO_MODELO_PADRAO);
    assert.match(visao.cartoes.find((c) => c.chave === 'marca')!.modelo.estado.rotulo, /modelo padrão/);
    assert.equal(visao.cartoes.find((c) => c.chave === 'redator')!.modelo.valor, 'google|modelo-b');
    assert.equal(visao.chamadasPorRodada, 69 - 4);
    assert.match(visao.aviso, /16 comitês ligados.*65 chamadas/);
    assert.deepEqual(tarefasForaDosComites([{ chave: 'comite' }, { chave: 'comite_marca', herdaDe: 'comite' }]).map((t) => t.chave), ['comite']);
  });
});
