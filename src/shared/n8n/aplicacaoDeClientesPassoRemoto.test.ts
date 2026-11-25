import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const lerYml = (): string => readFileSync(join(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');

const scriptRemoto = (): string => {
  const yml = lerYml();
  const inicio = yml.indexOf("<<'EOS'\n");
  const fim = yml.indexOf('\n          EOS\n', inicio);
  assert.ok(inicio > 0 && fim > inicio, 'script remoto não encontrado no deploy.yml');
  return yml
    .slice(inicio + "<<'EOS'\n".length, fim)
    .split('\n')
    .map((linha) => linha.replace(/^ {10}/, ''))
    .join('\n');
};

function rodarRemoto(dir: string, run = { id: '100', tentativa: '1' }) {
  const corpo = scriptRemoto();
  assert.ok(corpo.includes('dir=/var/backups/tria-n8n\n'), 'diretório de cópias não encontrado');
  const adaptado = corpo.replace('dir=/var/backups/tria-n8n\n', `dir=${dir}\n`);
  const r = spawnSync('bash', ['-s'], {
    input: `imagem=node\nrun_id=${run.id}\ntentativa_do_run=${run.tentativa}\n${adaptado}\n`,
    encoding: 'utf8',
    timeout: 30000,
  });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

const novoDir = () => mkdtempSync(join(tmpdir(), 'n8n-remoto-'));
const carimbo = (minuto: number) => `20261124T12${String(minuto).padStart(2, '0')}00Z`;
const gravarLog = (dir: string, minuto: number, run: string, tentativa: string, conteudo: string, rc?: string) => {
  const caminho = join(dir, `aplicacao-${carimbo(minuto)}-${run}-${tentativa}.log`);
  writeFileSync(caminho, conteudo);
  if (rc !== undefined) writeFileSync(`${caminho}.rc`, rc);
  return caminho;
};

const CHEGOU_ADIANTE = /N8N_API_KEY ausente/;

test('nova tentativa do mesmo run e tentativa não aplica de novo e devolve o desfecho do log existente', () => {
  const casos: [string, number][] = [
    ['0\n', 0],
    ['2\n', 2],
    ['1\n', 1],
    ['7\n', 1],
  ];
  for (const [rc, esperado] of casos) {
    const dir = novoDir();
    gravarLog(dir, 1, '100', '1', 'saida do contêiner\n', rc);
    const r = rodarRemoto(dir);
    assert.equal(r.codigo, esperado, `${rc.trim()}: ${r.saida}`);
    assert.match(r.saida, /não aplico de novo/);
    assert.match(r.saida, /saida do contêiner/);
    assert.doesNotMatch(r.saida, CHEGOU_ADIANTE);
  }
});

test('desfecho não numérico no .rc é erro com mensagem clara', () => {
  const dir = novoDir();
  gravarLog(dir, 1, '100', '1', 'x\n', '1x\n');
  const r = rodarRemoto(dir);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /desfecho desconhecido/);
});

test('run ou tentativa diferente não reaproveita o log anterior', () => {
  const dir = novoDir();
  gravarLog(dir, 1, '100', '1', 'x\n', '0\n');
  const outraTentativa = rodarRemoto(dir, { id: '100', tentativa: '2' });
  assert.match(outraTentativa.saida, CHEGOU_ADIANTE);
  const outroRun = rodarRemoto(dir, { id: '10', tentativa: '1' });
  assert.match(outroRun.saida, CHEGOU_ADIANTE);
});

test('estado-pendente no log mais recente de outro run bloqueia antes de aplicar', () => {
  const dir = novoDir();
  gravarLog(dir, 1, '90', '1', 'x\nestado-pendente: w1 restauracao-nao-confirmada\n', '1\n');
  const r = rodarRemoto(dir);
  assert.equal(r.codigo, 1);
  assert.match(r.saida, /deixou estado-pendente/);
  assert.match(r.saida, /estado-pendente: w1 restauracao-nao-confirmada/);
  assert.doesNotMatch(r.saida, CHEGOU_ADIANTE);
});

test('só o log mais recente conta: pendência antiga seguida de log limpo não bloqueia', () => {
  const dir = novoDir();
  gravarLog(dir, 1, '90', '1', 'estado-pendente: w1 x\n', '1\n');
  gravarLog(dir, 2, '91', '1', 'tudo certo\n', '0\n');
  const r = rodarRemoto(dir);
  assert.doesNotMatch(r.saida, /estado-pendente/);
  assert.match(r.saida, CHEGOU_ADIANTE);
});

test('log com falha de rede comum, sem estado-pendente, não bloqueia', () => {
  const dir = novoDir();
  gravarLog(dir, 1, '90', '1', 'ERRO ... HTTP 503\n', '2\n');
  assert.match(rodarRemoto(dir).saida, CHEGOU_ADIANTE);
});

test('renomear o log com pendência libera a próxima aplicação', () => {
  const dir = novoDir();
  const log = gravarLog(dir, 1, '90', '1', 'estado-pendente: w1 x\n', '1\n');
  assert.equal(rodarRemoto(dir).codigo, 1);
  const r = spawnSync('mv', [log, `${log}.resolvido`]);
  assert.equal(r.status, 0);
  assert.match(rodarRemoto(dir).saida, CHEGOU_ADIANTE);
});

test('mantém só os 30 logs mais recentes, com seus .rc', () => {
  const dir = novoDir();
  for (let minuto = 0; minuto < 35; minuto += 1) gravarLog(dir, minuto, '50', '1', 'ok\n', '0\n');
  const r = rodarRemoto(dir, { id: '200', tentativa: '1' });
  assert.match(r.saida, CHEGOU_ADIANTE);
  const logs = readdirSync(dir).filter((nome) => nome.endsWith('.log'));
  assert.equal(logs.length, 30);
  assert.ok(!logs.some((nome) => nome.includes(carimbo(0))));
  assert.ok(logs.some((nome) => nome.includes(carimbo(34))));
  assert.equal(readdirSync(dir).filter((nome) => nome.endsWith('.rc')).length, 30);
});

test('deploy.yml: os tempos são coerentes (timeout do passo maior que espera interna mais flock)', () => {
  const yml = lerYml();
  const remoto = scriptRemoto();
  const timeoutDoPasso = Number(/id: n8n_clientes\n\s+timeout-minutes: (\d+)/.exec(yml)?.[1]) * 60;
  const iteracoes = Number(/"\$esperou" -gt (\d+)/.exec(remoto)?.[1]);
  const pausa = Number(/esperou=\$\(\(esperou \+ 1\)\)[\s\S]*?sleep (\d+)/.exec(remoto)?.[1]);
  const flock = Number(/flock -w (\d+)/.exec(yml)?.[1]);
  assert.ok(timeoutDoPasso > 0 && iteracoes > 0 && pausa > 0 && flock > 0, 'tempos não encontrados no deploy.yml');
  const esperaInterna = iteracoes * pausa;
  assert.ok(esperaInterna >= 420 && esperaInterna <= 540, `espera interna ${esperaInterna}s deveria ficar em torno de 8 minutos`);
  assert.ok(timeoutDoPasso > esperaInterna + flock, `timeout do passo ${timeoutDoPasso}s tem de superar espera interna ${esperaInterna}s mais flock ${flock}s`);
});
