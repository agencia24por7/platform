import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

const RAIZ = resolve('.');
const raiz = mkdtempSync(join(tmpdir(), 'metadados-'));
const bin = join(raiz, 'bin');
const estado = join(raiz, 'estado');
const registro = join(raiz, 'chamadas.log');

const ler = (caminho) => readFileSync(join(RAIZ, caminho), 'utf8');

const escreverExecutavel = (nome, corpo) => {
  writeFileSync(join(bin, nome), corpo);
  chmodSync(join(bin, nome), 0o755);
};

const emuladorDeTabelas = `#!/bin/sh
nome=$(basename "$0")
case "$nome" in
  ip6tables*) arquivo="${estado}/v6" ;;
  *) arquivo="${estado}/v4" ;;
esac
touch "$arquivo"
echo "$nome $*" >> "${registro}"
historico() { { echo "$1"; grep -F -- "-A DOCKER-USER " "$arquivo" | sed 's/^/    /'; } >> "${registro}.historico"; }
case "$nome" in
  *-restore)
    while IFS= read -r linha; do
      case "$linha" in
        "*filter"|COMMIT|"") ;;
        :*) cadeia=\${linha#:}; cadeia=\${cadeia%% *}; grep -qxF -- "-N $cadeia" "$arquivo" || echo "-N $cadeia" >> "$arquivo" ;;
        "-F "*) cadeia=\${linha#-F }; grep -vF -- "-A $cadeia " "$arquivo" > "$arquivo.tmp" || true; mv "$arquivo.tmp" "$arquivo" ;;
        "-A "*) echo "$linha" >> "$arquivo" ;;
      esac
    done
    exit 0 ;;
esac
while [ "$1" = -w ] || [ "$1" = -t ]; do
  if [ "$1" = -t ]; then shift; fi
  shift
done
acao="$1"; cadeia="$2"; shift 2
case "$acao" in
  -S) grep -qxF -- "-N $cadeia" "$arquivo" || exit 1; grep -xF -- "-N $cadeia" "$arquivo"; grep -F -- "-A $cadeia " "$arquivo"; exit 0 ;;
  -N) echo "-N $cadeia" >> "$arquivo"; exit 0 ;;
  -C) grep -qxF -- "-A $cadeia $*" "$arquivo"; exit $? ;;
  -I) posicao="$1"; shift; awk -v c="-A $cadeia " -v n="$posicao" -v nova="-A $cadeia $*" 'index($0, c) == 1 { k++; if (k == n) { print nova; feita = 1 } } { print } END { if (!feita) print nova }' "$arquivo" > "$arquivo.tmp"; mv "$arquivo.tmp" "$arquivo"; historico "$nome $acao $cadeia $posicao $*"; exit 0 ;;
  -D) case "$1" in
        [0-9]*) awk -v c="-A $cadeia " -v n="$1" 'index($0, c) == 1 { k++; if (k == n) next } { print }' "$arquivo" > "$arquivo.tmp"; mv "$arquivo.tmp" "$arquivo"; historico "$nome $acao $cadeia $1"; exit 0 ;;
      esac
      grep -qxF -- "-A $cadeia $*" "$arquivo" || exit 1; grep -vxF -- "-A $cadeia $*" "$arquivo" > "$arquivo.tmp" || true; mv "$arquivo.tmp" "$arquivo"; exit 0 ;;
esac
exit 1
`;

const SHELL_DE_TESTE = spawnSync('sh', ['-c', 'command -v dash'], { encoding: 'utf8' }).stdout.trim() ? 'dash' : 'sh';

const rodar = (script, args, extra = {}) => {
  const r = spawnSync(SHELL_DE_TESTE, [script, ...args], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, ARQUIVO_DE_ALERTA: join(raiz, 'alerta', 'metadados-bloqueio.log'), ...extra },
  });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
};

const chamadas = () => (existsSync(registro) ? readFileSync(registro, 'utf8') : '');

