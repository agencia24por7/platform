import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

const RAIZ = resolve('.');
const raiz = mkdtempSync(join(tmpdir(), 'release-preflight-'));
const bin = join(raiz, 'bin');
const fakes = join(raiz, 'fakes');
const pilha = join(raiz, 'pilha');
const registro = join(raiz, 'chamadas.log');
const RELEASE = 'abc1234def5678';
const IMAGEM = 'us-central1-docker.pkg.dev/tria-platform/orla/app:abc1234def5678';
const SENHA_DO_WORKER = 'senhaDoWorkerQueNaoPodeVazar42';
const SEGREDO_DE_SESSAO = 'sessao'.repeat(8);
const TOKEN_DO_WORKER = 'worker'.repeat(8);
const SEGREDO_NO_COFRE = 'valor-do-secret-manager-que-nao-pode-vazar';

const escreverExecutavel = (nome, corpo) => {
  writeFileSync(join(bin, nome), corpo);
  chmodSync(join(bin, nome), 0o755);
};

const fakeGcloud = `#!/bin/sh
echo "gcloud $*" >> "${registro}"
case "$1 $2" in
  "secrets versions")
    for a in "$@"; do case "$a" in --secret=*) nome=\${a#--secret=} ;; esac; done
    [ -f "${fakes}/segredos/$nome" ] || exit 1
    cat "${fakes}/segredos/$nome"; exit 0 ;;
  "storage ls")
    for a in "$@"; do case "$a" in gs:*) b=$(printf '%s' "$a" | cut -c6-) ;; esac; done
    [ -f "${fakes}/buckets/$b" ]; exit $? ;;
  "auth print-access-token") echo "token-falso-da-vm"; exit 0 ;;
  "auth configure-docker") exit 0 ;;
  "compute instances") cat "${fakes}/estado-da-vm"; exit 0 ;;
  "compute snapshots") cat "${fakes}/snapshot" 2>/dev/null; exit 0 ;;
  "compute ssh")
    for a in "$@"; do ultimo="$a"; done
    printf '%s\\n' "$ultimo" >> "${fakes}/ssh-comandos"
    codigo=$(head -n 1 "${fakes}/ssh-codigos"); sed -i.bak '1d' "${fakes}/ssh-codigos"
    exit "\${codigo:-0}" ;;
esac
claro=""; cifrado=""; acao=""
while [ $# -gt 0 ]; do
  case "$1" in
    encrypt|decrypt) acao="$1" ;;
    --plaintext-file) claro="$2"; shift ;;
    --ciphertext-file) cifrado="$2"; shift ;;
  esac
  shift
done
[ -f "${fakes}/kms-recusa" ] && exit 1
if [ "$acao" = encrypt ]; then tr 'a-y' 'b-z' < "$claro" > "$cifrado"; else tr 'b-z' 'a-y' < "$cifrado" > "$claro"; fi
`;

const fakeBq = `#!/bin/sh
echo "bq $*" >> "${registro}"
for a in "$@"; do alvo="$a"; done
tabela=\${alvo##*.}
if [ -f "${fakes}/bq-negado" ]; then echo "Access Denied: Table $alvo"; exit 1; fi
if [ -f "${fakes}/bq/$tabela" ]; then cat "${fakes}/bq/$tabela"; exit 0; fi
echo "BigQuery error in show operation: Not found: Table $alvo"; exit 2
`;

const fakeDocker = `#!/bin/sh
echo "docker $*" >> "${registro}"
case "$1" in
  pull) [ -f "${fakes}/pull-falha" ] && exit 1; exit 0 ;;
  exec)
    case "$*" in
      *pg_isready*) exit 0 ;;
      *pg_dumpall*) echo "-- dump falso"; exit 0 ;;
    esac ;;
  compose)
    case "$*" in
      *" run "*) exec node --experimental-strip-types --no-warnings "${RAIZ}/src/shared/config/validarAmbienteCli.ts" --arquivo "$ARQUIVO_ENV" ;;
      *" up "*) exit 0 ;;
    esac ;;
esac
exit 0
`;

const fakeMigrar = join(raiz, 'migrar-falso.sh');
const fakeGh = `#!/bin/sh
echo "gh $*" >> "${registro}"
linha=$(head -n 1 "${fakes}/gh-respostas"); sed -i.bak '1d' "${fakes}/gh-respostas"
[ "$linha" = "-" ] && exit 0
printf '%s\\n' "$linha"
`;

