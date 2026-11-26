import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const RAIZ = join(import.meta.dirname, '..', '..', '..');
const PASTA_PERMITIDA = 'src/modules/ia/infrastructure/';
const BIBLIOTECA_DE_FORNECEDOR = /from\s+['"](ai|ai\/[^'"]+|@ai-sdk\/[^'"]+|@modelcontextprotocol\/[^'"]+|openai|@anthropic-ai\/[^'"]+|@google\/[^'"]+)['"]/;

function arquivos(pasta: string): string[] {
  return readdirSync(join(RAIZ, pasta), { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) return entrada.name === 'node_modules' ? [] : arquivos(caminho);
    return /\.(ts|tsx|mjs)$/.test(entrada.name) ? [caminho] : [];
  });
}

describe('fronteira de fornecedor de IA (ADR 0063 §1)', () => {
  it('só a infraestrutura do módulo de IA importa biblioteca de modelo ou de MCP', () => {
    const fora = [...arquivos('src'), ...arquivos('app'), 'proxy.ts']
      .filter((caminho) => !caminho.startsWith(PASTA_PERMITIDA))
      .filter((caminho) => BIBLIOTECA_DE_FORNECEDOR.test(readFileSync(join(RAIZ, caminho), 'utf8')));
    assert.deepEqual(fora, []);
  });

  it('nenhum id de modelo fica fixo no código de produção', () => {
    const ID_DE_MODELO = /['"`](gemini-[0-9]|claude-(opus|sonnet|haiku|[0-9])|gpt-[0-9]|grok-[0-9]|kimi-|moonshot-v)/i;
    const comId = [...arquivos('src'), ...arquivos('app')]
      .filter((caminho) => !/\.test\.ts$/.test(caminho))
      .filter((caminho) => ID_DE_MODELO.test(readFileSync(join(RAIZ, caminho), 'utf8')));
    assert.deepEqual(comId, []);
  });
});
