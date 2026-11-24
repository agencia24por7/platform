const STUBS = {
  'next/headers':
    'export async function cookies() { const valor = process.env.TESTE_SESSAO_DO_CENARIO; if (!valor) throw new Error("fora de requisicao"); return { get: (nome) => (nome === "tria_sessao" ? { value: valor } : undefined) }; }',
  react: 'export function cache(fn) { return fn; }',
};

export async function resolve(especificador, contexto, proximo) {
  const fonte = STUBS[especificador];
  if (fonte) return { url: `data:text/javascript,${encodeURIComponent(fonte)}`, shortCircuit: true };
  return proximo(especificador, contexto);
}
