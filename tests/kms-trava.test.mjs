import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

const pasta = mkdtempSync(join(tmpdir(), 'kms-trava-'));
const registro = join(pasta, 'gcloud.log');
const modo = join(pasta, 'modo');
writeFileSync(
  join(pasta, 'gcloud'),
  `#!/bin/sh
echo "$@" >> "${registro}"
claro=""; cifrado=""; acao=""
while [ $# -gt 0 ]; do
  case "$1" in
    encrypt|decrypt) acao="$1" ;;
    --plaintext-file) claro="$2"; shift ;;
    --ciphertext-file) cifrado="$2"; shift ;;
  esac
  shift
done
[ "$(cat "${modo}" 2>/dev/null)" = "recusa" ] && exit 1
if [ "$acao" = encrypt ]; then tr 'a-y' 'b-z' < "$claro" > "$cifrado"; else tr 'b-z' 'a-y' < "$cifrado" > "$claro"; fi
`,
);
chmodSync(join(pasta, 'gcloud'), 0o755);

const ambiente = (extra = {}) => ({ ...process.env, PATH: `${pasta}${delimiter}${process.env.PATH}`, ...extra });
const rodar = (script, args, extra) => {
  const r = spawnSync('sh', [script, ...args], { encoding: 'utf8', env: ambiente(extra) });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
};
const rodarAssincrono = (script, args, extra) =>
  new Promise((resolver) => {
    const filho = spawn('sh', [script, ...args], { env: ambiente(extra) });
    let saida = '';
    filho.stdout.on('data', (pedaco) => (saida += pedaco));
    filho.stderr.on('data', (pedaco) => (saida += pedaco));
    filho.on('close', (status) => resolver({ status, saida }));
  });
const chamadas = () => (existsSync(registro) ? readFileSync(registro, 'utf8').trim().split('\n').filter(Boolean) : []);
const arquivoEnv = (linhas) => {
  const caminho = join(pasta, `env-${Math.random().toString(36).slice(2)}`);
  writeFileSync(caminho, `${linhas.join('\n')}\n`, { mode: 0o600 });
  return caminho;
};
const BASE_DO_ENV = ['DATABASE_URL=postgres://orla_app:senha@postgres:5432/tria', 'WORKER_DB_PASSWORD=senhaDoWorker'];
const CHAVE = 'projects/tria-platform/locations/us-central1/keyRings/tria-producao-tokens/cryptoKeys/conexoes';

let servidor;
let metadados = '';

describe('trava do KMS antes das migrações do corte (ADR 0032)', () => {
  before(async () => {
    servidor = createServer((pedido, resposta) => {
      const valores = {
        '/project/project-id': 'tria-platform',
        '/instance/zone': 'projects/123/zones/us-central1-a',
        '/instance/name': 'tria-producao-vm',
      };
      const valor = valores[pedido.url ?? ''];
      if (pedido.headers['metadata-flavor'] !== 'Google' || !valor) {
        resposta.statusCode = 404;
        return resposta.end();
      }
      resposta.end(valor);
    });
    await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    metadados = `http://127.0.0.1:${servidor.address().port}`;
  });
  beforeEach(() => {
    rmSync(registro, { force: true });
    rmSync(modo, { force: true });
  });
  after(() => {
    servidor.close();
    rmSync(pasta, { recursive: true, force: true });
  });

  it('sem TOKENS_KMS_KEY válida a verificação barra o deploy e nem chama o KMS', () => {
    for (const linha of ['TOKENS_KMS_KEY=', 'TOKENS_KMS_KEY=chave-errada']) {
      const r = rodar('infra/compose/tokens-verificar-kms.sh', [arquivoEnv([...BASE_DO_ENV, linha])]);
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /Deploy interrompido antes das migrações/);
    }
    assert.deepEqual(chamadas(), []);
  });

  it('com a chave, cifra e decifra de verdade (com AAD) antes de liberar', () => {
    const r = rodar('infra/compose/tokens-verificar-kms.sh', [arquivoEnv([...BASE_DO_ENV, `TOKENS_KMS_KEY=${CHAVE}`])]);
    assert.equal(r.status, 0, r.saida);
    const feitas = chamadas();
    assert.equal(feitas.length, 2);
    assert.ok(feitas[0].startsWith('kms encrypt') && feitas[1].startsWith('kms decrypt'));
    assert.ok(feitas.every((linha) => linha.includes('--keyring tria-producao-tokens') && linha.includes('--additional-authenticated-data-file')));
  });

  it('KMS que recusa (IAM ou API desligada) barra o deploy', () => {
    writeFileSync(modo, 'recusa');
    const r = rodar('infra/compose/tokens-verificar-kms.sh', [arquivoEnv([...BASE_DO_ENV, `TOKENS_KMS_KEY=${CHAVE}`])]);
    assert.equal(r.status, 1, r.saida);
  });

  it('completar-env.sh grava a chave derivada dos metadados quando falta, e mantém a existente', async () => {
    const semChave = arquivoEnv(BASE_DO_ENV);
    const r = await rodarAssincrono('infra/compose/completar-env.sh', [semChave], { METADADOS_URL: metadados });
    assert.equal(r.status, 0, r.saida);
    assert.ok(readFileSync(semChave, 'utf8').includes(`TOKENS_KMS_KEY=${CHAVE}\n`));

    const comChave = arquivoEnv([...BASE_DO_ENV, 'TOKENS_KMS_KEY=projects/p/locations/l/keyRings/r/cryptoKeys/k']);
    await rodarAssincrono('infra/compose/completar-env.sh', [comChave], { METADADOS_URL: metadados });
    const conteudo = readFileSync(comChave, 'utf8');
    assert.ok(conteudo.includes('TOKENS_KMS_KEY=projects/p/locations/l/keyRings/r/cryptoKeys/k\n'));
    assert.equal(conteudo.match(/^TOKENS_KMS_KEY=/gm).length, 1);
  });

  it('sem metadados a chave fica vazia e a verificação seguinte barra', () => {
    const semChave = arquivoEnv(BASE_DO_ENV);
    const r = rodar('infra/compose/completar-env.sh', [semChave], { METADADOS_URL: 'http://127.0.0.1:9' });
    assert.equal(r.status, 0, r.saida);
    assert.equal(rodar('infra/compose/tokens-verificar-kms.sh', [semChave]).status, 1);
  });

  it('o deploy verifica o KMS e baixa a imagem nova antes de aplicar as migrações', () => {
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const verificar = deploy.indexOf('tokens-verificar-kms.sh');
    const baixar = deploy.indexOf("docker pull '$IMAGE");
    const migrar = deploy.indexOf('sh /opt/tria/migrar.sh');
    assert.ok(verificar > 0 && baixar > verificar && migrar > baixar);
  });
});
