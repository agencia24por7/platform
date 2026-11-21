import { readFileSync } from 'node:fs';
import { lerArquivoDeAmbiente, validarAmbienteDeProducao } from './validarAmbiente.ts';

const USO = `uso: node --experimental-strip-types validarAmbienteCli.ts [--arquivo <.env>]

Valida o ambiente do app como em produção (schema de src/shared/config/env.ts + política da release)
sem imprimir nenhum valor. Sem --arquivo, valida o ambiente do próprio processo (o contêiner do app).
Sai com 0 quando não há erro e com 1 quando há.`;

function fonteDoAmbiente(argumentos: readonly string[]): Record<string, string | undefined> {
  const posicao = argumentos.indexOf('--arquivo');
  if (posicao === -1) return process.env;
  const caminho = argumentos[posicao + 1];
  if (!caminho) {
    console.error(USO);
    process.exit(2);
  }
  return lerArquivoDeAmbiente(readFileSync(caminho, 'utf8'));
}

const argumentos = process.argv.slice(2);
if (argumentos.some((argumento) => ['-h', '--help', '--ajuda'].includes(argumento))) {
  console.log(USO);
  process.exit(0);
}

const { erros, avisos } = validarAmbienteDeProducao(fonteDoAmbiente(argumentos));
for (const aviso of avisos) console.log(`aviso: ${aviso}`);
if (erros.length === 0) {
  console.log('ambiente de produção válido (nenhum valor impresso)');
  process.exit(0);
}
console.error(`ambiente de produção inválido: ${erros.length} problema(s)`);
for (const erro of erros) console.error(`  ${erro}`);
process.exit(1);