let servidor;
let base = '';
const envios = [];
const alertas = [];
const respostas = new Map();

const rodar = (script, args, extra = {}) =>
  new Promise((resolver) => {
    const filho = spawn('sh', [script, ...args], {
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, ...extra },
    });
    let saida = '';
    filho.stdout.on('data', (pedaco) => (saida += pedaco));
    filho.stderr.on('data', (pedaco) => (saida += pedaco));
    filho.on('close', (status) => resolver({ status, saida }));
  });

const chamadas = () => (existsSync(registro) ? readFileSync(registro, 'utf8') : '');

const ENV_BASE = [
  'DATABASE_URL=postgres://orla_app:senhaDoApp1234567@postgres:5432/tria',
  `WORKER_DB_PASSWORD=${SENHA_DO_WORKER}`,
  `TRIA_WORKER_TOKEN=${TOKEN_DO_WORKER}`,
  `TRIA_SESSION_SECRET=${SEGREDO_DE_SESSAO}`,
  'TRIA_APP_BASE_URL=https://platform.exemplo.com',
  'BQ_PROJECT_ID=tria-platform',
  'BQ_DATASET=tria_dw',
  'N8N_API_KEY=chave-do-n8n-com-mais-de-vinte',
];

const LISTA_COM_CORTE = 'pendente 0043_x.sql\npendente (corte) 0121_corte_para_cofre.sql\n2 migração(ões) pendente(s).\ncorte pendente: 0121_corte_para_cofre.sql';
const SEGREDOS_OBRIGATORIOS = ['postgres-password', 'app-db-password', 'worker-db-password', 'database-url', 'worker-token', 'session-secret', 'n8n-encryption-key', 'n8n-db-password', 'proxy-basic-auth'];

function prepararPilha({ env = ENV_BASE, segredos = SEGREDOS_OBRIGATORIOS, lista = LISTA_COM_CORTE } = {}) {
  rmSync(pilha, { recursive: true, force: true });
  rmSync(fakes, { recursive: true, force: true });
  rmSync(registro, { force: true });
  envios.length = 0;
  mkdirSync(pilha, { recursive: true });
  for (const pasta of ['segredos', 'buckets', 'bq']) mkdirSync(join(fakes, pasta), { recursive: true });
  for (const arquivo of ['completar-env.sh', 'tokens-verificar-kms.sh', 'preflight-bq.txt']) copyFileSync(join('infra/compose', arquivo), join(pilha, arquivo));
  copyFileSync('db/corte-gate.txt', join(pilha, 'corte-gate.txt'));
  writeFileSync(join(pilha, '.env'), `${env.join('\n')}\n`, { mode: 0o600 });
  for (const nome of segredos) writeFileSync(join(fakes, 'segredos', `tria-producao-${nome}`), SEGREDO_NO_COFRE);
  writeFileSync(join(fakes, 'buckets', 'tria-platform-tria-producao-contexto'), '');
  writeFileSync(join(fakes, 'bq', 'gov_snapshot_fontes'), '{"schema":{"fields":[{"name":"visto_em"},{"name":"execucao_id","type":"STRING"}]}}');
  for (const tabela of ['fato_search_console_tipo_diario', 'stg_search_console_tipo_diario', 'vw_search_console_tipo_diario', 'gov_cobertura_cliente']) {
    writeFileSync(join(fakes, 'bq', tabela), '{"schema":{"fields":[]}}');
  }
  writeFileSync(join(fakes, 'lista'), `${lista}\n`);
}

const preflightVm = (extra = {}) =>
  rodar('infra/compose/preflight-vm.sh', [], {
    PILHA: pilha,
    ARQUIVO_ENV: join(pilha, '.env'),
    MIGRAR_SH: fakeMigrar,
    METADADOS_URL: `${base}/metadados`,
    GCS_UPLOAD_URL: `${base}/upload`,
    RELEASE_ID: RELEASE,
    IMAGEM,
    RELEASE_CORTE_AUTORIZADO: '1',
    BQ_DDL_APLICADO: '',
    ...extra,
  });

const METADADOS = {
  '/metadados/project/project-id': 'tria-platform',
  '/metadados/instance/zone': 'projects/1/zones/us-central1-a',
  '/metadados/instance/name': 'tria-producao-vm',
};