beforeEach(() => {
  rmSync(raiz, { recursive: true, force: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(estado, { recursive: true });
  for (const nome of ['iptables', 'iptables-restore', 'ip6tables', 'ip6tables-restore']) escreverExecutavel(nome, emuladorDeTabelas);
  escreverExecutavel('systemctl', `#!/bin/sh\necho "systemctl $*" >> "${registro}"\n`);
});

after(() => rmSync(raiz, { recursive: true, force: true }));

const servicos = (compose) => {
  const bloco = compose.slice(compose.indexOf('\nservices:\n'), compose.indexOf('\nnetworks:\n'));
  const mapa = {};
  let atual = null;
  for (const linha of bloco.split('\n')) {
    const cabecalho = linha.match(/^ {2}([a-z0-9_]+):\s*$/);
    if (cabecalho) atual = cabecalho[1];
    const redes = linha.match(/^ {4}networks:\s*\[([^\]]*)\]/);
    if (atual && redes) mapa[atual] = redes[1].split(',').map((rede) => rede.trim()).filter(Boolean);
  }
  return mapa;
};

describe('compose: só o app tem saída pela ponte que alcança os metadados', () => {
  const compose = ler('infra/compose/docker-compose.prod.yml');
  const redes = servicos(compose);
  const blocoDeRedes = compose.slice(compose.indexOf('\nnetworks:\n'), compose.indexOf('\nvolumes:\n'));

  it('o app fica em interna e saida_app, e nenhum outro serviço usa saida_app', () => {
    assert.deepEqual(redes.app, ['interna', 'saida_app']);
    for (const [nome, lista] of Object.entries(redes)) {
      if (nome !== 'app') assert.ok(!lista.includes('saida_app'), `${nome} não pode usar saida_app`);
    }
    for (const nome of ['postgres', 'n8n', 'proxy']) assert.ok(redes[nome], `${nome} sem redes declaradas`);
  });

  it('a rede compartilhada é interna (sem rota de saída) e o Postgres não tem saída', () => {
    assert.match(blocoDeRedes, /\n {2}interna:\n {4}driver: bridge\n {4}internal: true\n/);
    assert.deepEqual(redes.postgres, ['interna']);
  });

  it('a ponte do app tem o nome que o bloqueio libera, e a transição espera o mesmo internal', () => {
    const ponte = blocoDeRedes.match(/\n {2}saida_app:\n(?: {4}.*\n)*? {6}com\.docker\.network\.bridge\.name: ([a-z0-9-]+)\n/);
    assert.ok(ponte, 'saida_app sem nome de ponte fixo');
    assert.ok(ponte[1].length <= 15);
    assert.match(ler('infra/compose/metadados-bloquear.sh'), new RegExp(`PONTE_DO_APP="\\$\\{PONTE_DO_APP:-${ponte[1]}\\}"`));
    assert.match(ler('infra/compose/rede-transicao.sh'), /^INTERNA_DESEJADA=true$/m);
    assert.doesNotMatch(blocoDeRedes, /enable_ipv6: true/);
  });
});

describe('metadados-bloquear.sh', () => {
  const script = 'infra/compose/metadados-bloquear.sh';
  const v4 = () => readFileSync(join(estado, 'v4'), 'utf8');

  it('aplica a cadeia com a exceção só para a ponte do app e o salto em DOCKER-USER', () => {
    const r = rodar(script, ['aplicar']);
    assert.equal(r.status, 0, r.saida);
    const regras = v4();
    assert.ok(regras.includes('-A DOCKER-USER -j ORLA-METADADOS'));
    assert.ok(regras.includes('-A ORLA-METADADOS -d 169.254.169.254/32 -i orla-app -j RETURN'));
    assert.ok(regras.includes('-A ORLA-METADADOS -d 169.254.169.254/32 -p udp -m udp --dport 53 -j RETURN'));
    assert.ok(regras.includes('-A ORLA-METADADOS -d 169.254.169.254/32 -p tcp -j REJECT --reject-with tcp-reset'));
    assert.ok(regras.includes('-A ORLA-METADADOS -d 169.254.169.254/32 -j REJECT --reject-with icmp-port-unreachable'));
    assert.equal(regras.split('\n').filter((linha) => linha.startsWith('-A ORLA-METADADOS ')).length, 5);
    const ordem = ['--dport 53', '-i orla-app', 'tcp-reset', 'icmp-port-unreachable'].map((trecho) => regras.indexOf(trecho));
    assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, 'a exceção vem antes do REJECT');
    assert.ok(readFileSync(join(estado, 'v6'), 'utf8').includes('-d fd20:ce::254/128 -j REJECT --reject-with icmp6-port-unreachable'));
  });

  it('é idempotente: a segunda execução não reescreve nada', () => {
    rodar(script, ['aplicar']);
    rmSync(registro, { force: true });
    const r = rodar(script, ['aplicar']);
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /iptables: regras de metadados já no lugar/);
    assert.doesNotMatch(chamadas(), /-restore/);
    assert.equal(v4().split('\n').filter((linha) => linha === '-A DOCKER-USER -j ORLA-METADADOS').length, 1);
  });

  it('verificar reprova regra adulterada e aplicar a reconstrói', () => {
    rodar(script, ['aplicar']);
    writeFileSync(join(estado, 'v4'), v4().replace('-A ORLA-METADADOS -d 169.254.169.254/32 -p tcp -j REJECT --reject-with tcp-reset\n', '-A ORLA-METADADOS -j ACCEPT\n'));
    assert.equal(rodar(script, ['verificar']).status, 1);
    assert.equal(rodar(script, ['aplicar']).status, 0);
    assert.equal(rodar(script, ['verificar']).status, 0);
    assert.doesNotMatch(v4(), /-j ACCEPT/);
  });

  it('instalar grava o drop-in do docker que reaplica antes e depois de cada início', () => {
    const instalado = join(raiz, 'sbin', 'orla-metadados-bloquear');
    const pasta = join(raiz, 'docker.service.d');
    const r = rodar(script, ['instalar'], { INSTALADO: instalado, PASTA_DO_DOCKER: pasta, PASTA_DAS_UNIDADES: join(raiz, 'unidades') });
    assert.equal(r.status, 0, r.saida);
    assert.equal(readFileSync(instalado, 'utf8'), ler(script));
    const dropin = readFileSync(join(pasta, 'orla-metadados.conf'), 'utf8');
    assert.ok(dropin.includes(`ExecStartPre=-${instalado} aplicar`));
    assert.ok(dropin.includes(`ExecStartPost=-${instalado} aplicar`));
    assert.match(chamadas(), /systemctl daemon-reload/);
  });

  it('instalar grava o serviço e o timer da vigia, liga o timer e é idempotente', () => {
    const instalado = join(raiz, 'sbin', 'orla-metadados-bloquear');
    const unidades = join(raiz, 'unidades');
    const ambiente = { INSTALADO: instalado, PASTA_DO_DOCKER: join(raiz, 'docker.service.d'), PASTA_DAS_UNIDADES: unidades };
    assert.equal(rodar(script, ['instalar'], ambiente).status, 0);
    const servico = readFileSync(join(unidades, 'orla-metadados-vigiar.service'), 'utf8');
    assert.ok(servico.includes('Type=oneshot'));
    assert.ok(servico.includes('After=docker.service'));
    assert.ok(servico.includes(`ExecStart=${instalado} vigiar`));
    const temporizador = readFileSync(join(unidades, 'orla-metadados-vigiar.timer'), 'utf8');
    assert.match(temporizador, /^OnBootSec=2min$/m);
    assert.match(temporizador, /^OnUnitInactiveSec=5min$/m);
    assert.match(temporizador, /^WantedBy=timers\.target$/m);
    assert.match(chamadas(), /systemctl enable --now orla-metadados-vigiar\.timer/);
    rmSync(registro, { force: true });
    assert.equal(rodar(script, ['instalar'], ambiente).status, 0);
    assert.doesNotMatch(chamadas(), /daemon-reload/);
  });

  it('sem ação conhecida sai 2 sem tocar em regra', () => {
    assert.equal(rodar(script, []).status, 2);
    assert.equal(rodar(script, ['--help']).status, 0);
    assert.doesNotMatch(chamadas(), /iptables/);
  });
});

