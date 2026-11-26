import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const PASTA = 'infra/compose';
const SEGREDO = '{$TRIA_PROXY_SECRET}';
const CABECALHO_CANONICO = `header_up X-Orla-Borda "${SEGREDO}"`;
const PADRAO_SEGREDO = /tria_proxy_secret|orla-borda/i;
const PADRAO_TOKEN = /"[^"]*"|`[^`]*`|\S+/g;
const DIRETIVAS_DE_DESTINO = new Set(['reverse_proxy', 'forward_auth']);
const UPSTREAM_DO_APP = 'app:3000';
const SUBDIRETIVAS_ACEITAS_NO_BLOCO_DO_APP = new Set(['header_up', 'header_down', 'transport', 'flush_interval', 'uri']);
const PREFIXOS_DE_MATCHER = ['@', '/', '*'];

const arquivosCaddy = () => readdirSync(PASTA).filter((nome) => nome === 'Caddyfile' || nome.endsWith('.caddy'));

function removerComentario(linha) {
  let aspas = null;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (aspas) {
      if (c === aspas) aspas = null;
    } else if (c === '"' || c === '`') {
      aspas = c;
    } else if (c === '#' && (i === 0 || /\s/.test(linha[i - 1]))) {
      return linha.slice(0, i);
    }
  }
  return linha;
}

function semChavesDeTexto(linha) {
  return linha
    .replace(/"[^"]*"|`[^`]*`/g, '""')
    .replace(/\{[^\s{}]*\}/g, 'x');
}

export function lerArvore(texto) {
  const raiz = { tokens: [], texto: '', filhos: [], bloco: true, linha: 0 };
  const pilha = [raiz];
  texto.split('\n').forEach((bruta, indice) => {
    const linha = removerComentario(bruta).trim();
    if (!linha) return;
    const numero = indice + 1;
    const estrutura = semChavesDeTexto(linha);
    if (estrutura === '}') {
      if (pilha.length === 1) throw new Error(`linha ${numero}: } sem abertura`);
      pilha.pop();
      return;
    }
    const abre = estrutura.endsWith('{');
    if (/[{}]/.test(abre ? estrutura.slice(0, -1) : estrutura)) {
      throw new Error(`linha ${numero}: uso de chaves que o teste não sabe interpretar`);
    }
    const corpo = abre ? linha.slice(0, -1).trim() : linha;
    const no = { tokens: corpo.match(PADRAO_TOKEN) ?? [], texto: linha, filhos: [], bloco: abre, linha: numero };
    pilha[pilha.length - 1].filhos.push(no);
    if (abre) pilha.push(no);
  });
  if (pilha.length !== 1) throw new Error('bloco sem fechamento');
  return raiz;
}

