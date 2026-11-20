import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROTULO_DO_RECURSO, concordaComRecurso, grantTypesFor, missingScopes, temRecursoParaVincular } from './connection.ts';

describe('missingScopes', () => {
  it('exige adwords no Google', () => {
    assert.deepEqual(missingScopes('google', []), ['https://www.googleapis.com/auth/adwords']);
    assert.deepEqual(
      missingScopes('google', ['https://www.googleapis.com/auth/adwords', 'https://www.googleapis.com/auth/datamanager']),
      [],
    );
  });

  it('exige ads_read no Meta', () => {
    assert.deepEqual(missingScopes('meta', ['ads_management']), ['ads_read']);
    assert.deepEqual(missingScopes('meta', ['ads_read']), []);
  });
});

describe('grantTypesFor', () => {
  it('não mistura caminhos entre plataformas', () => {
    assert.ok(!grantTypesFor('google').includes('bm_partner'));
    assert.ok(!grantTypesFor('meta').includes('mcc'));
  });
});

describe('concordaComRecurso', () => {
  it('propriedade do GA4 é feminino; contêiner, site, canal e local são masculinos', () => {
    assert.equal(concordaComRecurso('ga4', 'vinculado', 'vinculada'), 'vinculada');
    for (const platform of ['gtm', 'searchconsole', 'youtube', 'gbp'] as const) {
      assert.equal(concordaComRecurso(platform, 'vinculado', 'vinculada'), 'vinculado');
    }
  });
});

describe('temRecursoParaVincular', () => {
  it('conexões por chave de API rendem um recurso que ganha dono como os demais', () => {
    for (const platform of ['rdstation', 'apify', 'zapi'] as const) {
      assert.equal(temRecursoParaVincular(platform), true);
      assert.equal(concordaComRecurso(platform, 'vinculado', 'vinculada'), 'vinculada');
    }
    assert.equal(ROTULO_DO_RECURSO.rdstation, 'Conta');
    assert.equal(ROTULO_DO_RECURSO.zapi, 'Instância');
  });

  it('contas de anúncio seguem fora: o vínculo delas passa por ad_accounts', () => {
    assert.equal(temRecursoParaVincular('google'), false);
    assert.equal(temRecursoParaVincular('meta'), false);
  });
});