describe('metadados-bloquear.sh: salto na primeira posição e vigia', () => {
  const script = 'infra/compose/metadados-bloquear.sh';
  const v4 = () => readFileSync(join(estado, 'v4'), 'utf8');
  const marcador = 'orla-metadados-bloqueio-ausente';
  const primeiraDaDockerUser = () => v4().split('\n').find((linha) => linha.startsWith('-A DOCKER-USER '));
  const colocarRegraAntesDoSalto = () => writeFileSync(join(estado, 'v4'), `-A DOCKER-USER -j RETURN\n${v4()}`);

  it('verificar reprova o salto que existe mas não é a primeira regra, e aplicar o recoloca na frente sem duplicar', () => {
    rodar(script, ['aplicar']);
    colocarRegraAntesDoSalto();
    assert.equal(rodar(script, ['verificar']).status, 1);
    assert.equal(rodar(script, ['aplicar']).status, 0);
    assert.equal(primeiraDaDockerUser(), '-A DOCKER-USER -j ORLA-METADADOS');
    assert.equal(v4().split('\n').filter((linha) => linha === '-A DOCKER-USER -j ORLA-METADADOS').length, 1);
    assert.equal(rodar(script, ['verificar']).status, 0);
  });

  it('vigiar com tudo no lugar sai 0, sem escrever o marcador e sem reaplicar', () => {
    rodar(script, ['aplicar']);
    rmSync(registro, { force: true });
    const r = rodar(script, ['vigiar']);
    assert.equal(r.status, 0, r.saida);
    assert.ok(!r.saida.includes(marcador));
    assert.doesNotMatch(chamadas(), /-restore/);
  });

  it('vigiar sem a cadeia reaplica uma vez, confere e registra o marcador com severidade error', () => {
    const r = rodar(script, ['vigiar']);
    assert.equal(r.status, 0, r.saida);
    const linha = r.saida.split('\n').find((l) => l.includes(marcador));
    assert.ok(linha, r.saida);
    const registroJson = JSON.parse(linha);
    assert.equal(registroJson.severity, 'error');
    assert.equal(registroJson.marker, marcador);
    assert.equal(registroJson.resultado, 'reinstalado');
    assert.equal(rodar(script, ['verificar']).status, 0);
  });

  it('vigiar com o salto fora da primeira posição reinstala e registra o marcador', () => {
    rodar(script, ['aplicar']);
    colocarRegraAntesDoSalto();
    const r = rodar(script, ['vigiar']);
    assert.equal(r.status, 0, r.saida);
    assert.ok(r.saida.includes(marcador));
    assert.equal(primeiraDaDockerUser(), '-A DOCKER-USER -j ORLA-METADADOS');
  });

  it('em nenhum passo da reinserção do salto a DOCKER-USER fica sem ele, e as duplicatas somem', () => {
    const salto = '-A DOCKER-USER -j ORLA-METADADOS';
    writeFileSync(join(estado, 'v4'), `-N DOCKER-USER\n-A DOCKER-USER -j RETURN\n${salto}\n-A DOCKER-USER -j RETURN\n${salto}\n`);
    const r = rodar(script, ['aplicar']);
    assert.equal(r.status, 0, r.saida);
    const passos = readFileSync(`${registro}.historico`, 'utf8').split(/\n(?=\S)/).filter((p) => p.startsWith('iptables '));
    assert.ok(passos.length >= 3, 'espera uma inserção e duas remoções por número');
    assert.match(passos[0], /^iptables -I DOCKER-USER 1 -j ORLA-METADADOS/);
    for (const passo of passos) assert.ok(passo.includes(salto), `salto ausente após: ${passo}`);
    assert.ok(passos.slice(1).every((p) => p.startsWith('iptables -D DOCKER-USER ')));
    const numeros = passos.slice(1).map((p) => Number(p.split('\n')[0].split(' ').pop()));
    assert.deepEqual(numeros, [...numeros].sort((a, b) => b - a));
    assert.equal(v4().split('\n').filter((l) => l === salto).length, 1);
    assert.equal(primeiraDaDockerUser(), salto);
  });

  it('aplicar e vigiar pedem a trava com flock quando ele existe', () => {
    escreverExecutavel('flock', `#!/bin/sh\necho "flock $*" >> "${registro}"\nexit 0\n`);
    const trava = join(raiz, 'trava', 'orla.lock');
    assert.equal(rodar(script, ['aplicar'], { ARQUIVO_DE_TRAVA: trava }).status, 0);
    assert.equal(rodar(script, ['vigiar'], { ARQUIVO_DE_TRAVA: trava }).status, 0);
    assert.equal(chamadas().split('\n').filter((l) => l.startsWith('flock -w ')).length, 2);
  });

  it('se a trava não sai no prazo, aplica mesmo assim e avisa', () => {
    escreverExecutavel('flock', '#!/bin/sh\nexit 1\n');
    const r = rodar(script, ['aplicar'], { ARQUIVO_DE_TRAVA: join(raiz, 'trava', 'orla.lock') });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /não obtive a trava/);
    assert.equal(rodar(script, ['verificar']).status, 0);
  });

  it('instalar com a vigia falhando ainda aplica o bloqueio e sai diferente de zero', () => {
    escreverExecutavel('systemctl', `#!/bin/sh\necho "systemctl $*" >> "${registro}"\ncase "$*" in *"enable --now"*) exit 1 ;; esac\nexit 0\n`);
    const r = rodar(script, ['instalar'], { INSTALADO: join(raiz, 'sbin', 'orla-metadados-bloquear'), PASTA_DO_DOCKER: join(raiz, 'docker.service.d'), PASTA_DAS_UNIDADES: join(raiz, 'unidades') });
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /FALHA: a vigia orla-metadados-vigiar não foi instalada ou ligada/);
    assert.equal(rodar(script, ['verificar']).status, 0);
  });

  it('instalar com a vigia e o bloqueio falhando reflete as duas falhas', () => {
    escreverExecutavel('systemctl', `#!/bin/sh\ncase "$*" in *"enable --now"*) exit 1 ;; esac\nexit 0\n`);
    escreverExecutavel('iptables-restore', '#!/bin/sh\ncat > /dev/null\nexit 1\n');
    const r = rodar(script, ['instalar'], { INSTALADO: join(raiz, 'sbin', 'orla-metadados-bloquear'), PASTA_DO_DOCKER: join(raiz, 'docker.service.d'), PASTA_DAS_UNIDADES: join(raiz, 'unidades') });
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /FALHA: a vigia/);
    assert.match(r.saida, /FALHA: bloqueio IPv4 de metadados não aplicado/);
  });

  it('vigiar no journal prefixa a linha com <3> para o systemd gravar como erro', () => {
    const r = rodar(script, ['vigiar'], { JOURNAL_STREAM: '8:12345' });
    assert.ok(r.saida.split('\n').some((l) => l.startsWith('<3>{') && l.includes(marcador)), r.saida);
  });

  it('vigiar com o restore falhando tenta uma vez, sai 1 e marca como persistente', () => {
    escreverExecutavel('iptables-restore', `#!/bin/sh\necho "iptables-restore $*" >> "${registro}"\ncat > /dev/null\nexit 1\n`);
    const r = rodar(script, ['vigiar']);
    assert.equal(r.status, 1, r.saida);
    assert.equal(JSON.parse(r.saida.split('\n').find((l) => l.includes(marcador))).resultado, 'persistente');
    assert.equal(chamadas().split('\n').filter((l) => l.startsWith('iptables-restore')).length, 1);
  });
});

