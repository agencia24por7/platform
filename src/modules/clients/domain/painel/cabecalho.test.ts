import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { visaoDoCabecalho, type ClienteDoCabecalho } from './cabecalho.ts';

const ID = '95ec64b4-c5b9-43ff-909d-d258d91e8b7c';
const cliente: ClienteDoCabecalho = { id: ID, name: 'credaz', segment: 'emprestimo', businessModel: 'leads', status: 'active', parentClientId: null };
const base = { cliente, prontidao: null, lacunasDeRegras: [], podeDefinirLimite: true, podeEditar: true, hashDaLogo: null };
const lacuna = { id: 'l1', titulo: 'Conectar Google Ads', impacto: 3 };

describe('cabeçalho do cliente', () => {
  it('fatos, situação e inicial vêm prontos para renderizar', () => {
    const visao = visaoDoCabecalho({ ...base, cliente: { ...cliente, parentClientId: 'rede' } });
    assert.deepEqual(visao.fatos, ['Geração de leads', 'emprestimo', 'Unidade de uma rede']);
    assert.deepEqual(visao.situacao, { rotulo: 'Ativo', tom: 'ok' });
    assert.equal(visao.inicial, 'C');
  });

  it('com logo usa a rota autenticada com versão; sem logo, quem edita recebe o atalho para enviar', () => {
    const comLogo = visaoDoCabecalho({ ...base, hashDaLogo: 'f'.repeat(64) });
    assert.equal(comLogo.logo, `/api/contexto/${ID}/logo?v=${'f'.repeat(16)}`);
    assert.equal(comLogo.pedirLogo, null);
    assert.equal(visaoDoCabecalho(base).pedirLogo, `/clientes/${ID}/contexto?secao=marca&campo=logo#mapa-de-contexto`);
    assert.equal(visaoDoCabecalho({ ...base, podeEditar: false }).pedirLogo, null);
  });

  it('pronto para planejar soma as lacunas do planejamento e de Regras, e Regras faltando rebaixa o sim', () => {
    const visao = visaoDoCabecalho({ ...base, prontidao: { veredito: 'sim', lacunas: [lacuna] }, lacunasDeRegras: [{ chave: 'cpa_maximo', nome: 'CPA máximo' }] });
    assert.equal(visao.prontidao?.rotulo, 'Parcial');
    assert.equal(visao.prontidao?.tom, 'atencao');
    assert.equal(visao.prontidao?.contagem, '1 sugestão');
    assert.deepEqual(visao.prontidao?.lacunas, []);
    assert.match(visao.prontidao?.lacunasDeRegras[0]?.href ?? '', /secao=registrar&natureza=limite&definicao=cpa_maximo/);
  });

  it('quem não define limite vê a lacuna sem link, e sem dado nenhum não há bloco', () => {
    const visao = visaoDoCabecalho({ ...base, prontidao: { veredito: 'parcial', lacunas: [lacuna] }, lacunasDeRegras: [{ chave: 'k', nome: 'K' }], podeDefinirLimite: false });
    assert.equal(visao.prontidao?.contagem, '2 sugestões');
    assert.equal(visao.prontidao?.lacunasDeRegras[0]?.href, null);
    assert.equal(visaoDoCabecalho(base).prontidao, null);
  });
});
