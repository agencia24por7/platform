import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checagensCorrigiveis, correcoesNaLinhagem, falhasDoGate, podeCorrigirMais, restaurarNaoFaremos, type ExecucaoParaContagem } from './correcaoDoGate.ts';
import { planoCompleto } from './fixturesDeTeste.ts';
import { checarNaoFaremosPreservado } from './gate/naoFaremosPreservado.ts';
import type { ContextoDoGate } from './gate/resultado.ts';
import type { NaoFaremos, Plano } from './plano.ts';

const itens: NaoFaremos[] = [
  { id: 'nf1', texto: 'Não prometer cura.' },
  { id: 'nf2', texto: 'Sem tiktok.', teste: { tipo: 'plataforma_proibida', valor: 'tiktok' } },
  { id: 'nf3', texto: 'Sem vídeo longo.', teste: { tipo: 'formato_proibido', valor: 'video_longo' } },
  { id: 'nf4', texto: 'Sem display.', teste: { tipo: 'canal_proibido', valor: 'display' } },
];
const comNaoFaremos = (plano: Plano, lista: NaoFaremos[]): Plano => ({ ...plano, estrategia: { ...plano.estrategia, nao_faremos: lista } });

describe('correção do gate', () => {
  it('captura só o que reprovou, com onde e o que o modelo apontou', () => {
    const falhas = falhasDoGate({
      resultado: 'reprovado',
      checagens: [
        { chave: 'urns_no_pacote', resultado: 'aprovado', motivo: 'ok', onde: [] },
        { chave: 'nao_faremos_preservado', resultado: 'reprovado', motivo: '4 perdidos', onde: ['estrategia/nf1 (removido em relação à versão base)'] },
        { chave: 'comite_completo', resultado: 'nao_rodou', motivo: 'x', onde: ['comite/ajuste'] },
      ],
      modelo: { problemas: [{ trecho: 'campanhas', problema: 'incoerente' }] },
    });
    assert.deepEqual(falhas?.checagens.map((c) => c.chave), ['nao_faremos_preservado', 'comite_completo']);
    assert.deepEqual(falhas?.modelo, [{ trecho: 'campanhas', problema: 'incoerente' }]);
    assert.deepEqual(checagensCorrigiveis(falhas!).map((c) => c.chave), ['nao_faremos_preservado']);
    assert.equal(falhasDoGate({ resultado: 'aprovado', checagens: [] }), null);
    assert.equal(falhasDoGate(null), null);
  });

  it('restaura os quatro "não faremos" removidos e deixa o gate aprovar', () => {
    const base = comNaoFaremos(planoCompleto(), itens);
    const sem = comNaoFaremos(planoCompleto(), []);
    const contexto = (plano: Plano): ContextoDoGate => ({ plano, planosBase: [base], exigePlanoBase: true }) as unknown as ContextoDoGate;
    assert.equal(checarNaoFaremosPreservado(contexto(sem)).resultado, 'reprovado');
    const { plano, restauradas } = restaurarNaoFaremos(sem, [base]);
    assert.deepEqual([...restauradas].sort(), ['nf1', 'nf2', 'nf3', 'nf4']);
    assert.equal(checarNaoFaremosPreservado(contexto(plano)).resultado, 'aprovado');
    assert.equal(restaurarNaoFaremos(plano, [base]).restauradas.length, 0);
  });

  it('desfaz item reescrito ou afrouxado e preserva o que a versão atual acrescentou', () => {
    const base = comNaoFaremos(planoCompleto(), itens);
    const atual = comNaoFaremos(planoCompleto(), [
      { id: 'nf1', texto: 'Prometer cura em alguns casos.' },
      { id: 'nf2', texto: 'Sem tiktok.' },
      { id: 'nf3', texto: 'Sem vídeo longo.', teste: { tipo: 'formato_proibido', valor: 'video_longo' } },
      { id: 'novo', texto: 'Item novo.' },
    ]);
    const { plano, restauradas } = restaurarNaoFaremos(atual, [base]);
    assert.deepEqual([...restauradas].sort(), ['nf1', 'nf2', 'nf4']);
    assert.ok(plano.estrategia.nao_faremos.some((item) => item.id === 'novo'));
    assert.equal(plano.estrategia.nao_faremos.find((item) => item.id === 'nf1')?.texto, 'Não prometer cura.');
  });

  const exec = (agentRunId: string, tipo: string, versaoBaseId: string | null, status = 'falhou', tentativas = 1): ExecucaoParaContagem => ({ agentRunId, tipo, versaoBaseId, status, tentativas });

  it('conta correções por versão-raiz subindo pela execução que criou cada base, e para em duas', () => {
    const runDe: Record<string, string> = { V0: 'run-criar', V2: 'run-c1', V4: 'run-c2' };
    const conta = (base: string, execucoes: ExecucaoParaContagem[]) => correcoesNaLinhagem({ versaoBaseId: base, execucoes, agentRunIdDaVersao: (id) => runDe[id] ?? null });
    const criar = exec('run-criar', 'criar', null, 'concluida');
    assert.equal(conta('V0', [criar]), 0);
    const c1 = exec('run-c1', 'corrigir_gate', 'V0');
    assert.equal(conta('V0', [criar, c1]), 1);
    assert.equal(conta('V2', [criar, c1]), 1);
    const c2 = exec('run-c2', 'corrigir_gate', 'V2');
    assert.equal(conta('V4', [criar, c1, c2]), 2);
    assert.equal(podeCorrigirMais(1), true);
    assert.equal(podeCorrigirMais(2), false);
  });

  it('cancelada antes de começar não conta; cancelada depois de gastar conta; e ciclo não trava', () => {
    const conta = (execucoes: ExecucaoParaContagem[]) => correcoesNaLinhagem({ versaoBaseId: 'V0', execucoes, agentRunIdDaVersao: () => 'run-a' });
    assert.equal(conta([exec('run-a', 'corrigir_gate', 'V0', 'cancelada', 0)]), 0);
    assert.equal(conta([exec('run-a', 'corrigir_gate', 'V0', 'cancelada', 1)]), 1);
  });
});