describe('metadados-bloquear.sh vigiar: arquivo de alerta para o Cloud Logging', () => {
  const script = 'infra/compose/metadados-bloquear.sh';
  const arquivo = join(raiz, 'alerta', 'metadados-bloqueio.log');

  it('não cria o arquivo quando o bloqueio está no lugar', () => {
    rodar(script, ['aplicar']);
    assert.equal(rodar(script, ['vigiar']).status, 0);
    assert.ok(!existsSync(arquivo));
  });

  it('grava a mesma linha JSON, sem o prefixo do journal, com permissão 0640', () => {
    const r = rodar(script, ['vigiar'], { JOURNAL_STREAM: '8:12345' });
    assert.equal(r.status, 0, r.saida);
    const linhas = readFileSync(arquivo, 'utf8').trim().split('\n');
    assert.equal(linhas.length, 1);
    const registroJson = JSON.parse(linhas[0]);
    assert.equal(registroJson.severity, 'error');
    assert.equal(registroJson.marker, 'orla-metadados-bloqueio-ausente');
    assert.equal(registroJson.resultado, 'reinstalado');
    assert.ok(r.saida.includes(`<3>${linhas[0]}`));
    assert.equal(statSync(arquivo).mode & 0o777, 0o640);
  });

  it('com o restore falhando grava resultado persistente', () => {
    escreverExecutavel('iptables-restore', '#!/bin/sh\ncat > /dev/null\nexit 1\n');
    assert.equal(rodar(script, ['vigiar']).status, 1);
    assert.equal(JSON.parse(readFileSync(arquivo, 'utf8').trim()).resultado, 'persistente');
  });

  it('limita o tamanho: acima do limite o arquivo é esvaziado antes da nova linha', () => {
    mkdirSync(join(raiz, 'alerta'), { recursive: true });
    writeFileSync(arquivo, `${'x'.repeat(200)}\n`);
    const r = rodar(script, ['vigiar'], { LIMITE_DO_ARQUIVO_DE_ALERTA: '100' });
    assert.equal(r.status, 0, r.saida);
    const linhas = readFileSync(arquivo, 'utf8').trim().split('\n');
    assert.equal(linhas.length, 1);
    assert.equal(JSON.parse(linhas[0]).marker, 'orla-metadados-bloqueio-ausente');
  });

  it('falha ao gravar o arquivo não muda o resultado do vigia', () => {
    mkdirSync(raiz, { recursive: true });
    writeFileSync(join(raiz, 'arquivo-comum'), '');
    const r = rodar(script, ['vigiar'], { ARQUIVO_DE_ALERTA: join(raiz, 'arquivo-comum', 'sub', 'a.log') });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /aviso: não consegui preparar/);
  });

  it('o Ops Agent lê só esse arquivo em pipeline próprio e a métrica ignora linhas de teste', () => {
    const agente = ler('infra/terraform/files/startup.sh.tftpl');
    assert.match(agente, /metadados_bloqueio:\n {6}type: files\n {6}include_paths:\n {8}- \/var\/log\/orla\/metadados-bloqueio\.log\n/);
    assert.match(agente, /receivers: \[metadados_bloqueio\]/);
    assert.match(agente, /receivers: \[containers_docker\]/);
    const tf = ler('infra/terraform/observabilidade.tf');
    assert.match(tf, /jsonPayload\.resultado=\(\\"reinstalado\\" OR \\"persistente\\"\)/);
    assert.match(tf, /logs\/metadados_bloqueio\\"/);
  });
});

