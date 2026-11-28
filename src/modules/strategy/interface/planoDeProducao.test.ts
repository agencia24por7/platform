import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLIENTE_ID, ORGANIZACAO_ID, planoCompleto } from '../domain/fixturesDeTeste.ts';
import { JANELA_DE_TESTE, URN_REFERENCIA, producaoDaBusca, producaoDoSocial } from '../domain/producao/fixturesDaProducao.ts';
import type { RegistroDeProducao } from '../application/portasDaProducao.ts';
import { ROTULO_DO_BOTAO_GERAR, escaparMarkdown, planoDeProducaoEmMarkdown, rotaDoPlanoDeProducao, visaoDoPlanoDeProducao } from './planoDeProducao.ts';

const PLANO_ID = '44444444-4444-4444-8444-444444444444';

function registro(mudanca: Partial<RegistroDeProducao> = {}): RegistroDeProducao {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    organizationId: ORGANIZACAO_ID,
    clientId: CLIENTE_ID,
    planoId: PLANO_ID,
    versaoId: '55555555-5555-4555-8555-555555555555',
    numero: 1,
    status: 'pendente',
    conteudo: null,
    progresso: {},
    erroCodigo: null,
    motivo: null,
    tentativas: 0,
    falhas: 0,
    leaseAte: null,
    agentRunId: 'producao-x',
    solicitadoPor: null,
    criadoEm: new Date('2026-11-27T12:00:00Z'),
    atualizadoEm: new Date('2026-11-27T12:00:00Z'),
    concluidoEm: null,
    redigidoEm: null,
    ...mudanca,
  };
}

const conteudo = {
  schema_version: 1 as const,
  janela: JANELA_DE_TESTE,
  campanhas: [producaoDaBusca(), producaoDoSocial()],
  referencias: [{ urn: URN_REFERENCIA, hash: 'a'.repeat(64), tipo: 'culture_referencia', titulo: 'Campanha de referência do setor' }],
};

const base = { clienteId: CLIENTE_ID, planoId: PLANO_ID, planoDeMarketing: planoCompleto() };

describe('view-model do plano de produção', () => {
  it('sem geração: botão habilitado para operator com plano autorizado, desabilitado com motivo para viewer e sem autorização', () => {
    const operador = visaoDoPlanoDeProducao({ ...base, papel: 'operator', temVersaoAutorizada: true, geracoes: [] });
    assert.deepEqual(operador.gerar, { habilitado: true, rotulo: ROTULO_DO_BOTAO_GERAR, motivo: null });
    assert.equal(operador.voltar.href.endsWith(PLANO_ID), true);
    assert.equal(rotaDoPlanoDeProducao(CLIENTE_ID, PLANO_ID).endsWith(`${PLANO_ID}/producao`), true);
    assert.equal(visaoDoPlanoDeProducao({ ...base, papel: 'viewer', temVersaoAutorizada: true, geracoes: [] }).gerar.habilitado, false);
    const semAutorizacao = visaoDoPlanoDeProducao({ ...base, papel: 'owner', temVersaoAutorizada: false, geracoes: [] });
    assert.equal(semAutorizacao.gerar.habilitado, false);
    assert.match(semAutorizacao.gerar.motivo ?? '', /autorizado/);
  });

  it('pendente: estado de geração com ícone e texto, atualização automática e botão bloqueado', () => {
    const visao = visaoDoPlanoDeProducao({ ...base, papel: 'admin', temVersaoAutorizada: true, geracoes: [{ registro: registro(), conteudo: null }] });
    assert.equal(visao.estado.icone, 'agente');
    assert.ok(visao.estado.titulo.length > 0);
    assert.equal(visao.atualizarAutomaticamente, true);
    assert.equal(visao.gerar.habilitado, false);
  });

  it('pronto: campanhas com entregáveis, custos, workflow e referência pelo título; download', () => {
    const pronto = registro({ status: 'pronto', conteudo, concluidoEm: new Date('2026-11-27T13:00:00Z') });
    const visao = visaoDoPlanoDeProducao({ ...base, papel: 'admin', temVersaoAutorizada: true, geracoes: [{ registro: pronto, conteudo }] });
    assert.equal(visao.estado.tom, 'ok');
    assert.equal(visao.atual?.campanhas.length, 2);
    const busca = visao.atual!.campanhas[0]!;
    assert.equal(busca.titulo, 'Busca de fundo de funil');
    assert.ok(busca.entregaveis[0]!.referencias[0]!.startsWith('Campanha de referência do setor'));
    assert.ok(busca.custos[0]!.includes('R$'));
    assert.ok(visao.atual!.campanhas[1]!.custos[0]!.includes('a confirmar'));
    assert.ok(visao.atual?.geracao.download?.href.includes('download?geracao='));
    assert.match(visao.gerar.rotulo, /nova versão/);
  });

  it('falhou: motivo da lista fechada, nunca o motivo técnico gravado', () => {
    const falhou = registro({ status: 'falhou', erroCodigo: 'conferencia_reprovada', motivo: 'campanha:cp_busca:x=y', concluidoEm: new Date() });
    const visao = visaoDoPlanoDeProducao({ ...base, papel: 'admin', temVersaoAutorizada: true, geracoes: [{ registro: falhou, conteudo: null }] });
    assert.equal(visao.estado.tom, 'danger');
    assert.ok(!visao.estado.texto.includes('cp_busca'));
    assert.equal(visao.gerar.habilitado, true);
  });

  it('Markdown escapa o texto do modelo', () => {
    assert.equal(escaparMarkdown('# título [link](javascript:x) <b>'), '\\# título \\[link\\]\\(javascript:x\\) \\<b\\>');
    assert.equal(escaparMarkdown('www.golpe.com/x'), 'www\\.golpe\\.com/x');
    assert.equal(escaparMarkdown('WWW.Golpe.com'), 'WWW\\.Golpe\\.com');
    assert.equal(escaparMarkdown('x\r===\r    código\u202Eoculto'), 'x \\=\\=\\=     códigooculto');
    const malicioso = { ...conteudo, campanhas: [{ ...producaoDaBusca(), conceito: '<script>alert(1)</script>\n# injetado' }, producaoDoSocial()] };
    const pronto = registro({ status: 'pronto', conteudo: malicioso, concluidoEm: new Date() });
    const visao = visaoDoPlanoDeProducao({ ...base, papel: 'admin', temVersaoAutorizada: true, geracoes: [{ registro: pronto, conteudo: malicioso }] });
    const texto = planoDeProducaoEmMarkdown({ tituloDoPlano: 'Plano', geracao: visao.atual!.geracao, janela: visao.atual!.janela, campanhas: visao.atual!.campanhas });
    assert.ok(!texto.includes('<script>'));
    assert.ok(!/^# injetado/m.test(texto));
    assert.ok(texto.includes('## Busca de fundo de funil'));
  });
});
