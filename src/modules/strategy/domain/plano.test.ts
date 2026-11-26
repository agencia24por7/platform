import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dataIsoValida } from './datas.ts';
import { URN_BENCHMARK_B, afirmacao, evidencia, planoCompleto, planoCompletoBruto, planoMinimo, planoMinimoBruto } from './fixturesDeTeste.ts';
import { SCHEMA_VERSION, SECOES_DO_PLANO, TAMANHO_MAXIMO_DO_PLANO_BYTES, esquemaIntencao, lerPlano, tamanhoDoPlano } from './plano.ts';

const problemas = (bruto: unknown): string[] => {
  const resultado = lerPlano(bruto);
  return resultado.ok ? [] : resultado.error.problemas.map((p) => `${p.caminho}: ${p.mensagem}`);
};

describe('lerPlano', () => {
  it('aceita o plano mínimo e o completo', () => {
    assert.equal(SCHEMA_VERSION, 1);
    assert.equal(lerPlano(planoMinimoBruto()).ok, true);
    assert.equal(lerPlano(planoCompletoBruto()).ok, true);
    assert.ok(tamanhoDoPlano(planoCompleto()) < TAMANHO_MAXIMO_DO_PLANO_BYTES);
  });

  it('tem as 16 seções do ADR 0062 §8', () => {
    assert.equal(SECOES_DO_PLANO.length, 16);
    const chaves = Object.keys(planoMinimo()).filter((c) => c !== 'schema_version');
    assert.deepEqual(chaves.sort(), [...SECOES_DO_PLANO].sort());
  });

  it('recusa chave livre em qualquer nível', () => {
    const raiz = planoMinimoBruto() as unknown as Record<string, unknown>;
    raiz.extra = 1;
    assert.equal(lerPlano(raiz).ok, false);

    const aninhado = planoMinimoBruto();
    (aninhado.campanhas.campanhas[0] as unknown as Record<string, unknown>).nome_da_pessoa = 'Fulano';
    assert.equal(lerPlano(aninhado).ok, false);
  });

  it('recusa versão de esquema diferente e não objeto', () => {
    assert.equal(lerPlano({ ...planoMinimoBruto(), schema_version: 2 }).ok, false);
    assert.equal(lerPlano(null).ok, false);
    assert.equal(lerPlano('texto').ok, false);
  });

  it('afirmação sem evidência exige marca de hipótese', () => {
    const plano = planoMinimoBruto();
    plano.diagnostico.situacao = { texto: 'Afirmação solta.', evidencias: [], hipotese: false };
    assert.ok(problemas(plano).some((p) => p.includes('evidência ou é marcada como hipótese')));
    plano.diagnostico.situacao = afirmacao('Com evidência.', evidencia(URN_BENCHMARK_B));
    assert.equal(lerPlano(plano).ok, true);
  });

  it('meta sem evidência exige hipótese', () => {
    const plano = planoMinimoBruto();
    plano.metas_e_metricas.metas[1]!.hipotese = false;
    assert.equal(lerPlano(plano).ok, false);
  });

  it('URN fora do formato é recusada', () => {
    const plano = planoMinimoBruto();
    plano.diagnostico.situacao = afirmacao('x', evidencia('orla:nao-e-urn'));
    assert.equal(lerPlano(plano).ok, false);
  });

  it('dinheiro é inteiro de centavos em BRL', () => {
    for (const centavos of ['10,50', '-5', '1.5', 'abc', '']) {
      const plano = planoMinimoBruto();
      plano.orcamento.total = { centavos, moeda: 'BRL' };
      assert.equal(lerPlano(plano).ok, false, centavos);
    }
    const plano = planoMinimoBruto() as unknown as { orcamento: { total: { moeda: string; centavos: string } } };
    plano.orcamento.total = { centavos: '100', moeda: 'USD' };
    assert.equal(lerPlano(plano).ok, false);
  });

  it('datas são ISO válidas e períodos não se invertem', () => {
    assert.equal(dataIsoValida('2026-02-28'), true);
    assert.equal(dataIsoValida('2026-02-30'), false);
    assert.equal(dataIsoValida('2026-2-3'), false);
    const plano = planoMinimoBruto();
    plano.intencao.horizonte = { inicio: '2027-03-01', fim: '2027-02-28' };
    assert.equal(lerPlano(plano).ok, false);
    plano.intencao.horizonte = { inicio: '2026/12/01', fim: '2027-02-28' };
    assert.equal(lerPlano(plano).ok, false);
  });

  it('textos e listas têm tamanho máximo', () => {
    const longo = planoMinimoBruto();
    longo.intencao.objetivo = 'a'.repeat(601);
    assert.equal(lerPlano(longo).ok, false);
    const vazio = planoMinimoBruto();
    vazio.intencao.objetivo = '   ';
    assert.equal(lerPlano(vazio).ok, false);
    const muitos = planoMinimoBruto();
    muitos.publico_alvo.segmentos = Array.from({ length: 13 }, (_, i) => ({
      ...planoMinimoBruto().publico_alvo.segmentos[0]!,
      id: `seg_${i}`,
    }));
    assert.equal(lerPlano(muitos).ok, false);
  });

  it('recusa plano acima de 256 KB', () => {
    const resultado = lerPlano({ ...planoCompletoBruto(), lixo: 'x'.repeat(TAMANHO_MAXIMO_DO_PLANO_BYTES) });
    assert.equal(resultado.ok, false);
    assert.equal(!resultado.ok && resultado.error.codigo, 'plano_grande_demais');
  });

  it('ids repetidos e referências internas quebradas são recusados', () => {
    const repetido = planoCompletoBruto();
    repetido.publico_alvo.segmentos[1]!.id = 'seg_local';
    assert.ok(problemas(repetido).some((p) => p.includes('Id repetido')));

    const segmento = planoMinimoBruto();
    segmento.campanhas.campanhas[0]!.segmento_id = 'seg_fantasma';
    assert.ok(problemas(segmento).some((p) => p.includes('Segmento inexistente')));

    const meta = planoMinimoBruto();
    meta.campanhas.campanhas[0]!.meta_id = 'm_fantasma';
    assert.ok(problemas(meta).some((p) => p.includes('Meta inexistente')));

    const pai = planoMinimoBruto();
    pai.metas_e_metricas.metas[1]!.pai_id = 'm_canal';
    assert.ok(problemas(pai).some((p) => p.includes('meta de negócio')));

    const raiz = planoMinimoBruto();
    raiz.metas_e_metricas.metas[0]!.pai_id = 'm_canal';
    assert.ok(problemas(raiz).some((p) => p.includes('não tem pai')));

    const publico = planoCompletoBruto();
    publico.estrategia.nao_faremos.push({ id: 'nf_pub', texto: 'x', teste: { tipo: 'publico_proibido', valor: 'seg_nada' } });
    assert.ok(problemas(publico).some((p) => p.includes('Segmento inexistente')));
  });

  it('nao_faremos aceita só valores de lista fechada ou identificador', () => {
    const plano = planoCompletoBruto();
    (plano.estrategia.nao_faremos[0] as { teste: unknown }).teste = { tipo: 'plataforma_proibida', valor: 'rede_inexistente' };
    assert.equal(lerPlano(plano).ok, false);
    (plano.estrategia.nao_faremos[0] as { teste: unknown }).teste = { tipo: 'regex_livre', valor: '.*' };
    assert.equal(lerPlano(plano).ok, false);
  });

  it('ids internos seguem o padrão curto', () => {
    const plano = planoMinimoBruto();
    plano.criativos.conceitos[0]!.id = 'Conceito Com Espaço';
    assert.equal(lerPlano(plano).ok, false);
  });
});

