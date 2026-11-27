import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Medida } from '../../../clients/domain/regras/medida.ts';
import type { Valor } from '../../../clients/domain/regras/valor.ts';
import { contextoDeTeste, planoCompleto } from '../fixturesDeTeste.ts';
import { lerPlano, type Lacuna } from '../plano.ts';
import { checarLimitesDoCliente } from './limitesDoCliente.ts';
import type { VereditoDoLimite } from './resultado.ts';

const por = (regras: Partial<Record<Medida, VereditoDoLimite>>) => (medida: Medida, _valor: Valor): VereditoDoLimite =>
  regras[medida] ?? 'sem_regra';

const lacunaDeLimite = (medida: Medida): Lacuna => ({
  id: `l_${medida}`.slice(0, 32),
  tipo: 'limite_ausente',
  medida,
  descricao: 'Cliente sem limite cadastrado.',
  impacto: 'Não há teto para comparar.',
});

describe('gate: limites_do_cliente', () => {
  it('aprova quando os limites cobrem e aceitam', () => {
    const r = checarLimitesDoCliente(contextoDeTeste({ avaliarLimite: por({ gasto: 'ok', custo_por_lead: 'ok' }) }));
    assert.equal(r.resultado, 'aprovado');
    assert.deepEqual(r.onde, []);
  });

  it('reprova verba acima do limite', () => {
    const r = checarLimitesDoCliente(contextoDeTeste({ avaliarLimite: por({ gasto: 'bloqueia', custo_por_lead: 'ok' }) }));
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.startsWith('orcamento'));
  });

  it('sem limite de gasto e sem lacuna declarada reprova', () => {
    const r = checarLimitesDoCliente(contextoDeTeste({ avaliarLimite: por({}) }));
    assert.equal(r.resultado, 'reprovado');
    assert.equal(r.motivo, 'limite de gasto ausente e não declarado em lacunas');
    assert.ok(r.onde.some((o) => o.startsWith('orcamento')));
  });

  it('sem limite de gasto mas declarado em lacunas aprova e registra onde', () => {
    const contexto = contextoDeTeste({ avaliarLimite: por({ custo_por_lead: 'ok' }) });
    contexto.plano.lacunas.itens.push(lacunaDeLimite('gasto'));
    const r = checarLimitesDoCliente(contexto);
    assert.equal(r.resultado, 'aprovado');
    assert.ok(r.onde[0]?.includes('declarado em lacunas'));
  });

  it('lacuna de outra medida ou de outro tipo não cobre o gasto', () => {
    const contexto = contextoDeTeste({ avaliarLimite: por({ custo_por_lead: 'ok' }) });
    contexto.plano.lacunas.itens.push(lacunaDeLimite('custo_por_lead'), { ...lacunaDeLimite('gasto'), id: 'l8', tipo: 'dado_ausente', medida: undefined });
    assert.equal(checarLimitesDoCliente(contexto).resultado, 'reprovado');
  });

  it('bloqueia reprova mesmo com lacuna declarada', () => {
    const contexto = contextoDeTeste({ avaliarLimite: por({ gasto: 'bloqueia', custo_por_lead: 'ok' }) });
    contexto.plano.lacunas.itens.push(lacunaDeLimite('gasto'));
    assert.equal(checarLimitesDoCliente(contexto).resultado, 'reprovado');
  });

  it('com verba zero, sem limite não reprova', () => {
    const contexto = contextoDeTeste({ avaliarLimite: por({ custo_por_lead: 'ok' }) });
    contexto.plano.orcamento.total = { centavos: '0', moeda: 'BRL' };
    assert.equal(checarLimitesDoCliente(contexto).resultado, 'aprovado');
  });

  it('meta que viola limite de custo reprova', () => {
    const r = checarLimitesDoCliente(contextoDeTeste({ avaliarLimite: por({ gasto: 'ok', custo_por_lead: 'bloqueia' }) }));
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.includes('metas_e_metricas/m_canal'));
  });

  it('meta sem regra de custo exige a lacuna declarada', () => {
    const sem = checarLimitesDoCliente(contextoDeTeste({ avaliarLimite: por({ gasto: 'ok' }) }));
    assert.equal(sem.resultado, 'reprovado');
    assert.ok(sem.onde[0]?.includes('não declarado'));
    const contexto = contextoDeTeste({ avaliarLimite: por({ gasto: 'ok' }) });
    contexto.plano.lacunas.itens.push(lacunaDeLimite('custo_por_lead'));
    assert.equal(checarLimitesDoCliente(contexto).resultado, 'aprovado');
  });

  it('o avaliador recebe o valor em centavos do orçamento', () => {
    const vistos: Valor[] = [];
    checarLimitesDoCliente(contextoDeTeste({ avaliarLimite: (_m, v) => (vistos.push(v), 'ok') }));
    assert.deepEqual(vistos[0], { unidade: 'brl_centavos', centavos: '1000000', moeda: 'BRL' });
  });

  it('medida com limite vigente sem meta que a avalie reprova, mesmo que o modelo não a declare', () => {
    const r = checarLimitesDoCliente(contextoDeTeste({ avaliarLimite: por({ gasto: 'ok', custo_por_lead: 'ok' }), medidasComLimite: ['gasto', 'custo_por_lead', 'retorno'] }));
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes('retorno') && o.includes('sem meta')));
  });

  it('declaração estruturada de não aplicável com motivo cobre a medida e aparece em onde', () => {
    const contexto = contextoDeTeste({ avaliarLimite: por({ gasto: 'ok', custo_por_lead: 'ok' }), medidasComLimite: ['gasto', 'custo_por_lead', 'retorno'] });
    contexto.plano.riscos_e_regras.limites_nao_aplicaveis = [{ medida: 'retorno', motivo: 'Sem venda direta no período.' }];
    const r = checarLimitesDoCliente(contexto);
    assert.equal(r.resultado, 'aprovado');
    assert.ok(r.onde.some((o) => o.startsWith('limite de retorno declarado como não aplicável')));
  });

  it('a medida gasto nunca pode ser declarada não aplicável', () => {
    const contexto = contextoDeTeste({ avaliarLimite: por({ custo_por_lead: 'ok' }), medidasComLimite: ['gasto'] });
    (contexto.plano.riscos_e_regras.limites_nao_aplicaveis as unknown[]) = [{ medida: 'gasto', motivo: 'Tentativa' }];
    assert.equal(checarLimitesDoCliente(contexto).resultado, 'reprovado');
    assert.equal(lerPlano({ ...planoCompleto(), riscos_e_regras: { ...planoCompleto().riscos_e_regras, limites_nao_aplicaveis: [{ medida: 'gasto', motivo: 'x' }] } }).ok, false);
  });

  it('declaração sem motivo é recusada pelo esquema', () => {
    const base = planoCompleto();
    const sem = lerPlano({ ...base, riscos_e_regras: { ...base.riscos_e_regras, limites_nao_aplicaveis: [{ medida: 'retorno', motivo: '' }] } });
    assert.equal(sem.ok, false);
  });

  it('meta com medida_de_limite e previsto em contagem reprova em vez de ser pulada', () => {
    const contexto = contextoDeTeste({ avaliarLimite: por({ gasto: 'ok', custo_por_lead: 'ok' }) });
    const meta = contexto.plano.metas_e_metricas.metas.find((m) => m.id === 'm_social')!;
    meta.medida_de_limite = 'custo_por_lead';
    const r = checarLimitesDoCliente(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes('metas_e_metricas/m_social') && o.includes('incomparável')));
  });

  it('sem medidasComLimite no contexto a checagem não roda (falha fechada)', () => {
    const contexto = { ...contextoDeTeste({ avaliarLimite: por({ gasto: 'ok', custo_por_lead: 'ok' }) }), medidasComLimite: undefined as never };
    assert.equal(checarLimitesDoCliente(contexto).resultado, 'nao_rodou');
  });

  it('com orçamento zero e sem meta com limite, todo limite vigente ainda é conferido', () => {
    const contexto = contextoDeTeste({ avaliarLimite: por({ custo_por_lead: 'ok' }), medidasComLimite: ['gasto', 'retorno'] });
    contexto.plano.orcamento.total = { centavos: '0', moeda: 'BRL' };
    contexto.plano.metas_e_metricas.metas.forEach((meta) => {
      delete meta.medida_de_limite;
    });
    const r = checarLimitesDoCliente(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde.some((o) => o.includes('retorno')), 'medida sem meta nem declaração');
    assert.ok(r.onde.some((o) => o.startsWith('orcamento')), 'o limite de gasto é conferido mesmo com verba zero (sem regra e sem lacuna)');
  });
});