describe('rede-transicao.sh', () => {
  const pilha = join(raiz, 'pilha');
  const preparar = ({ internal, imagem = true, postgresNoAr = true, bloqueioFalha = false }) => {
    mkdirSync(pilha, { recursive: true });
    writeFileSync(join(pilha, '.env'), imagem ? 'APP_IMAGE=registro/app:abc\n' : 'OUTRA=1\n');
    writeFileSync(join(pilha, 'bloquear.sh'), `echo "bloqueio $*" >> "${registro}"\n${bloqueioFalha ? 'exit 1' : 'exit 0'}\n`);
    escreverExecutavel(
      'docker',
      `#!/bin/sh
echo "docker $*" >> "${registro}"
case "$1 $2" in
  "network inspect")
    ${internal === undefined ? 'exit 1' : `case "$*" in *-f*) echo ${internal} ;; esac; exit 0`} ;;
  "ps -q") ${postgresNoAr ? 'echo abc123' : ':'}; exit 0 ;;
esac
exit 0
`,
    );
  };
  const transicao = () => rodar('infra/compose/rede-transicao.sh', [], { PILHA: pilha, BLOQUEAR: join(pilha, 'bloquear.sh') });
  const passos = () => chamadas().split('\n').filter((linha) => / down | up -d|^bloqueio /.test(`${linha} `));

  it('rede antiga sem internal: para, instala o bloqueio e religa, nessa ordem', () => {
    preparar({ internal: false });
    const r = transicao();
    assert.equal(r.status, 0, r.saida);
    const p = passos();
    assert.equal(p.length, 3, p.join('\n'));
    assert.match(p[0], /compose .* down --remove-orphans/);
    assert.match(p[1], /^bloqueio instalar/);
    assert.match(p[2], /compose .* up -d/);
  });

  it('rede já interna: só reinstala o bloqueio, sem parar a pilha', () => {
    preparar({ internal: true });
    const r = transicao();
    assert.equal(r.status, 0, r.saida);
    assert.deepEqual(passos(), ['bloqueio instalar']);
  });

  it('bloqueio que falha na transição: religa a pilha mesmo assim e reprova o passo', () => {
    preparar({ internal: false, bloqueioFalha: true });
    const r = transicao();
    assert.equal(r.status, 1, r.saida);
    assert.match(passos().at(-1), /compose .* up -d/);
  });

  it('transição interrompida (rede já recriada, pilha parada): religa', () => {
    preparar({ internal: undefined, postgresNoAr: false });
    const r = transicao();
    assert.equal(r.status, 0, r.saida);
    assert.match(passos().at(-1), /compose .* up -d/);
  });

  it('VM nova sem versão no .env: não tenta subir nada', () => {
    preparar({ internal: undefined, imagem: false, postgresNoAr: false });
    const r = transicao();
    assert.equal(r.status, 0, r.saida);
    assert.deepEqual(passos(), ['bloqueio instalar']);
  });
});

