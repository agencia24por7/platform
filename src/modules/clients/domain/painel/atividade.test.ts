import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOGO, type CampoSimples } from '../contexto/catalogo.ts';
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
    assert.equal(visao.descricao, '2 esperando resposta.');
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
      CATALOGO,
      AGORA,
    );
    assert.equal(revisao?.secao, 'A · Empresa');
    assert.equal(revisao?.campo, CATALOGO[0]!.campos.find((c) => c.key === 'nome_empresa')?.rotulo);
    assert.equal(revisao?.origem, 'cliente');
    assert.equal(revisao?.operacao, 'Alterado');
    assert.equal(revisao?.diferencas.length, 6);
    assert.equal(revisao?.diferencasOcultas, 2);
    assert.equal(revisao?.diferencas[0]?.antes, '∅');
    assert.equal(revisao?.diferencas[0]?.depois.length, 80);
  });

  it('mostra o valor como na tela: reais, rótulo da opção e subcampo da lista', () => {
    const simples = CATALOGO.flatMap((secao) => secao.campos.map((campo) => ({ secao: secao.key, campo })));
    const dinheiro = simples.find((x) => x.campo.tipo === 'dinheiro')!;
    const selecao = simples.find((x) => x.campo.tipo === 'selecao')! as { secao: string; campo: Extract<CampoSimples, { tipo: 'selecao' }> };
    const lista = simples.find((x) => x.campo.tipo === 'lista' && x.campo.item.some((i) => i.tipo === 'texto'))!;
    const sub = lista.campo.tipo === 'lista' ? lista.campo.item.find((i) => i.tipo === 'texto')! : null;
    const revisoes = visaoDasRevisoes(
      [
        { id: 'd', secao: dinheiro.secao, chave: dinheiro.campo.key, operacao: 'alterar', viaLink: false, em: em(-1), diferencas: [{ chave: 'valor', antes: 1500000, depois: 2000000 }] },
        { id: 's', secao: selecao.secao, chave: selecao.campo.key, operacao: 'criar', viaLink: false, em: em(-1), diferencas: [{ chave: 'valor', antes: null, depois: selecao.campo.opcoes[0]!.valor }] },
        { id: 'l', secao: lista.secao, chave: lista.campo.key, operacao: 'alterar', viaLink: false, em: em(-1), diferencas: [{ chave: sub!.key, antes: 'a', depois: 'b' }] },
      ],
      CATALOGO,
      AGORA,
    );
    assert.match(revisoes[0]?.diferencas[0]?.antes ?? '', /15\.000,00/);
    assert.match(revisoes[0]?.diferencas[0]?.depois ?? '', /20\.000,00/);
    assert.equal(revisoes[1]?.diferencas[0]?.depois, selecao.campo.opcoes[0]!.rotulo);
    assert.equal(revisoes[2]?.diferencas[0]?.chave, sub!.rotulo);
  });

  it('metadados com rótulo do app, valor primeiro e sem ruído no primeiro preenchimento', () => {
    const [criada, alterada] = visaoDasRevisoes(
      [
        { id: 'c', secao: 'empresa', chave: 'nome_empresa', operacao: 'criar', viaLink: false, em: em(-1), diferencas: [{ chave: 'epistemic', antes: null, depois: 'fato' }, { chave: 'shareable', antes: null, depois: false }, { chave: 'valor', antes: null, depois: 'Credaz' }] },
        { id: 'a', secao: 'empresa', chave: 'nome_empresa', operacao: 'alterar', viaLink: false, em: em(-1), diferencas: [{ chave: 'shareable', antes: false, depois: true }, { chave: 'epistemic', antes: 'fato', depois: 'hipotese' }, { chave: 'source', antes: 'equipe', depois: 'cliente' }] },
      ],
      CATALOGO,
      AGORA,
    );
    assert.deepEqual(criada?.diferencas, [{ chave: 'Valor', antes: '∅', depois: 'Credaz' }]);
    assert.deepEqual(alterada?.diferencas.map((d) => d.chave), ['Visível ao cliente', 'Natureza', 'Fonte']);
    assert.deepEqual(alterada?.diferencas[0], { chave: 'Visível ao cliente', antes: 'Não', depois: 'Sim' });
    assert.equal(alterada?.diferencas[1]?.depois, 'Hipótese');
  });
});
