import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { lerArquivoDeAmbiente, validarAmbienteDeProducao } from './validarAmbiente.ts';

const SEGREDO_DO_WORKER = 'W'.repeat(20) + 'segredo-do-worker-unico-123';
const SEGREDO_DE_SESSAO = 'S'.repeat(20) + 'sessao-unica-456789abcdef';
const SEGREDO_DE_BORDA = 'B'.repeat(16) + 'borda-unica-0123456789abcd';
const SENHA_DO_BANCO = 'senhaDoBancoQueNaoPodeVazar987';

const completo = {
  DATABASE_URL: `postgres://orla_app:${SENHA_DO_BANCO}@postgres:5432/tria`,
  DATABASE_URL_WORKER: `postgres://orla_worker:${SENHA_DO_BANCO}x@postgres:5432/tria`,
  TRIA_WORKER_TOKEN: SEGREDO_DO_WORKER,
  TRIA_SESSION_SECRET: SEGREDO_DE_SESSAO,
  TRIA_PROXY_SECRET: SEGREDO_DE_BORDA,
  TRIA_APP_BASE_URL: 'https://app.local',
  TOKENS_KMS_KEY: 'projects/p/locations/us-central1/keyRings/tria-producao-tokens/cryptoKeys/conexoes',
  CONTEXT_BUCKET: 'tria-platform-tria-producao-contexto',
  BQ_PROJECT_ID: 'tria-platform',
  ALERT_WEBHOOK_URL: 'https://alertas.local/x',
  N8N_API_KEY: 'n'.repeat(30),
};

const rodarCli = (argumentos: string[], ambiente: Record<string, string>) =>
  spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'src/shared/config/validarAmbienteCli.ts', ...argumentos], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...ambiente },
  });

describe('validação do ambiente de produção para o pre-flight da release', () => {
  it('aceita o ambiente completo', () => {
    assert.deepEqual(validarAmbienteDeProducao(completo), { erros: [], avisos: [] });
  });

  it('lista cada chave obrigatória ausente, do schema e da política da release', () => {
    const { erros } = validarAmbienteDeProducao({ ...completo, DATABASE_URL_WORKER: '', TOKENS_KMS_KEY: '', CONTEXT_BUCKET: '', BQ_PROJECT_ID: '', TRIA_PROXY_SECRET: '' });
    const chaves = erros.map((erro) => erro.split(':')[0]);
    assert.deepEqual(chaves.sort(), ['BQ_PROJECT_ID', 'CONTEXT_BUCKET', 'DATABASE_URL_WORKER', 'TOKENS_KMS_KEY', 'TRIA_PROXY_SECRET']);
  });

  it('exige a pimenta da Meta com o segredo do app e recusa par incompleto', () => {
    const { erros } = validarAmbienteDeProducao({ ...completo, META_APP_SECRET: 'segredoDaMeta1234567', GOOGLE_OAUTH_CLIENT_ID: 'id-do-google-123' });
    assert.ok(erros.some((erro) => erro.startsWith('META_EXCLUSAO_PEPPER:')), erros.join('\n'));
    assert.ok(erros.some((erro) => erro.startsWith('META_APP_ID/META_APP_SECRET:')), erros.join('\n'));
    assert.ok(erros.some((erro) => erro.startsWith('GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET:')), erros.join('\n'));
  });

  it('avisa, sem barrar, o que só desliga uma função', () => {
    const { erros, avisos } = validarAmbienteDeProducao({ ...completo, ALERT_WEBHOOK_URL: '', META_APP_ID: 'app-12345', META_APP_SECRET: 'segredoDaMeta1234567', META_EXCLUSAO_PEPPER: 'p'.repeat(40) });
    assert.deepEqual(erros, []);
    assert.ok(avisos.some((aviso) => aviso.startsWith('ALERT_WEBHOOK_URL')));
    assert.ok(avisos.some((aviso) => aviso.startsWith('LEADADS_LOGIN_CONFIG_ID')));
  });

  it('lê o .env como o compose: última linha vence, comentário e linha vazia ignorados, valor com = preservado', () => {
    assert.deepEqual(lerArquivoDeAmbiente('# c\nA=1\n\nB=x=y\nA=2\n'), { A: '2', B: 'x=y' });
  });

  it('o CLI lista as chaves faltantes sem imprimir nenhum valor do ambiente', () => {
    const ambiente = { ...completo, DATABASE_URL_WORKER: completo.DATABASE_URL, TRIA_WORKER_TOKEN: 'curto', TOKENS_KMS_KEY: `chave-invalida-${SENHA_DO_BANCO}`, CONTEXT_BUCKET: '' };
    const r = rodarCli([], ambiente);
    const saida = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, saida);
    for (const chave of ['DATABASE_URL_WORKER', 'TRIA_WORKER_TOKEN', 'TOKENS_KMS_KEY', 'CONTEXT_BUCKET']) assert.match(saida, new RegExp(`${chave}:`));
    for (const valor of [SENHA_DO_BANCO, SEGREDO_DO_WORKER, SEGREDO_DE_SESSAO, SEGREDO_DE_BORDA, 'curto', completo.N8N_API_KEY]) {
      assert.equal(saida.includes(valor), false, `vazou um valor: ${valor.slice(0, 3)}…`);
    }
  });

  it('o CLI valida um arquivo e sai 0 quando está completo', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'validar-ambiente-'));
    try {
      const arquivo = join(pasta, '.env');
      writeFileSync(arquivo, Object.entries(completo).map(([chave, valor]) => `${chave}=${valor}`).join('\n'));
      const r = rodarCli(['--arquivo', arquivo], {});
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
      assert.equal(`${r.stdout}${r.stderr}`.includes(SEGREDO_DO_WORKER), false);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
