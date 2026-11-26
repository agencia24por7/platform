import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const PASTA = 'infra/compose';
const CABECALHO = 'header_up X-Orla-Borda "{$TRIA_PROXY_SECRET}"';

const arquivosCaddy = () => readdirSync(PASTA).filter((nome) => nome === 'Caddyfile' || nome.endsWith('.caddy'));

function blocosDeReverseProxy(texto) {
  const blocos = [];
  const linhas = texto.split('\n');
  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i].trim();
    if (!linha.startsWith('reverse_proxy ')) continue;
    const alvo = linha.split(/\s+/)[1];
    const corpo = [];
    if (linha.endsWith('{')) {
      for (let j = i + 1; j < linhas.length && linhas[j].trim() !== '}'; j += 1) corpo.push(linhas[j].trim());
    }
    blocos.push({ alvo, corpo });
  }
  return blocos;
}

test('todo reverse_proxy para o app envia a prova de borda e nenhum para o n8n a envia', () => {
  const arquivos = arquivosCaddy();
  assert.ok(arquivos.includes('Caddyfile') && arquivos.includes('n8n.caddy'));
  let paraApp = 0;
  let paraN8n = 0;
  for (const arquivo of arquivos) {
    for (const { alvo, corpo } of blocosDeReverseProxy(readFileSync(join(PASTA, arquivo), 'utf8'))) {
      const envia = corpo.includes(CABECALHO);
      if (alvo.startsWith('app:3000')) {
        paraApp += 1;
        assert.ok(envia, `${arquivo}: reverse_proxy ${alvo} sem ${CABECALHO}`);
      } else if (alvo.startsWith('n8n')) {
        paraN8n += 1;
        assert.equal(envia, false, `${arquivo}: reverse_proxy ${alvo} enviaria o segredo ao n8n`);
      } else {
        assert.fail(`${arquivo}: reverse_proxy para destino não classificado: ${alvo}`);
      }
    }
  }
  assert.ok(paraApp >= 2, 'esperava ao menos dois reverse_proxy para o app (Caddyfile e portaria do n8n)');
  assert.ok(paraN8n >= 2, 'esperava ao menos dois reverse_proxy para o n8n');
});

test('o proxy recebe TRIA_PROXY_SECRET no ambiente e o n8n não', () => {
  const compose = readFileSync(join(PASTA, 'docker-compose.prod.yml'), 'utf8');
  const servico = (nome) => new RegExp(`^  ${nome}:\\n([\\s\\S]*?)(?=^  \\S|^\\S)`, 'm').exec(compose)?.[1] ?? '';
  assert.match(servico('proxy'), /TRIA_PROXY_SECRET:/);
  assert.doesNotMatch(servico('n8n'), /TRIA_PROXY_SECRET/);
});
