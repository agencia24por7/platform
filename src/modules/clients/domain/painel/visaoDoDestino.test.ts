import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LandingPage } from '../destino/tipos.ts';
import { visaoDoDestino } from './visaoDoDestino.ts';

const base = { organizationId: 'o', clientId: 'c', criadaEm: new Date('2026-11-01T00:00:00Z') };
const pagina = (id: string, rotulo: string, arquivadaEm: Date | null = null): LandingPage => ({ ...base, id, rotulo, url: `https://exemplo.com.br/${id}`, arquivadaEm });

describe('visão do destino do cliente', () => {
  it('ignora páginas arquivadas e ordena pelo rótulo', () => {
    const visao = visaoDoDestino({ whatsapp: '+5511999998888', paginas: [pagina('b', 'Oferta'), pagina('a', 'Campanha'), pagina('c', 'Antiga', new Date())], podeEditar: true });
    assert.deepEqual(visao.paginas.map((p) => p.rotulo), ['Campanha', 'Oferta']);
    assert.equal(visao.whatsapp.valor, '+5511999998888');
  });

  it('avisa quando falta WhatsApp e muda a orientação para quem só lê', () => {
    const visao = visaoDoDestino({ whatsapp: null, paginas: [], podeEditar: false });
    assert.equal(visao.whatsapp.valor, null);
    assert.match(visao.whatsapp.situacao, /Ainda não cadastrado/);
    assert.equal(visao.semPaginas, 'Nenhuma landing page cadastrada.');
    assert.match(visaoDoDestino({ whatsapp: null, paginas: [], podeEditar: true }).semPaginas, /Cadastre/);
  });
});
