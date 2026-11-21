import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AcaoRecomendada } from '../../../brain/domain/diagnostico.ts';
import {
  acaoPrincipal,
  acoesComConexoesDoCliente,
  blocoDeConexoes,
  blocoDeContexto,
  lacunasDaProntidao,
  prontidaoDoCliente,
  vereditoDeProntidao,
  type ConexaoDoCliente,
} from './prontidao.ts';

const CLIENTE = '95ec64b4-c5b9-43ff-909d-d258d91e8b7c';
const INTEIRA = { podeEditar: true, organizacaoInteira: true };

function acao(id: string, tipo: AcaoRecomendada['tipo'], impacto: number, titulo = `titulo ${id}`, alvo: string | null = null): AcaoRecomendada {
  return { id, tipo, impacto, titulo, motivo: 'm', alvo };
}

function conexao(sobrescrever: Partial<ConexaoDoCliente> & { id: string; platform: string }): ConexaoDoCliente {
  return { rotulo: sobrescrever.platform === 'meta' ? 'Meta Ads' : 'Google Ads', precisaReautorizar: false, fontesDoCliente: 1, ...sobrescrever };
}

const resumoVazio = {
  conectores: { conectado: 0, precisa_reautorizar: 0, conexao_sem_vinculo: 0, nao_conectado: 3, fora_da_coleta: 0 },
  fontes: { fresco: 0, atrasado: 0, parado: 0, desconhecido: 0 },
  capacidades: { disponivel: 0, parcial: 0, indisponivel: 0 },
  contexto: { disponivel: true, geral: 0, essenciaisCompletos: false },
  acoes: 0,
};

function diagnostico(sobrescrever: Partial<typeof resumoVazio> = {}, acoes: readonly AcaoRecomendada[] = [], contexto: Parameters<typeof blocoDeContexto>[0]['contexto'] = null) {
  return { resumo: { ...resumoVazio, ...sobrescrever }, conectores: [], fontes: [], contexto, acoes };
}

describe('veredito de prontidão', () => {
  it('sim só quando todas as capacidades estão disponíveis', () => {
    assert.equal(vereditoDeProntidao(['disponivel', 'disponivel']), 'sim');
  });
  it('não quando nada está disponível nem parcial, e quando não há capacidade avaliada', () => {
    assert.equal(vereditoDeProntidao(['indisponivel', 'indisponivel']), 'nao');
    assert.equal(vereditoDeProntidao([]), 'nao');
  });
  it('parcial em qualquer mistura', () => {
    assert.equal(vereditoDeProntidao(['disponivel', 'indisponivel']), 'parcial');
    assert.equal(vereditoDeProntidao(['parcial', 'indisponivel']), 'parcial');
  });
});

describe('lacunas da prontidão', () => {
  it('até 3, ordenadas pelo peso e desempatadas pelo id', () => {
    const lacunas = lacunasDaProntidao([acao('b', 'conectar', 50), acao('r', 'reautorizar', 100), acao('a', 'conectar', 50), acao('c', 'conectar', 10)]);
    assert.deepEqual(lacunas.map((l) => l.id), ['r', 'a', 'b']);
  });
});

