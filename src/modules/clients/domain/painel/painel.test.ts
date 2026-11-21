import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { comAviso, destinoSeguro, enderecoDoFormulario, idValido, rotaDoCliente } from './enderecos.ts';
import { formatarCentavos, mascararDinheiro, normalizarArrobaDigitado, numeroDeTexto, tamanhoLegivel } from './formato.ts';
import { mensagemProntaDoLink, minutosEstimados, secoesDoPreset } from './mensagem.ts';
import { barrasDaSecao, resumirCompletude, saudeDosDados, tempoRelativo } from './resumo.ts';

const ID = '95ec64b4-c5b9-43ff-909d-d258d91e8b7c';

describe('endereços do painel do cliente', () => {
  it('monta a rota de cada aba com busca opcional', () => {
    assert.equal(rotaDoCliente(ID), `/clientes/${ID}`);
    assert.equal(rotaDoCliente(ID, 'contexto', { secao: 'publico', vazio: '' }), `/clientes/${ID}/contexto?secao=publico`);
    assert.equal(comAviso(`/clientes/${ID}/dados`, 'feito', 'Conta movida.'), `/clientes/${ID}/dados?feito=Conta%20movida.`);
    assert.equal(comAviso(`/x?a=1`, 'erro', 'e'), '/x?a=1&erro=e');
  });

  it('só aceita destino dentro do próprio cliente', () => {
    assert.equal(destinoSeguro(`/clientes/${ID}/acessos`, ID), `/clientes/${ID}/acessos`);
    assert.equal(destinoSeguro('https://evil.example', ID), `/clientes/${ID}`);
    assert.equal(destinoSeguro(`/clientes/${ID}//evil.example`, ID), `/clientes/${ID}`);
    assert.equal(destinoSeguro(`/clientes/${ID}x`, ID), `/clientes/${ID}`);
    assert.equal(destinoSeguro(null, ID), `/clientes/${ID}`);
  });

  it('valida id e monta o link público sem barra dupla', () => {
    assert.ok(idValido(ID));
    assert.ok(!idValido('../x'));
    assert.equal(enderecoDoFormulario('https://app.orla/', 'abc'), 'https://app.orla/contexto/abc');
  });
});

describe('formatos', () => {
  it('mascara dinheiro em centavos', () => {
    assert.deepEqual(mascararDinheiro('R$ 1.234,5'), { texto: '123,45', centavos: 12345 });
    assert.deepEqual(mascararDinheiro('150000'), { texto: '1.500,00', centavos: 150000 });
    assert.deepEqual(mascararDinheiro(''), { texto: '', centavos: null });
    assert.equal(formatarCentavos(990), '9,90');
    assert.equal(formatarCentavos(null), '');
  });

  it('lê números no jeito brasileiro', () => {
    assert.equal(numeroDeTexto('1.234,5'), 1234.5);
    assert.equal(numeroDeTexto('12.000'), 12000);
    assert.equal(numeroDeTexto('42%'), 42);
    assert.equal(numeroDeTexto('abc'), null);
    assert.equal(numeroDeTexto(''), null);
  });

  it('põe @ só em perfil digitado, não em URL', () => {
    assert.equal(normalizarArrobaDigitado('cafe.orla'), '@cafe.orla');
    assert.equal(normalizarArrobaDigitado('@cafe'), '@cafe');
    assert.equal(normalizarArrobaDigitado('instagram.com/cafe'), 'instagram.com/cafe');
    assert.equal(normalizarArrobaDigitado('https://x.com/a'), 'https://x.com/a');
  });

  it('tamanho legível', () => {
    assert.equal(tamanhoLegivel(512), '512 B');
    assert.equal(tamanhoLegivel(2048), '2 KB');
    assert.equal(tamanhoLegivel(25 * 1024 * 1024), '25 MB');
  });
});

