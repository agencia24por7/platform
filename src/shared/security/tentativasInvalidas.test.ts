import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { criarLimitadorDeTaxa } from './rateLimit.ts';
import { vigiarConsulta, type ResultadoDaTentativa } from './tentativasInvalidas.ts';

const DESCONHECIDAS = 60;
const POR_CREDENCIAL = 60;

const dormir = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function montar(opcoes: { readonly total?: number; readonly tetoDeValidadas?: number; readonly semRecusa?: boolean } = {}) {
  let instante = 1_000_000;
  const limitador = criarLimitadorDeTaxa({
    agora: () => instante,
    ...(opcoes.tetoDeValidadas ? { tetos: { validadas: opcoes.tetoDeValidadas } } : {}),
  });
  const validasNoBanco = new Set<string>();
  let buscas = 0;

  const pedir = (ip: string, credencial: string, falhar = false) =>
    vigiarConsulta({
      janelaMs: 60_000,
      desconhecidas: { dominio: 'ip', chave: `desconhecidas:${ip}`, limite: DESCONHECIDAS },
      porCredencial: { dominio: 'webhook', chave: `credencial:${credencial}`, limite: POR_CREDENCIAL },
      validada: { chave: `teste:${credencial}` },
      ...(opcoes.semRecusa ? {} : { recusada: { chave: `teste:${credencial}` } }),
      ...(opcoes.total ? { total: { dominio: 'ip' as const, chave: `total:${ip}`, limite: opcoes.total } } : {}),
      contador: limitador,
    }).resolver(async () => {
      buscas += 1;
      await dormir(2);
      if (falhar) throw new Error('banco fora');
      return validasNoBanco.has(credencial) ? { credencial } : null;
    });

  const restamDesconhecidas = (ip: string) => {
    const { veredito, recibo } = limitador.cobrarComRecibo('ip', `desconhecidas:${ip}`, DESCONHECIDAS, 60_000);
    if (recibo) limitador.devolver(recibo);
    return veredito.allowed ? veredito.remaining + 1 : 0;
  };

  const avancar = (ms: number) => {
    instante += ms;
  };

  return { limitador, validasNoBanco, pedir, restamDesconhecidas, avancar, buscas: () => buscas };
}

const contar = <T>(resultados: readonly ResultadoDaTentativa<T>[], tipo: ResultadoDaTentativa<T>['tipo']) =>
  resultados.filter((r) => r.tipo === tipo).length;

const rajada = <T>(quantas: number, pedir: (i: number) => Promise<T>) => Promise.all(Array.from({ length: quantas }, (_, i) => pedir(i)));