describe('reautorização só das conexões do cliente', () => {
  it('cliente sem fontes na conexão não mostra reautorização', () => {
    const acoes = acoesComConexoesDoCliente([], [conexao({ id: 'c1', platform: 'meta', precisaReautorizar: true, fontesDoCliente: 0 })]);
    assert.equal(acoes.length, 0);
  });
  it('só a conexão em reautorização que tem fontes do cliente vira ação, e ela aponta para a conexão', () => {
    const acoes = acoesComConexoesDoCliente(
      [],
      [conexao({ id: 'meta-1', platform: 'meta', precisaReautorizar: true }), conexao({ id: 'google-1', platform: 'google' })],
    );
    assert.deepEqual(acoes.map((a) => a.id), ['reautorizar:meta']);
    assert.equal(acoes[0]!.alvo, 'meta-1');
  });
  it('ação de reautorizar herdada do diagnóstico de outra conexão da organização é descartada', () => {
    const herdada = acao('reautorizar:meta', 'reautorizar', 100);
    const acoes = acoesComConexoesDoCliente([herdada, acao('conectar:x', 'conectar', 60)], [conexao({ id: 'g', platform: 'google' })]);
    assert.deepEqual(acoes.map((a) => a.id), ['conectar:x']);
  });
  it('desempata pelo número de fontes do cliente afetadas, depois pelo id', () => {
    const acoes = acoesComConexoesDoCliente(
      [],
      [
        conexao({ id: 'g', platform: 'google', precisaReautorizar: true, fontesDoCliente: 1 }),
        conexao({ id: 'm', platform: 'meta', precisaReautorizar: true, fontesDoCliente: 3 }),
      ],
    );
    assert.equal(acaoPrincipal(acoes, CLIENTE, INTEIRA)?.rotulo, 'Reautorizar Meta Ads');
  });
  it('duas conexões da mesma plataforma viram uma ação, apontando para a com mais fontes', () => {
    const acoes = acoesComConexoesDoCliente(
      [],
      [conexao({ id: 'a', platform: 'meta', precisaReautorizar: true, fontesDoCliente: 1 }), conexao({ id: 'b', platform: 'meta', precisaReautorizar: true, fontesDoCliente: 4 })],
    );
    assert.equal(acoes.length, 1);
    assert.equal(acoes[0]!.alvo, 'b');
  });
});

describe('ação principal do cabeçalho', () => {
  it('reautorizar passa na frente de enviar mapa e usa a página da conexão', () => {
    const acoes = [acao('preencher:empresa', 'preencher_contexto', 38), acao('reautorizar:meta', 'reautorizar', 100, 'Reautorizar Meta Ads', 'conexao-9')];
    const principal = acaoPrincipal(acoes, CLIENTE, INTEIRA);
    assert.equal(principal?.rotulo, 'Reautorizar Meta Ads');
    assert.equal(principal?.href, '/integracoes/conexao-9');
  });
  it('sem reautorização, contexto vazio vira enviar mapa', () => {
    const principal = acaoPrincipal([acao('preencher:empresa', 'preencher_contexto', 38)], CLIENTE, INTEIRA);
    assert.equal(principal?.rotulo, 'Enviar mapa');
    assert.equal(principal?.href, `/clientes/${CLIENTE}/conexoes?secao=pedir&enviar=contexto`);
  });
  it('anunciante: contexto vira preencher e conectar vira conectar conta, reautorizar segue específico', () => {
    const anunciante = { ...INTEIRA, tipo: 'advertiser' as const };
    const contexto = acaoPrincipal([acao('preencher:empresa', 'preencher_contexto', 38)], CLIENTE, anunciante);
    assert.equal(contexto?.rotulo, 'Preencher contexto');
    assert.ok(!contexto?.href.includes('pedir'));
    assert.equal(acaoPrincipal([acao('conectar:meta', 'conectar', 60, 'Conectar Meta Ads')], CLIENTE, anunciante)?.rotulo, 'Conectar conta');
    const reauth = acaoPrincipal([acao('reautorizar:google', 'reautorizar', 100, 'Reautorizar Google Ads', 'g1'), acao('conectar:meta', 'conectar', 60)], CLIENTE, anunciante);
    assert.equal(reauth?.rotulo, 'Reautorizar Google Ads');
  });
  it('membro recortado só recebe ação de contexto', () => {
    const acoes = [acao('reautorizar:google', 'reautorizar', 100), acao('preencher:empresa', 'preencher_contexto', 38)];
    const principal = acaoPrincipal(acoes, CLIENTE, { podeEditar: true, organizacaoInteira: false });
    assert.equal(principal?.id, 'preencher:empresa');
    assert.equal(principal?.rotulo, 'Preencher contexto');
    assert.equal(acaoPrincipal([acao('reautorizar:google', 'reautorizar', 100)], CLIENTE, { podeEditar: true, organizacaoInteira: false }), null);
  });
  it('rótulo específico para conectar; só conectar e vincular escondem o botão de Fontes', () => {
    const conectar = acaoPrincipal([acao('conectar:meta', 'conectar', 60, 'Conectar Meta Ads')], CLIENTE, INTEIRA);
    assert.equal(conectar?.rotulo, 'Conectar Meta Ads');
    assert.equal(conectar?.ehConexao, true);
    const reauth = acaoPrincipal([acao('reautorizar:meta', 'reautorizar', 100, 'Reautorizar Meta Ads')], CLIENTE, INTEIRA);
    assert.equal(reauth?.ehConexao, false);
  });
  it('sem pendência não há botão, e quem só consulta não recebe ação', () => {
    assert.equal(acaoPrincipal([], CLIENTE, INTEIRA), null);
    assert.equal(acaoPrincipal([acao('reautorizar:google', 'reautorizar', 100)], CLIENTE, { ...INTEIRA, podeEditar: false }), null);
  });
});

