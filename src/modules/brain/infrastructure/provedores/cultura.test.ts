import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../../testes/ganchos.ts');
const fx = await import('../../testes/fixtures.ts');
const { provedorDeCultura } = await import('./cultura.ts');
const { TIPOS_NO_CATALOGO_DE_CULTURA } = await import('../../domain/cultura.ts');
const { contextoDeDescoberta } = await import('../../domain/provedor.ts');
const { entradaSemSelo, selar } = await import('../../domain/entrada.ts');
const { aplicarPoliticaDeUso } = await import('../../domain/politica.ts');
const { piiNaEntrada } = await import('../../domain/privacidade.ts');
type Sinal = ReturnType<typeof fx.sinaisDeCultura>[number];

const ctx = (cultura: readonly Sinal[] | null = fx.sinaisDeCultura(), agora = fx.AGORA) =>
  contextoDeDescoberta({
    organizationId: fx.ORG,
    clienteId: fx.CLIENTE,
    agora,
    conjuntoDeDados: 'tria_dw',
    bytesMaximosPorConsulta: 1,
    inventario: fx.inventario(),
    contexto: null,
    cultura,
  });

const descobrir = (cultura?: readonly Sinal[] | null, agora?: Date) => provedorDeCultura.descobrir(ctx(cultura, agora)) as ReturnType<typeof selar>[];
const porId = <T extends { id: string }>(entradas: readonly T[], id: string): T => entradas.find((e) => e.id === id)!;

describe('provedor culture', () => {
  it('declara os seis tipos, fase primária e id culture', () => {
    assert.equal(provedorDeCultura.id, 'culture');
    assert.equal(provedorDeCultura.fase, 'primaria');
    assert.deepEqual([...provedorDeCultura.tiposDeclarados], [...TIPOS_NO_CATALOGO_DE_CULTURA]);
    assert.equal(provedorDeCultura.tiposDeclarados.length, 6);
  });

  it('projeta URN com o id do sinal, evidência de benchmark, resumo e conteúdo não confiável', () => {
    const entradas = descobrir();
    const tendencia = porId(entradas, 'c0de0001-0000-4000-8000-000000000001');
    assert.equal(tendencia.tipo, 'culture_tendencia');
    assert.equal(tendencia.urn, `orla:${fx.ORG}:${fx.CLIENTE}:culture_tendencia:c0de0001-0000-4000-8000-000000000001`);
    assert.equal(tendencia.valorResumido, 'Resumo do sinal c0de0001-0000-4000-8000-000000000001.');
    assert.equal(tendencia.evidencia?.categoria, 'benchmark');
    assert.equal(tendencia.evidencia?.nota, 'A');
    assert.equal(tendencia.evidencia?.validoAte, '2026-12-10');
    assert.equal(tendencia.evidencia?.dataDaFonte, '2026-11-10');
    assert.ok(entradas.every((e) => e.conteudoNaoConfiavel === true && e.tags.includes('conteudo_nao_confiavel')));
    for (const e of entradas) assert.ok(entradaSemSelo.safeParse(e).success, e.id);
  });

  it('não envia o link da fonte, só o domínio', () => {
    const serializado = JSON.stringify(descobrir());
    assert.ok(!serializado.includes('https://'));
    assert.ok(serializado.includes('fonte.exemplo.com.br'));
  });

  it('sinal vencido sai do catálogo e o último dia de validade ainda entra', () => {
    const ids = descobrir().map((e) => e.id);
    assert.ok(!ids.includes('c0de0007-0000-4000-8000-000000000007'));
    assert.equal(ids.length, 6);
    const noUltimoDia = descobrir(undefined, new Date('2026-12-10T15:00:00Z'));
    assert.equal(noUltimoDia.length, 6);
    assert.equal(descobrir(undefined, new Date('2026-12-11T15:00:00Z')).length, 0);
  });

  it('marca epistêmica por nota e revisão pela origem', () => {
    const entradas = descobrir();
    assert.equal(porId(entradas, 'c0de0001-0000-4000-8000-000000000001').epistemico?.marca, 'fato');
    assert.equal(porId(entradas, 'c0de0002-0000-4000-8000-000000000002').epistemico?.marca, 'hipotese');
    assert.equal(porId(entradas, 'c0de0002-0000-4000-8000-000000000002').epistemico?.revisao, 'sugerido');
    assert.equal(porId(entradas, 'c0de0003-0000-4000-8000-000000000003').epistemico?.revisao, 'confirmado');
  });

  it('nota D leva aviso de que não sustenta meta; referência e anti-referência não são prova', () => {
    const entradas = descobrir();
    assert.ok(porId(entradas, 'c0de0004-0000-4000-8000-000000000004').qualidade.avisos.some((a) => a.includes('Nota D')));
    assert.ok(porId(entradas, 'c0de0005-0000-4000-8000-000000000005').qualidade.avisos.some((a) => a.includes('inspiração')));
    assert.ok(porId(entradas, 'c0de0006-0000-4000-8000-000000000006').qualidade.avisos.some((a) => a.includes('evitar')));
  });

  it('política de uso: permitido, público, sem dado pessoal; passa na política sem virar metadado', () => {
    const selada = descobrir().map((e) => selar(e));
    assert.ok(selada.every((e) => e.sensibilidade.usoPorAgente === 'permitido' && e.sensibilidade.nivel === 'publico' && !e.sensibilidade.piiPossivel));
    const politica = aplicarPoliticaDeUso(selada);
    assert.equal(politica.omitidas, 0);
    assert.equal(politica.restritas, 0);
    for (const e of selada) assert.deepEqual(piiNaEntrada(e), [], e.urn);
  });

  it('texto com dado pessoal que escapou do cadastro é neutralizado no catálogo', () => {
    const sujo: Sinal = { ...fx.sinaisDeCultura()[0]!, titulo: 'Fale com maria@exemplo.com.br', resumo: 'Telefone (11) 99999-8888 no vídeo' };
    const [entrada] = descobrir([sujo]);
    assert.ok(entrada);
    const selada = selar(entrada);
    assert.deepEqual(piiNaEntrada(selada), []);
    assert.ok(!JSON.stringify(selada).includes('maria@'));
  });

  it('saída determinística e URNs únicas', () => {
    const a = descobrir();
    const b = descobrir();
    assert.deepEqual(a.map((e) => selar(e).hash), b.map((e) => selar(e).hash));
    assert.equal(new Set(a.map((e) => e.urn)).size, a.length);
  });

  it('saúde: indisponível sem leitura, radar sem sinal vigente quando todos vencidos ou nenhum', () => {
    assert.equal(provedorDeCultura.saude(ctx(null)).status, 'indisponivel');
    assert.deepEqual(provedorDeCultura.saude(ctx()), { status: 'ok', motivo: null });
    const soVencido = provedorDeCultura.saude(ctx([fx.sinaisDeCultura()[6]!]));
    assert.equal(soVencido.status, 'ok');
    assert.match(soVencido.motivo ?? '', /Radar sem sinal vigente/);
    assert.match(provedorDeCultura.saude(ctx([])).motivo ?? '', /Radar sem sinal vigente/);
    assert.deepEqual(provedorDeCultura.descobrir(ctx(null)), []);
  });
});