describe('mensagem pronta do link', () => {
  const base = {
    cliente: 'Café Orla',
    organizacao: 'Agência Maré',
    link: 'https://app/contexto/tok',
    expiraEm: new Date('2026-12-20T15:00:00Z'),
    secoes: ['Empresa', 'Produtos'],
    minutosEstimados: minutosEstimados(2),
  };

  it('leva o link, as seções e o prazo', () => {
    const texto = mensagemProntaDoLink(base);
    assert.match(texto, /Café Orla/);
    assert.match(texto, /https:\/\/app\/contexto\/tok/);
    assert.match(texto, /• Produtos/);
    assert.match(texto, /20 de dezembro/);
    assert.match(texto, /8 minutos/);
  });

  it('com convite, manda o convite e explica os dois passos', () => {
    const texto = mensagemProntaDoLink({ ...base, conviteDeIntegracao: 'https://app/convite/c1' });
    assert.match(texto, /1 · Conectar/);
    assert.match(texto, /https:\/\/app\/convite\/c1/);
    assert.doesNotMatch(texto, /contexto\/tok/);
  });

  it('presets de seções respeitam a ordem do catálogo', () => {
    const todas = ['empresa', 'produtos', 'publico', 'mercado', 'presenca_digital', 'objetivos'];
    assert.deepEqual(secoesDoPreset('essencial', todas, []), ['empresa', 'produtos', 'publico', 'presenca_digital', 'objetivos']);
    assert.deepEqual(secoesDoPreset('completo', todas, []), todas);
    assert.deepEqual(secoesDoPreset('personalizado', todas, ['mercado', 'empresa']), ['empresa', 'mercado']);
  });
});

describe('resumo da completude e saúde dos dados', () => {
  const secao = (p: Partial<Parameters<typeof barrasDaSecao>[0]>) => ({
    secao: 'empresa' as const,
    percentual: 0,
    preenchidos: 0,
    total: 10,
    essenciaisPreenchidos: 0,
    essenciaisTotal: 4,
    essenciaisCompletos: false,
    ...p,
  });

  it('separa barras de essencial e aprofundar', () => {
    const b = barrasDaSecao(secao({ preenchidos: 6, essenciaisPreenchidos: 4, essenciaisCompletos: true, percentual: 70 }));
    assert.deepEqual(b.essencial, { feitos: 4, total: 4, percentual: 100 });
    assert.deepEqual(b.aprofundar, { feitos: 2, total: 6, percentual: 33 });
    assert.equal(b.estado, 'essencial_ok');
    assert.equal(barrasDaSecao(secao({})).estado, 'vazia');
    assert.equal(barrasDaSecao(secao({ preenchidos: 10, essenciaisPreenchidos: 4, essenciaisCompletos: true })).estado, 'completa');
  });

  it('agrega seções', () => {
    const r = resumirCompletude(62, [
      secao({ preenchidos: 10, essenciaisPreenchidos: 4, essenciaisCompletos: true }),
      secao({ preenchidos: 0 }),
    ]);
    assert.equal(r.secoesCompletas, 1);
    assert.equal(r.secoesVazias, 1);
    assert.equal(r.essenciaisFeitos, 4);
    assert.equal(r.essenciaisTotal, 8);
    assert.equal(r.faixa, 'bom');
  });

  it('classifica contas por frescor da última coleta', () => {
    const agora = new Date('2026-11-20T12:00:00Z');
    const h = (n: number) => new Date(agora.getTime() - n * 3_600_000);
    const s = saudeDosDados(
      [
        { lastSyncAt: h(2), syncEnabled: true },
        { lastSyncAt: h(48), syncEnabled: true },
        { lastSyncAt: h(24 * 10), syncEnabled: true },
        { lastSyncAt: null, syncEnabled: true },
        { lastSyncAt: h(1), syncEnabled: false },
      ],
      agora,
    );
    assert.deepEqual(s, { frescas: 1, atrasadas: 1, paradas: 1, nunca: 1, pausadas: 1, total: 5 });
    assert.equal(tempoRelativo(h(3), agora), 'há 3 h');
    assert.equal(tempoRelativo(null, agora), 'nunca');
    assert.equal(tempoRelativo(new Date(agora.getTime() + 5 * 86_400_000), agora), 'em 5 dias');
  });
});
