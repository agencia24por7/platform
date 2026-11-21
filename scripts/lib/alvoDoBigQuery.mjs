import { parseArgs } from 'node:util';

export const PRODUCAO = Object.freeze({ projeto: 'tria-platform', dataset: 'tria_dw' });

const PROJETO_VALIDO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATASET_VALIDO = /^[A-Za-z_][A-Za-z0-9_]{0,1023}$/;

export const OPCOES_DE_ALVO = Object.freeze({
  projeto: { type: 'string' },
  dataset: { type: 'string' },
  prod: { type: 'boolean', default: false },
  ajuda: { type: 'boolean', short: 'h', default: false },
  help: { type: 'boolean', default: false },
});

export function lerArgumentos(argv, opcoes, uso) {
  let lidos;
  try {
    lidos = parseArgs({ args: argv, options: { ...OPCOES_DE_ALVO, ...opcoes }, strict: true, allowPositionals: false });
  } catch (erro) {
    console.error(`${erro.message}\n\n${uso}`);
    process.exit(2);
  }
  if (lidos.values.ajuda || lidos.values.help) {
    console.log(uso);
    process.exit(0);
  }
  return lidos.values;
}

export function resolverAlvo(valores, uso) {
  const explicito = valores.projeto !== undefined || valores.dataset !== undefined;
  if (valores.prod && explicito) sair(`use --prod ou --projeto/--dataset, não os dois.\n\n${uso}`);
  if (!valores.prod && (!valores.projeto || !valores.dataset)) {
    sair(`alvo obrigatório: --projeto e --dataset, ou --prod. Não há alvo padrão.\n\n${uso}`);
  }

  const alvo = valores.prod ? { ...PRODUCAO } : { projeto: valores.projeto, dataset: valores.dataset };
  if (!PROJETO_VALIDO.test(alvo.projeto)) sair(`--projeto inválido: ${alvo.projeto}`);
  if (!DATASET_VALIDO.test(alvo.dataset)) sair(`--dataset inválido: ${alvo.dataset}`);

  return { ...alvo, ehProducao: alvo.projeto === PRODUCAO.projeto && alvo.dataset === PRODUCAO.dataset };
}

function sair(mensagem) {
  console.error(mensagem);
  process.exit(2);
}
