import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SinalDeCultura } from '../domain/cultura.ts';
import { contagemDeVigentes, visaoDeCultura } from './visaoDeCultura.ts';

const sinal = (extra: Partial<SinalDeCultura> = {}): SinalDeCultura => ({
  id: '11111111-1111-4111-8111-111111111111',
  tipo: 'meme',
  titulo: 'Meme do cafezinho',
  resumo: 'Formato de humor sobre café.',
  fonteUrl: 'https://exemplo.com.br/x',
  fonteNome: 'Exemplo',
  plataforma: 'tiktok',
  observadoEm: '2026-11-10',
  validoAte: '2026-12-10',
  nota: 'C',
  origem: 'coletor',
  criadoEm: new Date('2026-11-10T12:00:00Z'),
  ...extra,
});

describe('visão de sinais de cultura', () => {
  it('resume no cabeçalho recolhido quantos sinais estão vigentes', () => {
    assert.equal(contagemDeVigentes([], '2026-11-20'), 'Nenhum sinal');
    assert.equal(contagemDeVigentes([sinal()], '2026-11-20'), '1 vigente de 1');
    assert.equal(contagemDeVigentes([sinal(), sinal({ id: '22222222-2222-4222-8222-222222222222', validoAte: '2026-11-15' })], '2026-11-20'), '1 vigente de 2');
    assert.equal(visaoDeCultura({ sinais: [sinal()], podeEditar: false, hoje: '2026-11-20' }).contagem, '1 vigente de 1');
  });

  it('rotula tipo, plataforma, nota, origem e janela em português', () => {
    const v = visaoDeCultura({ sinais: [sinal()], podeEditar: true, hoje: '2026-11-20' });
    assert.equal(v.aviso, null);
    assert.deepEqual(
      { tipo: v.sinais[0]!.tipo, plataforma: v.sinais[0]!.plataforma, origem: v.sinais[0]!.origem, janela: v.sinais[0]!.janela },
      { tipo: 'Meme', plataforma: 'TikTok', origem: 'Trazido pelo coletor', janela: 'Observado em 10/11/2026 · vale até 10/12/2026' },
    );
    assert.match(v.sinais[0]!.nota, /^Nota C/);
  });

  it('estado sempre com ícone e texto: vigente, vence em breve e vencido', () => {
    const v = visaoDeCultura({
      sinais: [sinal({ id: 'a', validoAte: '2026-12-10' }), sinal({ id: 'b', validoAte: '2026-11-25' }), sinal({ id: 'c', validoAte: '2026-11-19' })],
      podeEditar: false,
      hoje: '2026-11-20',
    });
    assert.deepEqual(v.sinais.map((s) => [s.id, s.situacao.chave]), [['b', 'vence_em_breve'], ['a', 'vigente'], ['c', 'vencido']]);
    for (const s of v.sinais) assert.ok(s.situacao.icone.length > 0 && s.situacao.rotulo.length > 0);
  });

  it('avisa radar sem sinal vigente quando não há sinal ou todos venceram', () => {
    assert.match(visaoDeCultura({ sinais: [], podeEditar: true, hoje: '2026-11-20' }).aviso ?? '', /Radar sem sinal vigente/);
    assert.match(visaoDeCultura({ sinais: [sinal({ validoAte: '2026-11-01' })], podeEditar: true, hoje: '2026-11-20' }).aviso ?? '', /Radar sem sinal vigente/);
  });

  it('formulário traz prazo padrão de 30 dias, máximo de 90 e todos os tipos e notas', () => {
    const f = visaoDeCultura({ sinais: [], podeEditar: true, hoje: '2026-11-20' }).formulario;
    assert.equal(f.observadoEmPadrao, '2026-11-20');
    assert.equal(f.validoAtePadrao, '2026-12-20');
    assert.equal(f.validoAteMaximo, '2027-02-18');
    assert.equal(f.tipos.length, 6);
    assert.deepEqual(f.notas.map((n) => n.valor), ['A', 'B', 'C', 'D']);
    assert.match(f.lembrete, /fenômeno público/);
  });

  it('texto de lista vazia muda com a permissão', () => {
    assert.match(visaoDeCultura({ sinais: [], podeEditar: true, hoje: '2026-11-20' }).semSinais, /Cadastre/);
    assert.match(visaoDeCultura({ sinais: [], podeEditar: false, hoje: '2026-11-20' }).semSinais, /Nenhum/);
  });
});
