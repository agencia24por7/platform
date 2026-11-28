import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visaoDasRevisoes, visaoDosPedidos, type ConviteDaAtividade, type LinkDaAtividade } from './atividade.ts';

const AGORA = new Date('2026-11-27T12:00:00Z');
const DIA = 86_400_000;
const em = (dias: number) => new Date(AGORA.getTime() + dias * DIA);

const convite = (id: string, status: string, expiraEmDias: number, criadoHaDias = 1): ConviteDaAtividade => ({
  id,
  token: `token-${id}`,
  status,
  expiresAt: em(expiraEmDias),
  createdAt: em(-criadoHaDias),
  items: [{ id: `${id}-1`, platform: 'google', status: 'pending' }],
});

const link = (id: string, estado: string, extra: Partial<LinkDaAtividade> = {}): LinkDaAtividade => ({
  id,
  estado,
  secoes: ['empresa', 'produtos'],
  expiraEm: em(10),
  criadoEm: em(-2),
  ultimoUsoEm: null,
  concluidoEm: null,
  conviteDeIntegracaoId: null,
  ...extra,
});

describe('atividade: pedidos ao cliente', () => {
  it('pendente é só convite em aberto e não vencido; o resto vai ao histórico', () => {
    const visao = visaoDosPedidos(
      { convites: [convite('a', 'pending', 3), convite('b', 'pending', -1), convite('c', 'revoked', 3)], links: [link('l1', 'ativo'), link('l2', 'expirado')], pedidosDeParceiro: [], nomeDaSecao: (c) => c.toUpperCase() },
      AGORA,
    );
    assert.deepEqual(visao.convitesPendentes.map((c) => c.id), ['a']);
    assert.equal(visao.totalPendente, 2);
    assert.equal(visao.linksAtivos[0]?.secoes, 'EMPRESA, PRODUTOS');
    assert.equal(visao.linksAtivos[0]?.uso, 'ainda não aberto');
    const estados = Object.fromEntries(visao.historico.map((h) => [h.chave, h.estado]));
    assert.deepEqual(estados['convite-b'], { rotulo: 'Expirado', tom: 'neutro' });
    assert.deepEqual(estados['convite-c'], { rotulo: 'Revogado', tom: 'neutro' });
    assert.deepEqual(estados['link-l2'], { rotulo: 'Expirado', tom: 'neutro' });
  });

  it('histórico vem do mais recente para o mais antigo e pedido de parceiro sem status final fica em andamento', () => {
    const visao = visaoDosPedidos(
      {
        convites: [convite('velho', 'completed', 3, 9)],
        links: [link('enviado', 'expirado', { concluidoEm: em(-1), criadoEm: em(-5) })],
        pedidosDeParceiro: [{ id: 'p', status: 'queued', targetExternalId: 'act_1', outcome: null, createdAt: em(-1) }],
        nomeDaSecao: (c) => c,
      },
      AGORA,
    );
    assert.deepEqual(visao.historico.map((h) => h.chave), ['parceiro-p', 'link-enviado', 'convite-velho']);
    assert.deepEqual(visao.historico[0]?.estado, { rotulo: 'Em andamento', tom: 'atencao' });
    assert.deepEqual(visao.historico[1]?.estado, { rotulo: 'Enviado', tom: 'ok' });
    assert.equal(visao.historico[0]?.detalhe, 'act_1');
  });
});

describe('atividade: histórico do contexto', () => {
  it('usa o rótulo do catálogo, corta valores longos e conta as diferenças ocultas', () => {
    const diferencas = Array.from({ length: 8 }, (_, i) => ({ chave: `k${i}`, antes: null, depois: 'x'.repeat(200) }));
    const [revisao] = visaoDasRevisoes(
      [{ id: 'r', secao: 'empresa', chave: 'nome_empresa', operacao: 'alterar', viaLink: true, em: em(-1), diferencas }],
      [{ key: 'empresa', letra: 'A', titulo: 'Empresa', campos: [{ key: 'nome_empresa', rotulo: 'Nome da empresa' }] }],
      AGORA,
    );
    assert.equal(revisao?.secao, 'A · Empresa');
    assert.equal(revisao?.campo, 'Nome da empresa');
    assert.equal(revisao?.origem, 'cliente');
    assert.equal(revisao?.operacao, 'Alterado');
    assert.equal(revisao?.diferencas.length, 6);
    assert.equal(revisao?.diferencasOcultas, 2);
    assert.equal(revisao?.diferencas[0]?.antes, '∅');
    assert.equal(revisao?.diferencas[0]?.depois.length, 80);
  });
});