describe('consulta vigiada sob concorrência real', () => {
  it('rajada de credenciais desconhecidas leva ao banco exatamente o teto por IP, e depois nada', async () => {
    const { pedir, buscas } = montar();
    const primeira = await rajada(5_000, (i) => pedir('6.6.6.6', `forjada-a-${i}`));
    assert.equal(buscas(), DESCONHECIDAS);
    assert.equal(contar(primeira, 'barrada'), 5_000 - DESCONHECIDAS);

    for (let onda = 0; onda < 4; onda += 1) {
      const outra = await rajada(5_000, (i) => pedir('6.6.6.6', `forjada-${onda}-${i}`));
      assert.equal(contar(outra, 'barrada'), 5_000);
    }
    assert.equal(buscas(), DESCONHECIDAS, 'IP barrado não toca o banco com credencial desconhecida');
  });

  it('no IP saturado por credenciais inválidas, as credenciais já validadas passam todas', async () => {
    const { pedir, validasNoBanco, buscas } = montar();
    const legitimas = Array.from({ length: 50 }, (_, i) => `legitima-${i}`);
    for (const credencial of legitimas) validasNoBanco.add(credencial);
    await rajada(legitimas.length, (i) => pedir('198.51.100.1', legitimas[i] ?? ''));

    for (let i = 0; i < 100; i += 1) await pedir('203.0.113.9', `obsoleta-${i}`);
    const antes = buscas();

    const resultados = await rajada(legitimas.length, (i) => pedir('203.0.113.9', legitimas[i] ?? ''));
    assert.equal(contar(resultados, 'barrada'), 0);
    assert.equal(contar(resultados, 'valida'), legitimas.length);
    assert.equal(buscas() - antes, legitimas.length, 'cada credencial conhecida ainda vai ao banco: revogação vale na hora');
  });

  it('credencial nova legítima num IP ruidoso ainda é descoberta enquanto sobra cota', async () => {
    const { pedir, validasNoBanco, restamDesconhecidas } = montar();
    for (let i = 0; i < 30; i += 1) await pedir('203.0.113.10', `obsoleta-${i}`);
    const novas = Array.from({ length: 25 }, (_, i) => `nova-${i}`);
    for (const credencial of novas) validasNoBanco.add(credencial);

    const resultados = await rajada(novas.length, (i) => pedir('203.0.113.10', novas[i] ?? ''));
    assert.equal(contar(resultados, 'valida'), novas.length);
    assert.equal(restamDesconhecidas('203.0.113.10'), DESCONHECIDAS - 30, 'descoberta válida devolve a cota');
  });

  it('só o banco põe credencial no registro de validadas', async () => {
    const { pedir, limitador } = montar();
    await rajada(5_000, (i) => pedir(`10.0.${Math.floor(i / 250)}.${i % 250}`, `forjada-${i}`));
    assert.equal(limitador.tamanho('validadas'), 0);
    assert.equal(limitador.tamanho('webhook'), 0, 'forjada também não cria balde por credencial');
  });

  it('credencial revogada sai do registro e passa a contar como desconhecida', async () => {
    const { pedir, validasNoBanco, limitador, restamDesconhecidas } = montar();
    validasNoBanco.add('revogavel');
    assert.equal((await pedir('192.0.2.1', 'revogavel')).tipo, 'valida');
    assert.ok(limitador.existe('validadas', 'teste:revogavel'));
    assert.equal(restamDesconhecidas('192.0.2.1'), DESCONHECIDAS);

    validasNoBanco.delete('revogavel');
    assert.equal((await pedir('192.0.2.1', 'revogavel')).tipo, 'invalida');
    assert.equal(limitador.existe('validadas', 'teste:revogavel'), false);
    assert.equal(restamDesconhecidas('192.0.2.1'), DESCONHECIDAS - 1);
  });

  it('o registro de validadas tem teto e forjar não despeja entrada legítima', async () => {
    const { pedir, validasNoBanco, limitador } = montar({ tetoDeValidadas: 100 });
    for (let i = 0; i < 500; i += 1) validasNoBanco.add(`real-${i}`);
    for (let i = 0; i < 500; i += 1) await pedir(`172.16.${Math.floor(i / 50)}.${i % 50}`, `real-${i}`);
    assert.equal(limitador.tamanho('validadas'), 100);

    await rajada(5_000, (i) => pedir(`10.1.${Math.floor(i / 250)}.${i % 250}`, `forjada-${i}`));
    assert.equal(limitador.tamanho('validadas'), 100);
    assert.ok(limitador.existe('validadas', 'teste:real-499'), 'a última validada segue no registro');
  });

  it('credencial válida martelada de 100 IPs simultâneos é servida no máximo o limite por credencial', async () => {
    const { pedir, validasNoBanco, buscas } = montar();
    validasNoBanco.add('martelada');
    const primeira = await rajada(2_000, (i) => pedir(`11.0.0.${i % 100}`, 'martelada'));
    const segunda = await rajada(2_000, (i) => pedir(`11.0.0.${i % 100}`, 'martelada'));
    assert.equal(contar([...primeira, ...segunda], 'valida'), POR_CREDENCIAL);
    assert.ok(buscas() <= 100 * DESCONHECIDAS + POR_CREDENCIAL, `buscas: ${buscas()}`);
    const antes = buscas();
    await rajada(2_000, (i) => pedir(`11.0.0.${i % 100}`, 'martelada'));
    assert.equal(buscas(), antes, 'conhecida e esgotada é recusada antes do banco');
  });

  it('falha do banco não devolve a cota: falha fechada', async () => {
    const { pedir, restamDesconhecidas } = montar();
    const resultados = await Promise.allSettled(Array.from({ length: 40 }, () => pedir('5.5.5.5', 'qualquer', true)));
    assert.equal(resultados.filter((r) => r.status === 'rejected').length, 40);
    assert.equal(restamDesconhecidas('5.5.5.5'), DESCONHECIDAS - 40);
  });

  it('o teto total por IP é cobrado de forma atômica antes do banco', async () => {
    const { pedir, validasNoBanco, buscas } = montar({ total: 300 });
    for (let i = 0; i < 640; i += 1) validasNoBanco.add(`link-${i}`);
    await rajada(640, (i) => pedir(`21.0.${Math.floor(i / 50)}.${i % 50}`, `link-${i}`));
    const antes = buscas();
    const resultados = await rajada(640, (i) => pedir('20.0.0.1', `link-${i}`));
    assert.equal(contar(resultados, 'valida'), 300);
    assert.equal(buscas() - antes, 300);
  });
});

