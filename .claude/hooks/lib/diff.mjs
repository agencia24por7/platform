const ARQUIVO_DESCONHECIDO = '(arquivo desconhecido)'

export function linhasAdicionadas(textoDoDiff) {
  const resultado = []
  let arquivo = ARQUIVO_DESCONHECIDO
  let linhaNova = 0
  let dentroDoTrecho = false
  for (const linha of String(textoDoDiff ?? '').split('\n')) {
    if (linha.startsWith('diff --git ')) {
      dentroDoTrecho = false
      const cabecalho = linha.match(/^diff --git "?a[/].*? "?b[/](.*?)"?$/)
      arquivo = cabecalho ? cabecalho[1] : ARQUIVO_DESCONHECIDO
      continue
    }
    if (!dentroDoTrecho) {
      const novo = linha.match(/^\+\+\+ "?b[/](.*?)"?$/)
      if (novo) arquivo = novo[1]
    }
    const trecho = linha.match(/^@@ -\S+ \+(\d+)/)
    if (trecho) {
      dentroDoTrecho = true
      linhaNova = Number(trecho[1]) - 1
      continue
    }
    if (!dentroDoTrecho || !linha.startsWith('+')) continue
    linhaNova += 1
    resultado.push({ arquivo, linha: linhaNova, texto: linha.slice(1) })
  }
  return resultado
}

export function alteracoesDoNameStatus(textoComNul) {
  const pedacos = String(textoComNul ?? '').split('\0').filter((pedaco) => pedaco !== '')
  const alteracoes = []
  for (let indice = 0; indice + 1 < pedacos.length; indice += 2) {
    alteracoes.push({ status: pedacos[indice][0], arquivo: pedacos[indice + 1] })
  }
  return alteracoes
}
