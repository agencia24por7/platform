export async function resolve(especificador, contexto, proximo) {
  if (especificador === 'next/headers') return proximo('next/headers.js', contexto);
  return proximo(especificador, contexto);
}