describe('metadados-verificar.sh', () => {
  const pilha = join(raiz, 'pilha');
  const preparar = ({ n8nAlcanca = false, appAlcanca = true, proxyAlcanca = false, sondaQuebrada = false }) => {
    mkdirSync(pilha, { recursive: true });
    writeFileSync(join(pilha, 'bloquear.sh'), 'exit 0\n');
    escreverExecutavel(
      'docker',
      `#!/bin/sh
echo "docker $*" >> "${registro}"
alvo="$2"
case "$*" in
  *"node -e"*lookup*) exit 0 ;;
esac
case "$alvo" in
  orla-app) ${appAlcanca ? 'exit 10' : 'exit 20'} ;;
  orla-n8n)
    case "$*" in
      *app:3000*) ${sondaQuebrada ? 'exit 127' : 'exit 10'} ;;
      *) ${n8nAlcanca ? 'exit 10' : 'exit 20'} ;;
    esac ;;
  orla-proxy)
    case "$*" in
      *app:3000*) exit 0 ;;
      *) ${proxyAlcanca ? 'exit 0' : 'exit 1'} ;;
    esac ;;
esac
exit 99
`,
    );
  };
  const verificar = () => rodar('infra/compose/metadados-verificar.sh', [], { PILHA: pilha, BLOQUEAR: join(pilha, 'bloquear.sh') });

  it('app alcança, n8n e proxy não: aprova', () => {
    preparar({});
    const r = verificar();
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /só o app alcança/);
  });

  it('n8n alcançando o servidor de metadados reprova', () => {
    preparar({ n8nAlcanca: true });
    const r = verificar();
    assert.equal(r.status, 1, r.saida);
    assert.match(r.saida, /o n8n alcançou http:..169\.254\.169\.254/);
  });

  it('app sem metadados reprova (o cofre depende dele)', () => {
    preparar({ appAlcanca: false });
    assert.equal(verificar().status, 1);
  });

  it('proxy alcançando reprova', () => {
    preparar({ proxyAlcanca: true });
    assert.equal(verificar().status, 1);
  });

  it('sonda que não funciona nem contra o app não conta como bloqueio', () => {
    preparar({ sondaQuebrada: true });
    const r = verificar();
    assert.equal(r.status, 1, r.saida);
    assert.match(r.saida, /inconclusiva/);
  });
});

describe('deploy.yml: transição antes do pre-flight e prova de metadados depois do smoke', () => {
  const deploy = ler('.github/workflows/deploy.yml');
  const posicao = (trecho) => {
    const i = deploy.indexOf(trecho);
    assert.ok(i > 0, `deploy.yml sem: ${trecho}`);
    return i;
  };

  it('envia a pilha, recria redes e bloqueia, roda o pre-flight, sobe e só então prova o bloqueio', () => {
    const ordem = [
      'cp -a infra/compose/. /tmp/pilha/',
      'sudo sh /opt/tria/rede-transicao.sh',
      'sh scripts/preflight-release.sh',
      'Subir a nova versão',
      'scripts/release/smoke-pos-deploy.sh',
      'sudo sh /opt/tria/metadados-verificar.sh',
    ].map(posicao);
    assert.deepEqual([...ordem].sort((a, b) => a - b), ordem);
  });

  it('o boot reinstala o bloqueio antes de subir a pilha', () => {
    const startup = ler('infra/terraform/files/startup.sh.tftpl');
    const bloqueio = startup.indexOf('metadados-bloquear.sh" instalar');
    const subir = startup.indexOf('docker compose -f docker-compose.prod.yml up -d');
    assert.ok(bloqueio > 0 && subir > bloqueio);
  });
});