const descendentes = (no) => no.filhos.flatMap((filho) => [filho, ...descendentes(filho)]);
const diretiva = (no) => (no.tokens[0] ?? '').toLowerCase();
const semAspas = (token) => token.replace(/^["`]|["`]$/g, '');
const ehUpstreamDoApp = (destino) => /^([a-z][a-z0-9+.-]*:\/\/)?app(:\d+)?([/?]|$)/i.test(destino);
const ehMatcher = (token) => PREFIXOS_DE_MATCHER.some((prefixo) => token.startsWith(prefixo));

function cabecalhoValido(tokens) {
  return (
    tokens.length === 3 &&
    tokens[0].toLowerCase() === 'header_up' &&
    semAspas(tokens[1]).toLowerCase() === 'x-orla-borda' &&
    (tokens[2] === SEGREDO || tokens[2] === `"${SEGREDO}"`)
  );
}

export function analisarCaddy(texto) {
  const violacoes = [];
  let raiz;
  try {
    raiz = lerArvore(texto);
  } catch (erro) {
    return { violacoes: [`sintaxe: ${erro.message}`], paraApp: 0, paraOutros: 0 };
  }
  const permitidos = new Set();
  let paraApp = 0;
  let paraOutros = 0;

  for (const unidade of descendentes(raiz).filter((no) => DIRETIVAS_DE_DESTINO.has(diretiva(no)))) {
    const nome = diretiva(unidade);
    const onde = `${nome} na linha ${unidade.linha}`;
    const internos = descendentes(unidade);
    if (internos.some((no) => diretiva(no) === 'import')) {
      violacoes.push(`${onde}: import dentro do bloco (o teste não expande snippet)`);
    }
    const destinos = [
      ...unidade.tokens.slice(1),
      ...internos.filter((no) => diretiva(no) === 'to').flatMap((no) => no.tokens.slice(1)),
    ];
    if (destinos.length === 0 || destinos.some(ehMatcher)) {
      violacoes.push(`${onde}: destino que o teste não consegue classificar (${destinos.join(' ') || 'nenhum'})`);
      continue;
    }
    if (!destinos.some(ehUpstreamDoApp)) {
      paraOutros += 1;
      continue;
    }
    if (destinos.length !== 1 || destinos[0] !== UPSTREAM_DO_APP) {
      violacoes.push(`${onde}: o app só pode ser o único destino e escrito ${UPSTREAM_DO_APP} (achei: ${destinos.join(' ')})`);
      continue;
    }
    paraApp += 1;
    for (const filho of unidade.filhos.filter((no) => !SUBDIRETIVAS_ACEITAS_NO_BLOCO_DO_APP.has(diretiva(no)))) {
      violacoes.push(`${onde}: subdiretiva ${diretiva(filho)} (linha ${filho.linha}) fora da lista aceita no bloco do app, pode mudar o destino`);
    }
    const validos = unidade.filhos.filter((no) => cabecalhoValido(no.tokens));
    validos.forEach((no) => permitidos.add(no));
    if (nome === 'reverse_proxy' && validos.length === 0) {
      violacoes.push(`${onde}: falta ${CABECALHO_CANONICO} direto no bloco`);
    }
  }

  for (const no of descendentes(raiz)) {
    if (PADRAO_SEGREDO.test(no.texto) && !permitidos.has(no)) {
      violacoes.push(`linha ${no.linha}: segredo de borda fora de um bloco cujo único destino é ${UPSTREAM_DO_APP}: ${no.texto.replace(/\s+/g, ' ')}`);
    }
  }
  return { violacoes, paraApp, paraOutros };
}

const site = (...linhas) => `exemplo.test {\n${linhas.join('\n')}\n}\n`;
const proxy = (destinos, ...corpo) => `\treverse_proxy ${destinos} {\n${corpo.map((l) => `\t\t${l}`).join('\n')}\n\t}`;
const PROTO = 'header_up X-Forwarded-Proto https';

const APROVADAS = [
  ['app com o cabeçalho canônico', site(proxy('app:3000', PROTO, CABECALHO_CANONICO))],
  ['app com o cabeçalho sem aspas, nome em minúsculas e TAB depois da diretiva', site(`\treverse_proxy\tapp:3000 {\n\t\theader_up x-orla-borda ${SEGREDO}\n\t}`)],
  ['app com o cabeçalho depois de um subbloco transport', site(proxy('app:3000', 'transport http {', 'dial_timeout 2s', '}', CABECALHO_CANONICO))],
  ['n8n sem o cabeçalho', site(proxy('n8n:5678', PROTO))],
  ['n8n sem bloco', site('\treverse_proxy n8n:5678')],
  ['forward_auth do app sem o cabeçalho', site('\tforward_auth app:3000 {\n\t\turi /api/portaria\n\t}')],
  ['comentário que cita o cabeçalho', `# X-Orla-Borda ${SEGREDO}\n${site(proxy('app:3000', CABECALHO_CANONICO))}`],
  ['placeholders com chaves não abrem bloco', site('\t@x path /a/{http.request.uri.path}', proxy('n8n:5678', 'header_up X-Original-URI {uri}'))],
];

const REPROVADAS = [
  ['n8n com header_up sem aspas', site(proxy('n8n:5678', `header_up X-Orla-Borda ${SEGREDO}`))],
  ['n8n com header_up em minúsculas', site(proxy('n8n:5678', `HEADER_UP x-orla-borda "${SEGREDO}"`))],
  ['n8n com a forma {env.TRIA_PROXY_SECRET}', site(proxy('n8n:5678', 'header_up X-Orla-Borda "{env.TRIA_PROXY_SECRET}"'))],
  ['n8n com o cabeçalho depois de subbloco transport', site(proxy('n8n:5678', 'transport http {', 'dial_timeout 2s', '}', CABECALHO_CANONICO))],
  ['n8n com import de snippet no bloco', site(proxy('n8n:5678', 'import borda'))],
  ['bloco do app com import de snippet', site(proxy('app:3000', CABECALHO_CANONICO, 'import borda'))],
  ['app e n8n como upstreams do mesmo bloco', site(proxy('app:3000 n8n:5678', CABECALHO_CANONICO))],
  ['n8n e app como upstreams do mesmo bloco, sem cabeçalho', site(proxy('n8n:5678 app:3000', PROTO))],
  ['to n8n:5678 dentro do bloco do app', site(proxy('app:3000', CABECALHO_CANONICO, 'to n8n:5678'))],
  ['to app:3000 dentro do bloco do n8n', site(proxy('n8n:5678', 'to app:3000', CABECALHO_CANONICO))],
  ['request_header no nível do site', site(`\trequest_header X-Orla-Borda "${SEGREDO}"`, proxy('n8n:5678', PROTO))],
  ['request_header no nível do site junto do app', site(`\trequest_header X-Orla-Borda "${SEGREDO}"`, proxy('app:3000', CABECALHO_CANONICO))],
  ['forward_auth n8n:5678 com o cabeçalho', site(`\tforward_auth n8n:5678 {\n\t\t${CABECALHO_CANONICO}\n\t}`)],
  ['reverse_proxy n8n seguido de TAB com o cabeçalho', site(`\treverse_proxy\tn8n:5678 {\n\t\t${CABECALHO_CANONICO}\n\t}`)],
  ['snippet que menciona o segredo', `(borda) {\n\theader_up X-Orla-Borda "${SEGREDO}"\n}\n${site(proxy('n8n:5678', PROTO))}`],
  ['app com http://app:3000', site(proxy('http://app:3000', CABECALHO_CANONICO))],
  ['app com matcher antes do upstream', site(proxy('@api app:3000', CABECALHO_CANONICO))],
  ['app sem bloco', site('\treverse_proxy app:3000')],
  ['app sem o cabeçalho', site(proxy('app:3000', PROTO))],
  ['app com o cabeçalho dentro de subbloco', site(proxy('app:3000', 'transport http {', CABECALHO_CANONICO, '}'))],
  ['app com a forma {env.TRIA_PROXY_SECRET}', site(proxy('app:3000', 'header_up X-Orla-Borda "{env.TRIA_PROXY_SECRET}"'))],
  ['app com valor fixo no lugar do segredo', site(proxy('app:3000', 'header_up X-Orla-Borda "valor-fixo"'))],
  ['app com prefixo ? que deixa o cliente sobrescrever', site(proxy('app:3000', `header_up ?X-Orla-Borda "${SEGREDO}"`))],
  ['app com remoção do cabeçalho depois do envio', site(proxy('app:3000', CABECALHO_CANONICO, 'header_up -X-Orla-Borda'))],
  ['app com subbloco dynamic que muda o destino', site(proxy('app:3000', CABECALHO_CANONICO, 'dynamic a {', 'name n8n', 'port 5678', '}'))],
  ['app com lb_policy no bloco', site(proxy('app:3000', CABECALHO_CANONICO, 'lb_policy first'))],
  ['chaves desbalanceadas', 'exemplo.test {\n\treverse_proxy n8n:5678 {\n\t}\n'],
  ['fechamento sem abertura', 'exemplo.test {\n}\n}\n'],
];

test('o parser aprova as formas corretas', () => {
  for (const [nome, texto] of APROVADAS) {
    const { violacoes } = analisarCaddy(texto);
    assert.deepEqual(violacoes, [], `deveria aprovar: ${nome}`);
  }
});

test('o parser reprova cada forma que mandaria o segredo ao n8n ou deixaria o app sem prova', () => {
  for (const [nome, texto] of REPROVADAS) {
    const { violacoes } = analisarCaddy(texto);
    assert.ok(violacoes.length > 0, `deveria reprovar: ${nome}`);
  }
});

test('os arquivos reais: todo destino do app envia a prova de borda e o segredo não aparece em nenhum outro lugar', () => {
  const arquivos = arquivosCaddy();
  assert.ok(arquivos.includes('Caddyfile'), 'Caddyfile não encontrado em infra/compose');
  assert.ok(arquivos.includes('n8n.caddy'));
  let paraApp = 0;
  let paraOutros = 0;
  for (const arquivo of arquivos) {
    const resultado = analisarCaddy(readFileSync(join(PASTA, arquivo), 'utf8'));
    assert.deepEqual(resultado.violacoes, [], `${arquivo}: ${resultado.violacoes.join(' | ')}`);
    paraApp += resultado.paraApp;
    paraOutros += resultado.paraOutros;
  }
  assert.ok(paraApp >= 2, 'esperava ao menos dois destinos para o app (Caddyfile e portaria do n8n)');
  assert.ok(paraOutros >= 2, 'esperava ao menos dois destinos para o n8n');
});

test('o proxy recebe TRIA_PROXY_SECRET no ambiente e o n8n não', () => {
  const compose = readFileSync(join(PASTA, 'docker-compose.prod.yml'), 'utf8');
  const servico = (nome) => new RegExp(`^  ${nome}:\\n([\\s\\S]*?)(?=^  \\S|^\\S)`, 'm').exec(compose)?.[1] ?? '';
  assert.match(servico('proxy'), /TRIA_PROXY_SECRET:/);
  assert.doesNotMatch(servico('n8n'), /TRIA_PROXY_SECRET/);
});
