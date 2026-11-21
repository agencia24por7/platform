import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AcaoRecomendada } from '../../../brain/domain/diagnostico.ts';
import { acaoPrincipal, blocoDeConexoes, blocoDeContexto, lacunasDaProntidao, prontidaoDoCliente, vereditoDeProntidao } from './prontidao.ts';

const CLIENTE = '95ec64b4-c5b9-43ff-909d-d258d91e8b7c';

function acao(id: string, tipo: AcaoRecomendada['tipo'], impacto: number, titulo = id): AcaoRecomendada {
  return { id, tipo, impacto, titulo, motivo: 'm', alvo: null };
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
    const lacunas = lacunasDaProntidao([
      acao('b', 'conectar', 50),
      acao('reautorizar:google', 'reautorizar', 100),
      acao('a', 'conectar', 50),
      acao('c', 'conectar', 10),
    ]);
    assert.deepEqual(lacunas.map((l) => l.id), ['reautorizar:google', 'a', 'b']);
  });
});

describe('ação principal do cabeçalho', () => {
  it('é a primeira de diagnostico.acoes: reautorizar passa na frente de enviar mapa', () => {
    const acoes = [acao('preencher:empresa', 'preencher_contexto', 38), acao('reautorizar:google', 'reautorizar', 100, 'Reautorizar Google Ads')];
    const principal = acaoPrincipal(acoes, CLIENTE, true);
    assert.equal(principal?.id, 'reautorizar:google');
    assert.equal(principal?.rotulo, 'Reautorizar');
    assert.equal(principal?.href, '/integracoes/conector/google');
  });
  it('sem reautorização, contexto vazio vira enviar mapa', () => {
    const principal = acaoPrincipal([acao('preencher:empresa', 'preencher_contexto', 38)], CLIENTE, true);
    assert.equal(principal?.rotulo, 'Enviar mapa');
    assert.equal(principal?.href, `/clientes/${CLIENTE}/conexoes?secao=pedir&enviar=contexto`);
  });
  it('anunciante: mesma primeira ação, mas com copy de quem faz sozinho', () => {
    const contexto = acaoPrincipal([acao('preencher:empresa', 'preencher_contexto', 38)], CLIENTE, true, 'advertiser');
    assert.equal(contexto?.rotulo, 'Preencher contexto');
    assert.ok(!contexto?.href.includes('pedir'));
    const conectar = acaoPrincipal([acao('conectar:meta', 'conectar', 60)], CLIENTE, true, 'advertiser');
    assert.equal(conectar?.rotulo, 'Conectar conta');
    const reauth = acaoPrincipal([acao('reautorizar:google', 'reautorizar', 100), acao('conectar:meta', 'conectar', 60)], CLIENTE, true, 'advertiser');
    assert.equal(reauth?.rotulo, 'Reautorizar');
  });
  it('sem pendência não há botão, e quem só consulta não recebe ação', () => {
    assert.equal(acaoPrincipal([], CLIENTE, true), null);
    assert.equal(acaoPrincipal([acao('reautorizar:google', 'reautorizar', 100)], CLIENTE, false), null);
  });
});

describe('estado dos dois blocos', () => {
  it('conexões: reautorizar > vazio > atenção > ok', () => {
    const reauth = diagnostico({ conectores: { ...resumoVazio.conectores, precisa_reautorizar: 1, conectado: 1 } });
    assert.equal(blocoDeConexoes(reauth).tom, 'critico');
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
    const p = prontidaoDoCliente({
      capacidades: [{ status: 'disponivel' }, { status: 'parcial' }],
      diagnostico: diagnostico({}, [acao('r', 'reautorizar', 100)]),
    });
    assert.equal(p.veredito, 'parcial');
    assert.equal(p.lacunas.length, 1);
  });
});