describe('lacunas', () => {
  it('limite_ausente exige medida e só ele a aceita', () => {
    const plano = planoMinimoBruto();
    const base = { id: 'l1', descricao: 'Sem teto.', impacto: 'Sem comparação.' };
    plano.lacunas.itens = [{ ...base, tipo: 'limite_ausente' }];
    assert.equal(lerPlano(plano).ok, false);
    plano.lacunas.itens = [{ ...base, tipo: 'limite_ausente', medida: 'gasto' }];
    assert.equal(lerPlano(plano).ok, true);
    plano.lacunas.itens = [{ ...base, tipo: 'dado_ausente', medida: 'gasto' }];
    assert.equal(lerPlano(plano).ok, false);
    plano.lacunas.itens = [{ ...base, tipo: 'qualquer' as never }];
    assert.equal(lerPlano(plano).ok, false);
  });
});

describe('esquemaIntencao', () => {
  const intencao = planoMinimoBruto().intencao;

  it('é o que a pessoa preenche', () => {
    assert.equal(esquemaIntencao.safeParse(intencao).success, true);
    assert.equal(esquemaIntencao.safeParse({ ...intencao, ousadia: 'radical' }).success, false);
    assert.equal(esquemaIntencao.safeParse({ ...intencao, extra: 1 }).success, false);
  });
});

describe('sem dado pessoal', () => {
  it('o plano não tem campo de nome, e-mail ou telefone de pessoa', () => {
    const chaves = new Set<string>();
    const percorrer = (valor: unknown): void => {
      if (Array.isArray(valor)) valor.forEach(percorrer);
      else if (valor !== null && typeof valor === 'object') {
        for (const [chave, filho] of Object.entries(valor)) {
          chaves.add(chave);
          percorrer(filho);
        }
      }
    };
    percorrer(planoCompleto());
    for (const proibida of ['email', 'e_mail', 'telefone', 'celular', 'cpf', 'nome_da_pessoa']) {
      assert.equal(chaves.has(proibida), false, proibida);
    }
  });
});