describe('estado dos dois blocos', () => {
  it('conexões: reautorizar > vazio > atenção > ok, só pelas ações do cliente', () => {
    assert.equal(blocoDeConexoes(diagnostico({}, [acao('r', 'reautorizar', 100)])).tom, 'critico');
    const outraConexao = diagnostico({ conectores: { ...resumoVazio.conectores, precisa_reautorizar: 1, conectado: 1 } });
    assert.notEqual(blocoDeConexoes(outraConexao).tom, 'critico');
    assert.equal(blocoDeConexoes(diagnostico()).tom, 'vazio');
    const atrasado = diagnostico({ conectores: { ...resumoVazio.conectores, conectado: 1 }, fontes: { ...resumoVazio.fontes, atrasado: 1 } });
    assert.equal(blocoDeConexoes(atrasado).tom, 'atencao');
    const ok = diagnostico({ conectores: { ...resumoVazio.conectores, conectado: 1 }, fontes: { ...resumoVazio.fontes, fresco: 1 } });
    assert.equal(blocoDeConexoes(ok).tom, 'ok');
  });
  it('o próximo passo de cada bloco é a ação de maior peso do seu tipo', () => {
    const acoes = [acao('p', 'preencher_contexto', 38, 'Preencher empresa'), acao('c', 'conectar', 60, 'Conectar Meta Ads'), acao('r', 'reautorizar', 100, 'Reautorizar Google Ads')];
    assert.equal(blocoDeConexoes(diagnostico({}, acoes)).proximoPasso, 'Reautorizar Google Ads');
    assert.equal(blocoDeContexto(diagnostico({}, acoes)).proximoPasso, 'Preencher empresa');
  });
  it('contexto: vazio, parcial e completo', () => {
    const base = { geral: 0, essenciaisCompletos: false, secoes: [], contradicoes: [], sugestoesPendentes: 0 };
    assert.equal(blocoDeContexto(diagnostico({}, [], null)).tom, 'vazio');
    assert.equal(blocoDeContexto(diagnostico({}, [], base)).tom, 'vazio');
    assert.equal(blocoDeContexto(diagnostico({}, [], { ...base, geral: 40 })).rotulo, 'Parcial');
    assert.equal(blocoDeContexto(diagnostico({}, [], { ...base, geral: 90, essenciaisCompletos: true })).rotulo, 'Completo');
  });
});

describe('prontidão do cliente', () => {
  it('junta veredito das capacidades, lacunas e blocos', () => {
    const p = prontidaoDoCliente({ capacidades: [{ status: 'disponivel' }, { status: 'parcial' }], diagnostico: diagnostico({}, [acao('r', 'reautorizar', 100)]) });
    assert.equal(p.veredito, 'parcial');
    assert.equal(p.lacunas.length, 1);
  });
  it('veredito não é sim com reautorização pendente, e lacunas ignoram o que não bloqueia', () => {
    const acoes = [acao('r', 'reautorizar', 100), acao('c', 'confirmar_sugestoes', 90), acao('l', 'recuperar_lacuna', 80)];
    const p = prontidaoDoCliente({ capacidades: [{ status: 'disponivel' }], diagnostico: diagnostico({}, acoes) });
    assert.equal(p.veredito, 'parcial');
    assert.deepEqual(p.lacunas.map((l) => l.id), ['r']);
  });
});
