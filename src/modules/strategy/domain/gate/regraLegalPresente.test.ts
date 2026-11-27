import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { URN_REGRA_LEGAL, contextoDeTeste, evidencia } from '../fixturesDeTeste.ts';
import { checarRegraLegalPresente } from './regraLegalPresente.ts';

describe('gate: regra_legal_presente', () => {
  it('aprova quando a regra obrigatória está em riscos e regras', () => {
    assert.equal(checarRegraLegalPresente(contextoDeTeste()).resultado, 'aprovado');
  });

  it('reprova quando só outra seção cita a regra', () => {
    const contexto = contextoDeTeste();
    contexto.plano.riscos_e_regras.regras_aplicaveis[0]!.evidencias = [evidencia('orla:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:limite:teto-mensal')];
    contexto.plano.diagnostico.situacao.evidencias.push(evidencia(URN_REGRA_LEGAL));
    const r = checarRegraLegalPresente(contexto);
    assert.equal(r.resultado, 'reprovado');
    assert.ok(r.onde[0]?.includes(URN_REGRA_LEGAL));
  });

  it('regra legal não obrigatória não exige citação', () => {
    const contexto = contextoDeTeste();
    contexto.plano.riscos_e_regras.regras_aplicaveis = [];
    const regra = contexto.pacote.entradas.find((e) => e.urn === URN_REGRA_LEGAL)!;
    regra.evidencia = { ...regra.evidencia!, obrigatoria: false };
    assert.equal(checarRegraLegalPresente(contexto).resultado, 'aprovado');
  });
});
