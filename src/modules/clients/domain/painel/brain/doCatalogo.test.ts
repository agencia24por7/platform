import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../../../../brain/testes/ganchos.ts');
const fx = await import('../../../../brain/testes/fixtures.ts');
const { construirCatalogo } = await import('../../../../brain/application/construirCatalogo.ts');
const { PROVEDORES } = await import('../../../../brain/infrastructure/provedores/index.ts');
const { DEFINICOES_DE_CAPACIDADES } = await import('../../../../brain/dados/capacidades.ts');
const { CONECTORES_POSSIVEIS, plataformasDaTabela } = await import('../../../../brain/dados/registro.ts');
const { brainDoCatalogo, serieDosUltimos90Dias, acaoDaVisao } = await import('./doCatalogo.ts');
const { montarMapa } = await import('./mapa.ts');

const snapshot = () =>
  construirCatalogo(
    { provedores: PROVEDORES, capacidades: DEFINICOES_DE_CAPACIDADES, conectores: CONECTORES_POSSIVEIS, plataformasDaTabela },
    {
      organizationId: fx.ORG,
      clienteId: fx.CLIENTE,
      agora: fx.AGORA,
      conjuntoDeDados: 'tria_dw',
      bytesMaximosPorConsulta: 10_000_000_000,
      inventario: fx.inventario(),
      contexto: fx.contexto(),
    },
  );

describe('visão do Brain a partir do catálogo real', () => {
  it('converte entradas, capacidades, ações e o catalogo.md', async () => {
    const s = await snapshot();
    const brain = brainDoCatalogo(s, fx.AGORA);
    assert.equal(brain.origem, 'real');
    assert.equal(brain.hash, s.catalogHash.slice(0, 16));
    assert.ok(brain.entradas.length > 0);
    assert.ok(brain.entradas.every((e) => e.urn.length > 0));
    assert.equal(brain.capacidades.length, s.capacidades.length);
    assert.match(brain.catalogoMd, /^# Catálogo do cliente/);
    assert.ok(brain.pulso.saude >= 0 && brain.pulso.saude <= 100);
    const tabela = brain.entradas.find((e) => e.tipo === 'tabela_de_dados');
    assert.ok(tabela, 'há tabela de dados');
    assert.ok(tabela!.esquema.length > 0);
    assert.equal(tabela!.acesso.via, 'bigquery');
    assert.ok(brain.acoes.every((a) => a.href.startsWith('/')));
    assert.equal(montarMapa(brain).grupos.length, 4);
  });

  it('série de 90 dias respeita intervalo e lacunas', () => {
    const agora = new Date('2026-11-20T12:00:00Z');
    const serie = serieDosUltimos90Dias(
      {
        desde: '2026-11-01',
        ate: '2026-11-20',
        linhas: 10,
        diasComDado: 18,
        diasEsperados: 20,
        lacunas: [{ de: '2026-11-05', ate: '2026-11-06', dias: 2 }],
        diasFaltando: 2,
        fonteDaMedida: 'coletas',
        medidoEm: null,
      },
      agora,
    );
    assert.equal(serie?.length, 90);
    assert.equal(serie?.filter(Boolean).length, 18);
    assert.equal(serie?.[89], true);
    assert.equal(serieDosUltimos90Dias(null, agora), null);
  });

  it('ações levam ao lugar exato', () => {
    const id = '95ec64b4-c5b9-43ff-909d-d258d91e8b7c';
    assert.equal(acaoDaVisao({ id: 'conectar:ga4', tipo: 'conectar', impacto: 80, titulo: 't', motivo: 'm', alvo: null }, id).href, '/integracoes/conector/ga4');
    assert.equal(acaoDaVisao({ id: 'preencher:publico', tipo: 'preencher_contexto', impacto: 40, titulo: 't', motivo: 'm', alvo: null }, id).href, `/clientes/${id}/contexto?secao=publico`);
    assert.equal(acaoDaVisao({ id: 'investigar:x', tipo: 'investigar_coleta', impacto: 55, titulo: 't', motivo: 'm', alvo: null }, id).impacto, 2);
  });
});
