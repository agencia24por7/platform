import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GRUPOS_DE_REDACAO,
  INDICE_DO_ULTIMO_GRUPO,
  SECOES_DA_CHECAGEM,
  grupoDaSecao,
  gruposDaPendenciaDoGate,
} from './gruposDoPlano.ts';
import { CHECAGENS_EM_CODIGO } from './gate/registro.ts';

const grupoDe = (secao: string) => grupoDaSecao(secao)!;

describe('pendências do Gate por grupo', () => {
  it('cada checagem do registro tem entrada no mapa e só aponta para seções existentes', () => {
    for (const { chave } of CHECAGENS_EM_CODIGO) {
      assert.ok(SECOES_DA_CHECAGEM[chave], chave);
      for (const secao of SECOES_DA_CHECAGEM[chave]!) assert.notEqual(grupoDaSecao(secao), null, `${chave}/${secao}`);
    }
  });

  it('o primeiro segmento de cada caminho em onde decide o grupo', () => {
    assert.deepEqual(gruposDaPendenciaDoGate('meta_sem_nota_d', ['metas_e_metricas/m_neg (só nota D)']), [grupoDe('metas_e_metricas')]);
    assert.deepEqual(gruposDaPendenciaDoGate('objetivo_com_metrica', ['metas_e_metricas/m_social (sem forma de medir)']), [grupoDe('metas_e_metricas')]);
    assert.deepEqual(gruposDaPendenciaDoGate('nao_faremos_preservado', ['estrategia/nf_tiktok (removido)']), [grupoDe('estrategia')]);
    assert.deepEqual(
      gruposDaPendenciaDoGate('limites_do_cliente', ['orcamento/total acima do limite']),
      [grupoDe('orcamento'), grupoDe('metas_e_metricas'), grupoDe('riscos_e_regras')].sort((a, b) => a - b),
    );
    assert.ok(gruposDaPendenciaDoGate('limites_do_cliente', ['orcamento (limite de gasto ausente e não declarado)']).includes(grupoDe('lacunas')));
    assert.deepEqual(gruposDaPendenciaDoGate('urns_no_pacote', ['campanhas/cp_1 cita urn fora']), [grupoDe('diagnostico'), grupoDe('campanhas')].sort((a, b) => a - b));
    const dois = gruposDaPendenciaDoGate('nao_faremos', ['campanhas/cp_social viola estrategia/nf_x', 'canais_e_plataformas/cn_1 viola estrategia/nf_x']);
    assert.deepEqual(dois, [grupoDe('posicionamento_e_mensagem'), grupoDe('campanhas')].sort((a, b) => a - b));
  });

  it('sem caminho reconhecido, vale o mapa da checagem', () => {
    assert.deepEqual(gruposDaPendenciaDoGate('limites_do_cliente', []), [grupoDe('metas_e_metricas'), grupoDe('riscos_e_regras')].sort((a, b) => a - b));
    assert.deepEqual(gruposDaPendenciaDoGate('limites_do_cliente', ['limite de retorno declarado como não aplicável']), [grupoDe('metas_e_metricas'), grupoDe('riscos_e_regras')].sort((a, b) => a - b));
    assert.deepEqual(gruposDaPendenciaDoGate('meta_sem_nota_d', []), [grupoDe('metas_e_metricas')]);
    assert.deepEqual(gruposDaPendenciaDoGate('objetivo_com_metrica', []), [grupoDe('metas_e_metricas')]);
    assert.deepEqual(gruposDaPendenciaDoGate('nao_faremos_preservado', []), [grupoDe('estrategia')]);
    assert.deepEqual(gruposDaPendenciaDoGate('urns_no_pacote', []), [grupoDe('diagnostico')]);
  });

  it('checagem desconhecida cai no último grupo', () => {
    assert.deepEqual(gruposDaPendenciaDoGate('inexistente', []), [INDICE_DO_ULTIMO_GRUPO]);
  });

  it('nenhuma pendência de meta, campanha ou estratégia cai no grupo que não as edita', () => {
    const ultimo = GRUPOS_DE_REDACAO[INDICE_DO_ULTIMO_GRUPO]!;
    for (const secao of ['metas_e_metricas', 'campanhas', 'estrategia']) assert.ok(!ultimo.includes(secao as never));
  });
});