function atender(pedido, resposta, corpo) {
  const url = pedido.url ?? '';
  if (url.startsWith('/metadados/')) {
    const valor = METADADOS[url];
    if (pedido.headers['metadata-flavor'] !== 'Google' || !valor) {
      resposta.statusCode = 404;
      return resposta.end();
    }
    return resposta.end(valor);
  }
  if (url.startsWith('/upload/')) {
    envios.push({ url, autorizacao: pedido.headers.authorization, tamanho: corpo.length });
    return resposta.end('{}');
  }
  if (url === '/alerta') {
    alertas.push(JSON.parse(corpo));
    return resposta.end('ok');
  }
  resposta.statusCode = respostas.get(`${pedido.method} ${url.replace(/^\/app/, '')}`) ?? 404;
  return resposta.end();
}

describe('guardas da release 2026-11 (pre-flight, espera do Terraform, smoke)', { concurrency: false }, () => {
  before(async () => {
    mkdirSync(bin, { recursive: true });
    escreverExecutavel('gcloud', fakeGcloud);
    escreverExecutavel('bq', fakeBq);
    escreverExecutavel('docker', fakeDocker);
    escreverExecutavel('gh', fakeGh);
    writeFileSync(fakeMigrar, `#!/bin/sh\necho "migrar MIGRAR_MODO=$MIGRAR_MODO" >> "${registro}"\ncat "${fakes}/lista"\n`);
    servidor = createServer((pedido, resposta) => {
      let corpo = '';
      pedido.on('data', (pedaco) => (corpo += pedaco));
      pedido.on('end', () => atender(pedido, resposta, corpo));
    });
    await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    base = `http://127.0.0.1:${servidor.address().port}`;
  });

  beforeEach(() => {
    alertas.length = 0;
  });

  after(() => {
    servidor.close();
    rmSync(raiz, { recursive: true, force: true });
  });

  describe('preflight-vm.sh (na VM, antes do migrar.sh)', () => {
    it('tudo no lugar e corte autorizado: confere, faz backup lógico e grava a marca da release', async () => {
      prepararPilha();
      const r = await preflightVm();
      assert.equal(r.status, 0, r.saida);
      assert.match(r.saida, /ok: KMS/);
      assert.match(r.saida, /ok: gs:\/\/tria-platform-tria-producao-contexto/);
      assert.match(r.saida, /ok: BigQuery tria-platform:tria_dw/);
      assert.match(r.saida, /ambiente de produção válido/);
      assert.match(r.saida, /pendente \(corte\) 0121_corte_para_cofre\.sql/);
      assert.equal(envios.length, 1);
      assert.match(envios[0].url, /\/upload\/b\/tria-platform-tria-producao-backups\/o\?uploadType=media&ifGenerationMatch=0&name=postgres%2Fpre-release-abc1234def5678-/);
      assert.equal(envios[0].autorizacao, 'Bearer token-falso-da-vm');
      assert.equal(readFileSync(join(pilha, '.preflight-ok'), 'utf8').split('\n')[0], RELEASE);
      assert.match(readFileSync(join(pilha, '.env'), 'utf8'), /^CONTEXT_BUCKET=tria-platform-tria-producao-contexto$/m);
      for (const valor of [SEGREDO_NO_COFRE, SENHA_DO_WORKER, TOKEN_DO_WORKER, SEGREDO_DE_SESSAO, 'token-falso-da-vm']) {
        assert.equal(r.saida.includes(valor), false, `vazou ${valor.slice(0, 4)}…`);
      }
      assert.doesNotMatch(chamadas(), /token-falso-da-vm/);
    });

    it('corte pendente sem autorização: código 3, sem backup, sem marca', async () => {
      prepararPilha();
      const r = await preflightVm({ RELEASE_CORTE_AUTORIZADO: '0' });
      assert.equal(r.status, 3, r.saida);
      assert.match(r.saida, /BLOQUEADO: o corte/);
      assert.equal(envios.length, 0);
      assert.equal(existsSync(join(pilha, '.preflight-ok')), false);
    });

    it('sem pendências: aprova sem backup e sem exigir autorização', async () => {
      prepararPilha({ lista: '0 migração(ões) pendente(s).' });
      const r = await preflightVm({ RELEASE_CORTE_AUTORIZADO: '0' });
      assert.equal(r.status, 0, r.saida);
      assert.equal(envios.length, 0);
    });

    it('lista todos os pré-requisitos faltando e para antes de tocar no Postgres', async () => {
      const segredos = [...SEGREDOS_OBRIGATORIOS.filter((nome) => nome !== 'worker-db-password'), 'meta-app-secret'];
      prepararPilha({ segredos });
      rmSync(join(fakes, 'buckets', 'tria-platform-tria-producao-contexto'));
      writeFileSync(join(fakes, 'bq', 'gov_snapshot_fontes'), '{"schema":{"fields":[{"name":"visto_em"}]}}');
      rmSync(join(fakes, 'bq', 'gov_cobertura_cliente'));
      const r = await preflightVm();
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /FALHA: tria-producao-worker-db-password sem versão/);
      assert.match(r.saida, /FALHA: tria-producao-meta-exclusao-pepper sem versão/);
      assert.match(r.saida, /FALHA: gs:\/\/tria-platform-tria-producao-contexto inexistente/);
      assert.match(r.saida, /BigQuery sem: gov_snapshot_fontes\.execucao_id gov_cobertura_cliente/);
      assert.match(r.saida, /Nada foi tocado no banco/);
      assert.doesNotMatch(chamadas(), / up -d postgres|pg_isready|MIGRAR_MODO/);
      assert.equal(existsSync(join(pilha, '.preflight-ok')), false);
    });

    it('KMS que recusa barra o pre-flight', async () => {
      prepararPilha();
      writeFileSync(join(fakes, 'kms-recusa'), '');
      const r = await preflightVm();
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /FALHA: KMS/);
    });

    it('BigQuery não verificável pela VM exige o atestado com o nome da release', async () => {
      prepararPilha();
      writeFileSync(join(fakes, 'bq-negado'), '');
      const sem = await preflightVm();
      assert.equal(sem.status, 1, sem.saida);
      assert.match(sem.saida, /ateste com BQ_DDL_APLICADO=2026-11-cofre-e-contexto/);
      const errado = await preflightVm({ BQ_DDL_APLICADO: 'qualquer-coisa' });
      assert.equal(errado.status, 1, errado.saida);
      const com = await preflightVm({ BQ_DDL_APLICADO: '2026-11-cofre-e-contexto' });
      assert.equal(com.status, 0, com.saida);
      assert.match(com.saida, /aceito pelo atestado/);
    });

    it('ambiente que o app recusaria em produção barra, listando a chave sem o valor', async () => {
      prepararPilha({ env: ENV_BASE.map((linha) => (linha.startsWith('TRIA_WORKER_TOKEN=') ? 'TRIA_WORKER_TOKEN=curtinho' : linha)) });
      const r = await preflightVm();
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /TRIA_WORKER_TOKEN:/);
      assert.match(r.saida, /ambiente de produção inválido/);
      assert.equal(r.saida.includes('curtinho'), false);
      assert.equal(r.saida.includes(SENHA_DO_WORKER), false);
    });
  });

  describe('preflight-release.sh (no runner, antes do migrar.sh)', () => {
    const preparar = (snapshot, codigos) => {
      prepararPilha();
      writeFileSync(join(fakes, 'estado-da-vm'), 'RUNNING\n');
      if (snapshot) writeFileSync(join(fakes, 'snapshot'), `${snapshot}\n`);
      writeFileSync(join(fakes, 'ssh-codigos'), `${codigos.join('\n')}\n`);
    };
    const rodarRunner = (extra = {}) =>
      rodar('scripts/preflight-release.sh', [], {
        VM: 'tria-producao-vm',
        ZONE: 'us-central1-a',
        RELEASE_ID: RELEASE,
        IMAGEM,
        RELEASE_CORTE_AUTORIZADO: '1',
        BQ_DDL_APLICADO: '',
        PAUSA_DO_SSH: '0',
        ...extra,
      });
    const recente = () => new Date(Date.now() - 2 * 3600_000).toISOString();

    it('snapshot com mais de 24 h: aborta com o comando para tirar um, sem entrar na VM', async () => {
      preparar(new Date(Date.now() - 30 * 3600_000).toISOString(), [0]);
      const r = await rodarRunner();
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /gcloud compute disks snapshot tria-producao-dados --zone us-central1-a/);
      assert.equal(existsSync(join(fakes, 'ssh-comandos')), false);
    });

    it('sem snapshot nenhum também aborta', async () => {
      preparar('', [0]);
      const r = await rodarRunner();
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /último: nenhum/);
    });

    it('snapshot recente: roda o lado da VM com a release, a autorização e o atestado', async () => {
      preparar(recente(), [0]);
      const r = await rodarRunner({ BQ_DDL_APLICADO: '2026-11-cofre-e-contexto' });
      assert.equal(r.status, 0, r.saida);
      const comando = readFileSync(join(fakes, 'ssh-comandos'), 'utf8').trim();
      assert.equal(
        comando,
        `sudo env RELEASE_ID='${RELEASE}' IMAGEM='${IMAGEM}' RELEASE_CORTE_AUTORIZADO='1' BQ_DDL_APLICADO='2026-11-cofre-e-contexto' sh /opt/tria/preflight-vm.sh`,
      );
      assert.match(chamadas(), /snapshots list --filter=sourceDisk~\/disks\/tria-producao-dados\$ AND status=READY/);
    });

    it('repete só quando o túnel IAP cai (255) e devolve o código do lado da VM', async () => {
      preparar(recente(), [255, 255, 3]);
      const r = await rodarRunner();
      assert.equal(r.status, 3, r.saida);
      assert.match(r.saida, /BLOQUEADO/);
      assert.equal(readFileSync(join(fakes, 'ssh-comandos'), 'utf8').trim().split('\n').length, 3);
    });

    it('VM desligada aborta antes de tudo', async () => {
      preparar(recente(), [0]);
      writeFileSync(join(fakes, 'estado-da-vm'), 'TERMINATED\n');
      const r = await rodarRunner();
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /não está RUNNING/);
    });

    it('recusa entrada fora do formato (nada de injeção no comando remoto)', async () => {
      preparar(recente(), [0]);
      for (const extra of [{ RELEASE_ID: "abc'; rm -rf x" }, { BQ_DDL_APLICADO: "x' y" }, { RELEASE_CORTE_AUTORIZADO: 'true' }]) {
        const r = await rodarRunner(extra);
        assert.equal(r.status, 2, r.saida);
      }
      assert.equal(existsSync(join(fakes, 'ssh-comandos')), false);
    });
  });

  describe('aguardar-infra.sh (deploy espera o Terraform do mesmo commit)', () => {
    const aguardar = (linhas, extra) => {
      prepararPilha();
      writeFileSync(join(fakes, 'gh-respostas'), `${linhas.join('\n')}\n`);
      return rodar('scripts/release/aguardar-infra.sh', [], { SHA: RELEASE, INTERVALO: '0', CARENCIA: '0', TEMPO_MAXIMO: '60', ...extra });
    };

    it('sem execução e sem mudança de Terraform: segue', async () => {
      const r = await aguardar(['-'], { INFRA_ESPERADO: '0' });
      assert.equal(r.status, 0, r.saida);
      assert.match(chamadas(), /gh run list --workflow infra\.yml --commit abc1234def5678/);
    });

    it('sem execução mas o commit mexeu no Terraform: falha', async () => {
      const r = await aguardar(['-'], { INFRA_ESPERADO: '1' });
      assert.equal(r.status, 1, r.saida);
    });

    it('espera a execução em andamento e libera no sucesso', async () => {
      const r = await aguardar(['in_progress  11', 'waiting  11', 'completed success 11'], { INFRA_ESPERADO: '1' });
      assert.equal(r.status, 0, r.saida);
      assert.equal(chamadas().trim().split('\n').length, 3);
    });

    it('Terraform que falhou barra o deploy', async () => {
      const r = await aguardar(['completed failure 12'], { INFRA_ESPERADO: '1' });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /terminou com 'failure'/);
    });

    it('tempo esgotado falha', async () => {
      const r = await aguardar(['in_progress  13', 'in_progress  13'], { INFRA_ESPERADO: 'auto', TEMPO_MAXIMO: '0' });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /não terminou/);
    });
  });

  describe('smoke-pos-deploy.sh', () => {
    const configurar = (mapa) => {
      respostas.clear();
      for (const [chave, codigo] of Object.entries(mapa)) respostas.set(chave, codigo);
    };
    const smoke = () =>
      rodar('scripts/release/smoke-pos-deploy.sh', [`${base}/app`], {
        TENTATIVAS_DA_SAUDE: '2',
        PAUSA_DA_SAUDE: '0',
        RELEASE_ID: RELEASE,
        ALERT_WEBHOOK_URL: `${base}/alerta`,
      });

    it('saúde 200, worker 401 e cofre 404 pelo proxy: aprova sem alertar', async () => {
      configurar({ 'GET /api/health': 200, 'GET /api/v0/sync/queue': 401 });
      const r = await smoke();
      assert.equal(r.status, 0, r.saida);
      assert.equal(alertas.length, 0);
    });

    it('rota do cofre alcançável pelo proxy: reprova e alerta', async () => {
      configurar({ 'GET /api/health': 200, 'GET /api/v0/sync/queue': 401, 'POST /api/v0/coleta/token': 401 });
      const r = await smoke();
      assert.equal(r.status, 1, r.saida);
      assert.equal(alertas.length, 1);
      assert.match(alertas[0].text, /coleta\/token não passa pelo proxy \(POST\): esperado 404, veio 401/);
      assert.match(alertas[0].text, new RegExp(RELEASE));
    });

    it('saúde que não volta reprova', async () => {
      configurar({ 'GET /api/v0/sync/queue': 401 });
      const r = await smoke();
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /api\/health não respondeu 200/);
    });
  });

  describe('contexto da imagem de produção', () => {
    it('todo arquivo de scripts/ importado pelo código do app entra no build (o .dockerignore tira scripts/)', () => {
      const ignorados = readFileSync('.dockerignore', 'utf8').split('\n').map((linha) => linha.trim());
      const reincluidos = ignorados.filter((linha) => linha.startsWith('!')).map((linha) => linha.slice(1));
      const fontes = execFileSync('git', ['ls-files', 'src', 'app'], { encoding: 'utf8' })
        .split('\n')
        .filter((caminho) => (caminho.endsWith('.ts') || caminho.endsWith('.tsx')) && !caminho.endsWith('.test.ts'));
      const importacao = new RegExp("from '@/\\.\\./(scripts/[^']+)'", 'g');
      const importados = new Set();
      for (const caminho of fontes) {
        for (const [, alvo] of readFileSync(caminho, 'utf8').matchAll(importacao)) importados.add(alvo);
      }
      assert.ok(importados.size > 0);
      for (const alvo of importados) {
        assert.ok(reincluidos.some((dentro) => alvo === dentro || alvo.startsWith(`${dentro}/`)), `${alvo} fica fora da imagem`);
      }
      assert.ok(ignorados.includes('**/*.test.ts'), 'testes fora da imagem: o next build confere o tipo deles');
    });

    it('a imagem leva o validador do ambiente e o zod para o pre-flight', () => {
      const dockerfile = readFileSync('Dockerfile', 'utf8');
      for (const trecho of ['/app/src/shared/config/env.ts', '/app/src/shared/config/validarAmbiente.ts', '/app/src/shared/config/validarAmbienteCli.ts ./release/', '/app/node_modules/zod ./node_modules/zod']) {
        assert.ok(dockerfile.includes(trecho), `Dockerfile sem ${trecho}`);
      }
    });
  });

  describe('ordem no deploy.yml', () => {
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const posicao = (trecho) => {
      const i = deploy.indexOf(trecho);
      assert.ok(i > 0, `deploy.yml sem: ${trecho}`);
      return i;
    };

    it('espera o Terraform, depois pre-flight, e só então volumes, migrações, troca e smoke', () => {
      const ordem = [
        'scripts/release/aguardar-infra.sh',
        'Construir e publicar a imagem',
        'cp db/corte-gate.txt /tmp/pilha/corte-gate.txt',
        'sh scripts/preflight-release.sh',
        'Migrar volumes de tria para orla',
        "RELEASE_CORTE_AUTORIZADO='$RELEASE_CORTE_AUTORIZADO' CORTE_GATE_ARQUIVO=/opt/tria/corte-gate.txt sh /opt/tria/migrar.sh",
        'Subir a nova versão',
        'scripts/release/smoke-pos-deploy.sh',
      ].map(posicao);
      assert.deepEqual([...ordem].sort((a, b) => a - b), ordem);
    });

    it('a autorização do corte só vem do input do dispatch ou de variável explícita', () => {
      assert.match(deploy, /autorizar_corte:\n\s+description: .*\n\s+type: boolean\n\s+default: false/);
      assert.match(deploy, /RELEASE_CORTE_AUTORIZADO: \$\{\{ \(inputs\.autorizar_corte \|\| vars\.RELEASE_CORTE_AUTORIZADO == 'true'\) && '1' \|\| '0' \}\}/);
      assert.match(deploy, /actions: read/);
    });
  });
});