describe('identidades do pipeline (bootstrap)', () => {
  const bootstrap = ler('infra/terraform/bootstrap/main.tf');
  const recurso = (tipo, nome) => {
    const inicio = bootstrap.indexOf(`resource "${tipo}" "${nome}" {`);
    assert.ok(inicio >= 0, `${tipo}.${nome} ausente`);
    return bootstrap.slice(inicio, bootstrap.indexOf('\n}\n', inicio));
  };

  const concessoesAoPlanner = () => {
    const blocos = [];
    for (const tipo of ['google_project_iam_member', 'google_storage_bucket_iam_member']) {
      let inicio = bootstrap.indexOf(`resource "${tipo}" "`);
      while (inicio >= 0) {
        const bloco = bootstrap.slice(inicio, bootstrap.indexOf('\n}\n', inicio));
        if (bloco.includes('google_service_account.planner.email')) blocos.push(bloco);
        inicio = bootstrap.indexOf(`resource "${tipo}" "`, inicio + 1);
      }
    }
    return blocos;
  };

  it('a conta de plan não tem papel básico, compute.viewer nem leitura de dado', () => {
    assert.ok(!bootstrap.includes('roles/viewer'));
    const blocos = concessoesAoPlanner();
    assert.equal(blocos.length, 2, blocos.join('\n---\n'));
    for (const bloco of blocos) {
      assert.ok(!bloco.includes('roles/compute.viewer'), 'planner com roles/compute.viewer');
      assert.ok(!bloco.includes('for_each'), 'planner com lista de papéis prontos');
    }
    assert.ok(blocos.some((bloco) => bloco.includes('role    = google_project_iam_custom_role.planner_metadados.id')));
    assert.ok(blocos.some((bloco) => bloco.includes('role   = "roles/storage.objectViewer"') && bloco.includes('google_storage_bucket.state.name')));
    const personalizado = recurso('google_project_iam_custom_role', 'planner_metadados');
    assert.doesNotMatch(personalizado, /objects\.|logEntries|versions\.access|getData|getSerialPortOutput|getScreenshot|getGuestAttributes|tables\.|routines\.|\.decrypt|\.encrypt|useReadOnly/);
    for (const permissao of personalizado.matchAll(/"([a-z]+\.[A-Za-z]+\.[A-Za-z]+)"/g)) {
      assert.match(permissao[1], /\.(get|list|getIamPolicy)$/, `${permissao[1]} não é leitura de metadado`);
    }
  });

  it('a conta de plan não escreve lock, o plan roda sem lock e plano e apply têm filas separadas', () => {
    assert.ok(!bootstrap.includes('planner_lock'));
    assert.ok(!bootstrap.includes('.tflock'));
    for (const bloco of concessoesAoPlanner()) assert.ok(!/objectAdmin|objectCreator|objectUser|storage\.admin/.test(bloco));
    const infra = ler('.github/workflows/infra.yml');
    const plano = infra.slice(infra.indexOf('\n  plan:\n'), infra.indexOf('\n  apply:\n'));
    assert.match(plano, /\n {4}environment: plano\n/);
    assert.match(plano, /init -input=false -lock=false /);
    assert.match(plano, /plan -input=false -lock=false /);
    assert.match(plano, /\n {4}concurrency:\n {6}group: infra-plano-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}\n {6}cancel-in-progress: true\n/);
    const aplicar = infra.slice(infra.indexOf('\n  apply:\n'));
    assert.match(aplicar, /\n {4}concurrency:\n {6}group: infra-apply\n {6}cancel-in-progress: false\n/);
    assert.doesNotMatch(infra, /^concurrency:/m, 'concurrency no nível do workflow junta plano e apply no mesmo grupo');
    assert.doesNotMatch(infra, /head_ref|github\.event\.pull_request\.head/);
    assert.match(aplicar, /run: exec terraform -chdir=\$WORKDIR plan -input=false -lock-timeout=120s -out=tfplan\n/);
    assert.match(aplicar, /run: exec terraform -chdir=\$WORKDIR apply -input=false -lock-timeout=120s tfplan\n/);
    assert.doesNotMatch(aplicar, /download-artifact|plano\.tfplan/);
  });

  it('o provedor aceita só o id do repositório e do dono, não o nome', () => {
    const provedor = recurso('google_iam_workload_identity_pool_provider', 'github');
    assert.ok(provedor.includes("attribute_condition = \"assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_repository_owner_id}'\""));
    assert.ok(!provedor.includes('assertion.repository =='));
    assert.ok(!bootstrap.includes('variable "github_repository" '));
  });

  it('o plan só vale para o infra.yml em pull_request no environment plano', () => {
    const provedor = recurso('google_iam_workload_identity_pool_provider', 'github');
    assert.ok(provedor.includes("has(assertion.environment) && assertion.environment == 'plano' && assertion.event_name == 'pull_request' && assertion.ref.startsWith('refs/pull/') && assertion.workflow_ref.startsWith(assertion.repository + '/.github/workflows/infra.yml@refs/pull/') ? 'infra-pull-request' : 'nao'"));
    assert.ok(recurso('google_service_account_iam_member', 'planner_wif').includes('attribute.plano_de_pr/infra-pull-request"'));
    assert.ok(!bootstrap.includes('attribute.repository/'));
  });

  it('produção só vale para o environment protegido no ramo protegido', () => {
    const provedor = recurso('google_iam_workload_identity_pool_provider', 'github');
    assert.ok(provedor.includes("has(assertion.environment) ? assertion.environment + '@' + assertion.ref : 'sem-ambiente'"));
    for (const nome of ['terraform_wif', 'deployer_wif']) {
      assert.ok(recurso('google_service_account_iam_member', nome).includes('attribute.ambiente_no_ramo/${var.protected_environment}@${var.protected_branch_ref}"'));
    }
    assert.ok(!bootstrap.includes('attribute.environment/'));
    assert.match(bootstrap, /variable "protected_branch_ref" \{[\s\S]*?default += "refs.heads.main"/);
  });
});

describe('dataset tria_dw com acesso explícito', () => {
  const bigquery = ler('infra/terraform/bigquery.tf');

  it('sem projectReaders nem projectWriters, VM como WRITER e sem iam_member concorrente', () => {
    assert.doesNotMatch(bigquery, /projectReaders|projectWriters/);
    assert.match(bigquery, /access \{\n\s+role += "WRITER"\n\s+user_by_email = google_service_account\.vm\.email\n\s+\}/);
    assert.match(bigquery, /special_group = "projectOwners"/);
    assert.doesNotMatch(bigquery, /resource "google_bigquery_dataset_(iam_member|iam_binding|iam_policy|access)"/);
  });

  it('o vínculo antigo da VM sai do state sem ser destruído', () => {
    assert.match(bigquery, /removed \{\n\s+from = google_bigquery_dataset_iam_member\.vm_editor\n\n\s+lifecycle \{\n\s+destroy = false\n\s+\}\n\}/);
  });
});