describe('registro de credenciais recusadas', () => {
  it('token recusado repetido custa uma consulta e uma cobrança do IP por vida do registro', async () => {
    const { pedir, buscas, restamDesconhecidas, avancar } = montar();
    for (let i = 0; i < 1_000; i += 1) assert.equal((await pedir('203.0.113.20', 'revogada')).tipo, 'invalida');
    assert.equal(buscas(), 1);
    assert.equal(restamDesconhecidas('203.0.113.20'), DESCONHECIDAS - 1);

    avancar(5 * 60 * 1000 + 1);
    await pedir('203.0.113.20', 'revogada');
    assert.equal(buscas(), 2, 'vencida a vida do registro, o banco é consultado de novo');
  });

  it('instância revogada a 120/min não barra conexões novas que chegam a cada 3 s', async () => {
    const { pedir, validasNoBanco, avancar } = montar();
    let barradas = 0;
    let novas = 0;
    for (let segundo = 0; segundo < 180; segundo += 1) {
      for (let k = 0; k < 2; k += 1) await pedir('zapi-egress', 'instancia-revogada');
      if (segundo % 3 === 0) {
        const credencial = `nova-${segundo}`;
        validasNoBanco.add(credencial);
        novas += 1;
        if ((await pedir('zapi-egress', credencial)).tipo === 'barrada') barradas += 1;
      }
      avancar(1_000);
    }
    assert.equal(novas, 60);
    assert.equal(barradas, 0);
  });

  it('tokens distintos continuam consumindo a cota do IP', async () => {
    const { pedir, buscas } = montar();
    const resultados = await rajada(200, (i) => pedir('203.0.113.21', `distinta-${i}`));
    assert.equal(contar(resultados, 'barrada'), 200 - DESCONHECIDAS);
    assert.equal(buscas(), DESCONHECIDAS);
  });

  it('credencial que passa a existir depois da vida do registro é aceita e sai das recusadas', async () => {
    const { pedir, validasNoBanco, limitador, avancar } = montar();
    assert.equal((await pedir('203.0.113.22', 'futura')).tipo, 'invalida');
    assert.ok(limitador.existe('recusadas', 'teste:futura'));
    validasNoBanco.add('futura');
    avancar(5 * 60 * 1000 + 1);
    assert.equal((await pedir('203.0.113.22', 'futura')).tipo, 'valida');
    assert.equal(limitador.existe('recusadas', 'teste:futura'), false);
  });

  it('sem registro de recusa, cada repetição vai ao banco e a credencial nova vale na hora', async () => {
    const { pedir, validasNoBanco, buscas } = montar({ semRecusa: true });
    for (let i = 0; i < 5; i += 1) assert.equal((await pedir('203.0.113.23', 'convite')).tipo, 'invalida');
    assert.equal(buscas(), 5);
    validasNoBanco.add('convite');
    assert.equal((await pedir('203.0.113.23', 'convite')).tipo, 'valida');
  });

  it('o registro de recusadas tem teto', async () => {
    const limitador = criarLimitadorDeTaxa({ tetos: { recusadas: 50 } });
    for (let i = 0; i < 40; i += 1) {
      await vigiarConsulta({
        janelaMs: 60_000,
        desconhecidas: { dominio: 'ip', chave: `ip-${i}`, limite: DESCONHECIDAS },
        porCredencial: { dominio: 'webhook', chave: `c-${i}`, limite: POR_CREDENCIAL },
        validada: { chave: `v-${i}` },
        recusada: { chave: `r-${i}` },
        contador: limitador,
      }).resolver(async () => null);
    }
    assert.equal(limitador.tamanho('recusadas'), 40);
    for (let i = 40; i < 200; i += 1) {
      await vigiarConsulta({
        janelaMs: 60_000,
        desconhecidas: { dominio: 'ip', chave: `ip-${i}`, limite: DESCONHECIDAS },
        porCredencial: { dominio: 'webhook', chave: `c-${i}`, limite: POR_CREDENCIAL },
        validada: { chave: `v-${i}` },
        recusada: { chave: `r-${i}` },
        contador: limitador,
      }).resolver(async () => null);
    }
    assert.equal(limitador.tamanho('recusadas'), 50);
  });

  it('devolução de credencial validada que atravessa a virada da janela não credita a janela nova', async () => {
    let instante = 59_999;
    const limitador = criarLimitadorDeTaxa({ agora: () => instante });
    let buscas = 0;
    const consulta = (credencial: string, buscar: () => Promise<string | null>) =>
      vigiarConsulta({
        janelaMs: 60_000,
        desconhecidas: { dominio: 'ip', chave: 'virada', limite: DESCONHECIDAS },
        porCredencial: { dominio: 'webhook', chave: `c-${credencial}`, limite: POR_CREDENCIAL },
        validada: { chave: `v-${credencial}` },
        recusada: { chave: `r-${credencial}` },
        contador: limitador,
      }).resolver(async () => {
        buscas += 1;
        return buscar();
      });

    let liberar: () => void = () => undefined;
    const porta = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const emVoo = Array.from({ length: 59 }, (_, i) =>
      consulta(`em-voo-${i}`, async () => {
        await porta;
        return 'ok';
      }),
    );
    instante = 60_001;
    const antes = buscas;
    let palpites = 0;
    for (let i = 0; i < 200; i += 1) if ((await consulta(`palpite-a-${i}`, async () => null)).tipo !== 'barrada') palpites += 1;
    liberar();
    const validas = await Promise.all(emVoo);
    for (let i = 0; i < 200; i += 1) if ((await consulta(`palpite-b-${i}`, async () => null)).tipo !== 'barrada') palpites += 1;
    assert.equal(contar(validas, 'valida'), 59);
    assert.equal(palpites, DESCONHECIDAS);
    assert.equal(buscas - antes, DESCONHECIDAS);
  });
});
