import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import '../../../shared/testing/registrarAlias.mjs';

const { lerAlteracao, lerDecisaoDeProposta, lerRegistro, lerRevogacao } = await import('./regrasFormulario.ts');

const ID = '22222222-2222-4222-8222-222222222222';
const definicoes = [
  { key: 'investimento.teto_mensal', nome: 'Teto mensal', categoria: 'investimento', unidade: 'brl_centavos', ativo: true, tiposDeEscopo: ['cliente', 'plataforma'] },
  { key: 'eficiencia.cac_maximo', nome: 'CAC máximo', categoria: 'eficiencia', unidade: 'brl_centavos', ativo: true, tiposDeEscopo: ['cliente'] },
  { key: 'eficiencia.roas_minimo', nome: 'ROAS mínimo', categoria: 'eficiencia', unidade: 'razao', ativo: true, tiposDeEscopo: ['cliente'] },
  { key: 'investimento.antigo', nome: 'Antigo', categoria: 'investimento', unidade: 'brl_centavos', ativo: false, tiposDeEscopo: ['cliente'] },
] as const;

describe('lerRegistro', () => {
  it('limite: valor em reais vira centavos e categoria e chave vêm da definição, não do corpo', () => {
    const r = lerRegistro({ natureza: 'limite', definicao: 'investimento.teto_mensal', categoria: 'publico', valor: '10.000,00' }, definicoes);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.value.categoria, 'investimento');
    assert.equal(r.value.chave, 'investimento.teto_mensal');
    assert.deepEqual(r.value.valor, { unidade: 'brl_centavos', centavos: '1000000', moeda: 'BRL' });
    assert.equal(r.value.titulo, 'Teto mensal');
  });
  it('limite: razão usa a unidade da definição', () => {
    const r = lerRegistro({ natureza: 'limite', definicao: 'eficiencia.roas_minimo', valor: '3,5' }, definicoes);
    assert.equal(r.ok && (r.value.valor as { decimal: string }).decimal, '3.5');
  });
  it('limite: recusa definição inativa, valor ruim e escopo não aceito', () => {
    assert.equal(lerRegistro({ natureza: 'limite', definicao: 'investimento.antigo', valor: '1' }, definicoes).ok, false);
    const ruim = lerRegistro({ natureza: 'limite', definicao: 'investimento.teto_mensal', valor: 'muito' }, definicoes);
    assert.equal(!ruim.ok && 'valor' in ruim.error, true);
    const escopo = lerRegistro({ natureza: 'limite', definicao: 'eficiencia.cac_maximo', valor: '10', escopo: 'plataforma:meta' }, definicoes);
    assert.equal(!escopo.ok && 'escopo' in escopo.error, true);
  });
  it('regra: gera chave do título e exige texto', () => {
    const r = lerRegistro({ natureza: 'regra', categoria: 'etica_marca', titulo: 'Sem promessa de cura', texto: 'Nunca prometer cura.' }, definicoes);
    assert.equal(r.ok && r.value.chave, 'etica_marca.sem_promessa_de_cura');
    const semTexto = lerRegistro({ natureza: 'regra', categoria: 'etica_marca', titulo: 'x' }, definicoes);
    assert.equal(!semTexto.ok && 'texto' in semTexto.error, true);
  });
  it('regra não aceita categoria processo', () => {
    assert.equal(lerRegistro({ natureza: 'regra', categoria: 'processo', titulo: 'x', texto: 'y' }, definicoes).ok, false);
  });
  it('decisão: vai para processo sem chave', () => {
    const r = lerRegistro({ natureza: 'decisao', titulo: 'Pausar campanhas em dezembro', categoria: 'etica_marca' }, definicoes);
    assert.equal(r.ok && r.value.categoria, 'processo');
    assert.equal(r.ok && r.value.chave, null);
  });
  it('campos vazios viram nulos e natureza inválida é recusada', () => {
    assert.equal(lerRegistro({ natureza: 'xyz' }, definicoes).ok, false);
    const r = lerRegistro({ natureza: 'decisao', titulo: 'a', evidencia: '  ', emNomeDe: '' }, definicoes);
    assert.equal(r.ok && r.value.evidencia, null);
  });
});

describe('lerAlteracao, lerRevogacao e lerDecisaoDeProposta', () => {
  it('alterar exige o porquê', () => {
    const r = lerAlteracao({ decisaoId: ID, motivo: ' ', valor: '5' }, 'brl_centavos');
    assert.equal(!r.ok && 'motivo' in r.error, true);
  });
  it('alterar limite converte para a unidade do limite atual', () => {
    const r = lerAlteracao({ decisaoId: ID, motivo: 'Cliente aprovou aumento', valor: '12.500,50' }, 'brl_centavos');
    assert.equal(r.ok && (r.value.valor as { centavos: string }).centavos, '1250050');
  });
  it('alterar regra não leva valor', () => {
    const r = lerAlteracao({ decisaoId: ID, motivo: 'Ajuste de texto', texto: 'Novo texto' }, null);
    assert.equal(r.ok && r.value.valor, null);
  });
  it('revogar exige motivo e id válido', () => {
    assert.equal(lerRevogacao({ decisaoId: ID, motivo: '' }).ok, false);
    assert.equal(lerRevogacao({ decisaoId: 'nao-uuid', motivo: 'abc' }).ok, false);
    assert.equal(lerRevogacao({ decisaoId: ID, motivo: 'Não vale mais' }).ok, true);
  });
  it('rejeitar exige motivo; aceitar não', () => {
    assert.equal(lerDecisaoDeProposta({ decisaoId: ID }, true).ok, false);
    assert.equal(lerDecisaoDeProposta({ decisaoId: ID, motivo: 'Fora do escopo' }, true).ok, true);
    const aceitar = lerDecisaoDeProposta({ decisaoId: ID }, false);
    assert.equal(aceitar.ok && aceitar.value.motivo, null);
  });
});
