import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapearLinhaDoContexto, marcaDaMigracao, type LinhaDoContexto } from './migracaoDoContexto.ts';

const AUTOR = '11111111-1111-4111-8111-111111111111';

const linha = (fieldKey: string, valor: unknown, extra: Partial<LinhaDoContexto> = {}): LinhaDoContexto => ({
  fieldKey,
  valor,
  source: 'equipe',
  review: 'confirmado',
  updatedBy: AUTOR,
  updatedAt: new Date('2026-03-10T15:00:00Z'),
  ...extra,
});

describe('mapearLinhaDoContexto', () => {
  it('orçamento vira limite investimento.teto_mensal em centavos, origem pela fonte', () => {
    const r = mapearLinhaDoContexto(linha('orcamento_mensal_total', 1250050));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(
      [r.decisao.natureza, r.decisao.chave, r.decisao.origem, r.decisao.forca, r.decisao.definicaoVersao],
      ['limite', 'investimento.teto_mensal', 'agencia', 'dura', 1],
    );
    assert.deepEqual(r.decisao.valor, { valor: '1250050', unidade: 'brl_centavos' });
    assert.equal(r.decisao.vigenciaInicio, '2026-03-10');
    assert.equal(r.decisao.decididoPor, AUTOR);
    assert.equal(r.decisao.evidencia, marcaDaMigracao('orcamento_mensal_total', 'equipe'));
  });

  it('fonte cliente nunca vira origem cliente vigente: origem agencia, e o registro diz "informado pelo cliente"', () => {
    const r = mapearLinhaDoContexto(linha('orcamento_mensal_total', 100, { source: 'cliente' }));
    assert.ok(r.ok);
    assert.equal(r.decisao.origem, 'agencia');
    assert.match(r.decisao.contexto, /informado pelo cliente/);
    assert.match(r.decisao.evidencia, /informado pelo cliente/);
    const equipe = mapearLinhaDoContexto(linha('quem_aprova', 'Maria'));
    assert.ok(equipe.ok);
    assert.doesNotMatch(equipe.decisao.contexto, /informado pelo cliente/);
  });

  it('data local usa o fuso de São Paulo', () => {
    const r = mapearLinhaDoContexto(linha('quem_aprova', 'Maria', { updatedAt: new Date('2026-03-10T01:30:00Z') }));
    assert.equal(r.ok && r.decisao.vigenciaInicio, '2026-03-09');
  });

  it('valor de dinheiro inválido é pulado', () => {
    for (const v of [-1, 1.5, 'abc', null, 1e12]) {
      assert.deepEqual(mapearLinhaDoContexto(linha('orcamento_mensal_total', v)), { ok: false, motivo: 'valor_de_dinheiro_invalido' });
    }
  });

  it('cada texto vai para a categoria do ADR', () => {
    const esperado: Record<string, [string, string]> = {
      regras_regulatorias: ['segmento', 'segmento.regras_regulatorias'],
      o_que_nao_pode_ser_dito: ['etica_marca', 'etica_marca.o_que_nao_pode_ser_dito'],
      quem_aprova: ['governanca', 'governanca.quem_aprova'],
      prazo_de_aprovacao: ['governanca', 'governanca.prazo_de_aprovacao'],
    };
    for (const [campo, [categoria, chave]] of Object.entries(esperado)) {
      const r = mapearLinhaDoContexto(linha(campo, 'Texto'));
      assert.ok(r.ok);
      assert.deepEqual([r.decisao.natureza, r.decisao.categoria, r.decisao.chave, r.decisao.valor], ['regra', categoria, chave, null]);
    }
  });

  it('texto com número nunca vira limite e fica marcado para revisão', () => {
    const r = mapearLinhaDoContexto(linha('regras_regulatorias', 'Não prometer mais de 30% de desconto'));
    assert.ok(r.ok);
    assert.equal(r.decisao.natureza, 'regra');
    assert.equal(r.decisao.reviewFlag, 'revisar_e_converter_em_limite');
    const sem = mapearLinhaDoContexto(linha('quem_aprova', 'Maria'));
    assert.equal(sem.ok && sem.decisao.reviewFlag, null);
  });

  it('sem autor (updated_by nulo ou usuário removido) é ignorada: nunca grava vigente sem pessoa', () => {
    assert.deepEqual(mapearLinhaDoContexto(linha('quem_aprova', 'Maria', { updatedBy: null })), { ok: false, motivo: 'ignorada_sem_autor' });
    assert.deepEqual(mapearLinhaDoContexto(linha('orcamento_mensal_total', 100, { updatedBy: null })), { ok: false, motivo: 'ignorada_sem_autor' });
    const r = mapearLinhaDoContexto(linha('quem_aprova', 'Maria'));
    assert.ok(r.ok);
    assert.match(r.decisao.contexto, new RegExp(`usuário ${AUTOR}`));
    assert.match(r.decisao.contexto, /Migrado do Contexto/);
  });

  it('pula sugestão, texto vazio, texto longo demais e campo estranho', () => {
    assert.deepEqual(mapearLinhaDoContexto(linha('quem_aprova', 'X', { review: 'sugerido' })), { ok: false, motivo: 'sugestao_nao_confirmada' });
    assert.deepEqual(mapearLinhaDoContexto(linha('quem_aprova', '   ')), { ok: false, motivo: 'texto_vazio' });
    assert.deepEqual(mapearLinhaDoContexto(linha('quem_aprova', 'a'.repeat(4001))), { ok: false, motivo: 'texto_acima_do_limite' });
    assert.deepEqual(mapearLinhaDoContexto(linha('quem_aprova', 3)), { ok: false, motivo: 'texto_invalido' });
    assert.deepEqual(mapearLinhaDoContexto(linha('nome_empresa', 'X')), { ok: false, motivo: 'campo_fora_da_migracao' });
  });
});