describe('metadados-bloquear.sh: trava e alerta que não abrem', () => {
  const script = 'infra/compose/metadados-bloquear.sh';
  const v4 = () => readFileSync(join(estado, 'v4'), 'utf8');
  const alvoAlerta = join(raiz, 'alerta', 'metadados-bloqueio.log');
  const comFlock = () => escreverExecutavel('flock', '#!/bin/sh\nexit 0\n');
  const travasQueFalham = () => {
    const diretorio = join(raiz, 'trava-diretorio');
    mkdirSync(diretorio, { recursive: true });
    const alvo = join(raiz, 'alvo-da-trava');
    writeFileSync(alvo, 'intacto\n');
    const link = join(raiz, 'trava-symlink');
    symlinkSync(alvo, link);
    return { diretorio, link, alvo };
  };

  it('o shell de teste é registrado', () => {
    console.log(`shell do teste: ${SHELL_DE_TESTE}`);
    assert.ok(['dash', 'sh'].includes(SHELL_DE_TESTE));
  });

  it('aplicar aplica o bloqueio e avisa quando a trava é um diretório ou um symlink', () => {
    comFlock();
    const { diretorio, link, alvo } = travasQueFalham();
    for (const trava of [diretorio, link]) {
      rmSync(estado, { recursive: true, force: true });
      mkdirSync(estado, { recursive: true });
      const r = rodar(script, ['aplicar'], { ARQUIVO_DE_TRAVA: trava });
      assert.equal(r.status, 0, r.saida);
      assert.match(r.saida, /seguindo sem serializar/);
      assert.ok(v4().includes('-A DOCKER-USER -j ORLA-METADADOS'));
    }
    assert.equal(readFileSync(alvo, 'utf8'), 'intacto\n');
  });

  it('vigiar aplica, grava o alerta e sai 0 quando a trava é um diretório ou um symlink', () => {
    comFlock();
    const { diretorio, link, alvo } = travasQueFalham();
    for (const trava of [diretorio, link]) {
      rmSync(estado, { recursive: true, force: true });
      rmSync(join(raiz, 'alerta'), { recursive: true, force: true });
      mkdirSync(estado, { recursive: true });
      const r = rodar(script, ['vigiar'], { ARQUIVO_DE_TRAVA: trava });
      assert.equal(r.status, 0, r.saida);
      assert.match(r.saida, /seguindo sem serializar/);
      assert.ok(v4().includes('-A DOCKER-USER -j ORLA-METADADOS'));
      assert.equal(JSON.parse(readFileSync(alvoAlerta, 'utf8').trim()).resultado, 'reinstalado');
    }
    assert.equal(readFileSync(alvo, 'utf8'), 'intacto\n');
  });

  it('vigiar com a trava inválida e o restore falhando ainda grava o alerta persistente e sai 1', () => {
    comFlock();
    escreverExecutavel('iptables-restore', '#!/bin/sh\ncat > /dev/null\nexit 1\n');
    const { diretorio } = travasQueFalham();
    const r = rodar(script, ['vigiar'], { ARQUIVO_DE_TRAVA: diretorio });
    assert.equal(r.status, 1, r.saida);
    assert.equal(JSON.parse(readFileSync(alvoAlerta, 'utf8').trim()).resultado, 'persistente');
  });

  it('arquivo de alerta que é symlink não é seguido nem truncado', () => {
    const alvo = join(raiz, 'alvo-do-alerta');
    writeFileSync(alvo, 'intacto\n');
    mkdirSync(join(raiz, 'alerta'), { recursive: true });
    symlinkSync(alvo, alvoAlerta);
    const r = rodar(script, ['vigiar'], { LIMITE_DO_ARQUIVO_DE_ALERTA: '1' });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /é symlink ou não é arquivo comum/);
    assert.equal(readFileSync(alvo, 'utf8'), 'intacto\n');
  });

  it('instalar com a pasta das unidades sem escrita aplica o bloqueio, sai diferente de zero e diz que a vigia falhou', (contexto) => {
    if (process.getuid && process.getuid() === 0) return contexto.skip('root ignora permissão de pasta');
    const unidades = join(raiz, 'unidades');
    mkdirSync(unidades, { recursive: true });
    chmodSync(unidades, 0o555);
    const r = rodar(script, ['instalar'], { INSTALADO: join(raiz, 'sbin', 'orla-metadados-bloquear'), PASTA_DO_DOCKER: join(raiz, 'docker.service.d'), PASTA_DAS_UNIDADES: unidades });
    chmodSync(unidades, 0o755);
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /FALHA: a vigia orla-metadados-vigiar não foi instalada ou ligada/);
    assert.doesNotMatch(chamadas(), /enable --now/);
    assert.ok(v4().includes('-A DOCKER-USER -j ORLA-METADADOS'));
  });

  it('instalar com a pasta das unidades impossível de criar aplica o bloqueio e sai diferente de zero', () => {
    const arquivo = join(raiz, 'nao-e-pasta');
    writeFileSync(arquivo, '');
    const r = rodar(script, ['instalar'], { INSTALADO: join(raiz, 'sbin', 'orla-metadados-bloquear'), PASTA_DO_DOCKER: join(raiz, 'docker.service.d'), PASTA_DAS_UNIDADES: join(arquivo, 'sub') });
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /FALHA: a vigia/);
    assert.ok(v4().includes('-A DOCKER-USER -j ORLA-METADADOS'));
  });

  it('instalar com o daemon-reload da vigia falhando sai diferente de zero mesmo com o enable dando certo', () => {
    escreverExecutavel('systemctl', '#!/bin/sh\ncase "$*" in *daemon-reload*) exit 1 ;; esac\nexit 0\n');
    const r = rodar(script, ['instalar'], { INSTALADO: join(raiz, 'sbin', 'orla-metadados-bloquear'), PASTA_DO_DOCKER: join(raiz, 'docker.service.d'), PASTA_DAS_UNIDADES: join(raiz, 'unidades') });
    assert.notEqual(r.status, 0, r.saida);
  });
});
