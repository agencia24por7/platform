import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

await import('../../testes/ganchos.ts');
const fx = await import('../../testes/fixtures.ts');
const { provedorDeConhecimento, TIPOS_DE_CONHECIMENTO } = await import('./conhecimento.ts');
const { contextoDeDescoberta } = await import('../../domain/provedor.ts');
const { entradaSemSelo, selar } = await import('../../domain/entrada.ts');
const { aplicarPoliticaDeUso } = await import('../../domain/politica.ts');
const { ultimaVersaoAtiva } = await import('../../domain/conhecimento.ts');
type Entrada = ReturnType<typeof fx.conhecimento>[number];

const ctx = (conhecimento: readonly Entrada[] | null = fx.conhecimento()) =>
  contextoDeDescoberta({
    organizationId: fx.ORG,
    clienteId: fx.CLIENTE,
    agora: fx.AGORA,
    conjuntoDeDados: 'tria_dw',
    bytesMaximosPorConsulta: 1,
    inventario: fx.inventario(),
    contexto: null,
    conhecimento,
  });

const descobrir = (conhecimento?: readonly Entrada[] | null) => provedorDeConhecimento.descobrir(ctx(conhecimento)) as ReturnType<typeof selar>[];
const porId = <T extends { id: string }>(entradas: readonly T[], id: string): T => entradas.find((e) => e.id === id)!;

describe('provedor conhecimento', () => {
  it('projeta id {key}-v{version}, tipo por categoria, evidência e valorResumido', () => {
    const entradas = descobrir();
    const gordon = porId(entradas, 'gordon_2019-v1');
    assert.equal(gordon.tipo, 'conhecimento_benchmark');
    assert.equal(gordon.urn, `orla:${fx.ORG}:${fx.CLIENTE}:conhecimento_benchmark:gordon_2019-v1`);
    assert.equal(gordon.valorResumido, 'Resumo de gordon_2019.');
    assert.deepEqual(gordon.evidencia, {
      categoria: 'benchmark', nota: 'A', fonte: 'Fonte de teste (2026).', mercado: 'global', jurisdicao: 'global',
      dataDaFonte: '2026-11-24', obrigatoria: false, replicada: true,
    });
    assert.ok(entradas.every((e) => TIPOS_DE_CONHECIMENTO.includes(e.tipo) && e.conteudoNaoConfiavel === true));
    assert.ok(entradas.every((e) => e.sensibilidade.nivel === 'publico' && !e.sensibilidade.piiPossivel && e.sensibilidade.usoPorAgente === 'permitido'));
    for (const e of entradas) assert.ok(entradaSemSelo.safeParse(e).success, e.id);
  });

  it('projeta só jurisdição global e br: a União Europeia fica fora da v1', () => {
    const ids = descobrir().map((e) => e.id);
    assert.ok(ids.includes('lgpd_base_legal-v1'));
    assert.ok(!ids.includes('consent_mode-v1'));
  });

  it('marca epistêmica: A e B são fato; C e D são hipótese', () => {
    const entradas = descobrir();
    assert.equal(porId(entradas, 'rumelt_nucleo-v1').epistemico?.marca, 'fato');
    assert.equal(porId(entradas, 'gordon_2019-v1').epistemico?.marca, 'fato');
    assert.equal(porId(entradas, 'att_custo-v1').epistemico?.marca, 'hipotese');
    assert.equal(porId(entradas, 'promessa_garantida-v1').epistemico?.marca, 'hipotese');
    assert.ok(porId(entradas, 'promessa_garantida-v1').qualidade.avisos.some((a) => a.includes('Nota D')));
  });

  it('nenhuma entrada de conhecimento sai como confirmada por pessoa, nem a verificada por agente', () => {
    const entradas = descobrir();
    assert.ok(entradas.length > 0);
    assert.ok(entradas.every((e) => e.epistemico?.revisao === 'sugerido'));
    const verificadas = descobrir(fx.conhecimento().map((e) => ({ ...e, verificadoEm: '2026-11-25' })));
    assert.ok(verificadas.length > 0 && verificadas.every((e) => e.epistemico?.revisao === 'sugerido'));
  });

  it('entrada vencida aparece e é marcada, a válida não', () => {
    const entradas = descobrir();
    const vencida = porId(entradas, 'lgpd_base_legal-v1');
    assert.equal(vencida.frescor?.status, 'parado');
    assert.ok(vencida.tags.includes('vencida'));
    assert.ok(vencida.qualidade.avisos.some((a) => a.includes('vencida')));
    assert.ok(vencida.tags.includes('nao_verificada'));
    const valida = porId(entradas, 'att_custo-v1');
    assert.equal(valida.frescor?.status, 'fresco');
    assert.ok(!valida.tags.includes('vencida'));
  });

  it('regra legal sem verificação nunca é obrigatória, mesmo se o dado disser que é', () => {
    const entrada = { ...fx.conhecimento().find((e) => e.key === 'lgpd_base_legal')!, obrigatoria: true };
    assert.equal(descobrir([entrada])[0]!.evidencia?.obrigatoria, false);
    assert.equal(descobrir([{ ...entrada, verificadoEm: '2026-11-25' }])[0]!.evidencia?.obrigatoria, true);
  });

  it('texto passa por textoSeguro', () => {
    const [entrada] = descobrir([{ ...fx.conhecimento()[0]!, resumo: `Fale com ${fx.EMAIL_SENSIVEL} agora.`, fonte: `Blog de ${fx.EMAIL_SENSIVEL}` }]);
    assert.ok(!JSON.stringify(entrada).includes(fx.EMAIL_SENSIVEL));
    assert.match(entrada!.valorResumido ?? '', /\[omitido\]/);
  });

  it('hash determinístico, independente da ordem de entrada', () => {
    const a = descobrir().map((e) => selar(e).hash);
    const b = descobrir([...fx.conhecimento()].reverse()).map((e) => selar(e).hash);
    assert.deepEqual(a, b);
  });

  it('saúde: indisponível se a leitura falhou, ok caso contrário', () => {
    assert.equal(provedorDeConhecimento.saude(ctx(null)).status, 'indisponivel');
    assert.deepEqual(provedorDeConhecimento.descobrir(ctx(null)), []);
    assert.equal(provedorDeConhecimento.saude(ctx()).status, 'ok');
    assert.equal(provedorDeConhecimento.saude(ctx([])).status, 'ok');
  });

  it('a política de uso preserva a evidência mesmo quando só os metadados saem', () => {
    const selada = selar(descobrir()[0]!);
    const { entradas } = aplicarPoliticaDeUso([selar({ ...(({ hash: _h, schemaVersion: _s, ...resto }) => resto)(selada), sensibilidade: { ...selada.sensibilidade, usoPorAgente: 'restrito' } })]);
    assert.equal(entradas[0]!.valorResumido, null);
    assert.deepEqual(entradas[0]!.evidencia, selada.evidencia);
  });

  it('ultimaVersaoAtiva fica com a maior versão por key', () => {
    const base = fx.conhecimento()[0]!;
    const resultado = ultimaVersaoAtiva([base, { ...base, version: 3 }, { ...base, version: 2 }]);
    assert.equal(resultado.length, 1);
    assert.equal(resultado[0]!.version, 3);
  });
});
