const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/;
const CONTROLE = /[\u0000-\u001f\u007f]/;

export function validarEntrada(entrada) {
  const { tabela, chave, plataforma, colunaPlataforma, data, momento, todoPeriodo } = entrada;
  const recorte = [data !== undefined, momento !== undefined, todoPeriodo === true].filter(Boolean).length;
  return [tabela, chave, plataforma].every((valor) => IDENTIFICADOR.test(valor ?? ''))
    && [colunaPlataforma, data, momento].every((valor) => valor === undefined || IDENTIFICADOR.test(valor))
    && (todoPeriodo === undefined || todoPeriodo === true)
    && recorte === 1;
}

export function literalBigQuery(valor) {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > 512 || CONTROLE.test(valor)) {
    throw new Error(`valor inválido para literal do BigQuery: ${JSON.stringify(valor)}`);
  }
  return `'${valor.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const qualificada = (destino, tabela) => `\`${destino.projeto}.${destino.dataset}.${tabela}\``;

function partes(fato, destino) {
  const plataforma = `'${fato.plataforma}'`;
  return {
    alvo: qualificada(destino, fato.tabela),
    dim: qualificada(destino, 'dim_fonte_scd2'),
    mesmaFonte: (alias) =>
      `${alias}.organization_id = f.organization_id AND ${alias}.platform = ${plataforma} AND ${alias}.external_id = f.${fato.chave}`,
    filtroPlataforma: fato.colunaPlataforma ? ` AND f.${fato.colunaPlataforma} = ${plataforma}` : '',
  };
}

export function sqlExpurgoPorPosse(fato, destino) {
  const { alvo, dim, mesmaFonte, filtroPlataforma } = partes(fato, destino);
  if (fato.todoPeriodo) {
    return `DELETE FROM ${alvo} f WHERE EXISTS (
         SELECT 1 FROM ${dim} d WHERE d.client_id = @id AND ${mesmaFonte('d')})
       AND NOT EXISTS (
         SELECT 1 FROM ${dim} o WHERE o.client_id IS NOT NULL AND o.client_id != @id AND ${mesmaFonte('o')})${filtroPlataforma}`;
  }
  const momento = fato.momento ? `f.${fato.momento}` : `TIMESTAMP(f.${fato.data}, 'America/Sao_Paulo')`;
  return `DELETE FROM ${alvo} f WHERE EXISTS (
         SELECT 1 FROM ${dim} d
         WHERE d.client_id = @id AND ${mesmaFonte('d')}
           AND ${momento} >= d.valido_de AND ${momento} < d.valido_ate)${filtroPlataforma}`;
}

export function sqlExpurgoDasSobras(fato, destino, fontes) {
  const daPlataforma = fontes.filter((fonte) => fonte.platform === fato.plataforma);
  if (daPlataforma.length === 0) return null;
  const { alvo, dim, mesmaFonte, filtroPlataforma } = partes(fato, destino);
  const chaves = [...new Set(daPlataforma.map((fonte) => `${fonte.organizationId}|${fonte.externalId}`))].sort();
  return `DELETE FROM ${alvo} f
       WHERE CONCAT(f.organization_id, '|', CAST(f.${fato.chave} AS STRING)) IN UNNEST([${chaves.map(literalBigQuery).join(', ')}])
       AND NOT EXISTS (
         SELECT 1 FROM ${dim} o WHERE o.client_id IS NOT NULL AND o.client_id != @id AND ${mesmaFonte('o')})${filtroPlataforma}`;
}

export function sqlVersoesDoCliente(destino) {
  return `SELECT COUNT(*) AS versoes FROM ${qualificada(destino, 'dim_fonte_scd2')} WHERE client_id = @id`;
}

export function sqlExpurgoPorClientId(tabela, destino) {
  if (!IDENTIFICADOR.test(tabela)) throw new Error(`tabela inválida: ${tabela}`);
  return `DELETE FROM ${qualificada(destino, tabela)} WHERE CAST(client_id AS STRING) = @id`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validarFontes(fontes) {
  return fontes.map((fonte) => {
    if (!UUID.test(fonte.organizationId ?? '') || !IDENTIFICADOR.test(fonte.platform ?? '')) {
      throw new Error(`fonte inválida: ${JSON.stringify(fonte)}`);
    }
    literalBigQuery(`${fonte.organizationId}|${fonte.externalId}`);
    return fonte;
  });
}

export function passosPorClientId(tabelasComCliente, destino) {
  const ordenadas = [...tabelasComCliente].sort((a, b) => Number(a === 'dim_fonte_scd2') - Number(b === 'dim_fonte_scd2'));
  return ordenadas.map((tabela) => ({ nome: `${tabela} (client_id)`, sql: sqlExpurgoPorClientId(tabela, destino) }));
}

export function planoDoExpurgo({ manifesto, tabelasComCliente, fontes, destino }) {
  const porPosse = manifesto.map((fato) => ({
    nome: `${fato.tabela}[${fato.plataforma}] (período de posse)`,
    sql: sqlExpurgoPorPosse(fato, destino),
  }));
  const sobras = manifesto.flatMap((fato) => {
    const sql = sqlExpurgoDasSobras(fato, destino, fontes);
    return sql ? [{ nome: `${fato.tabela}[${fato.plataforma}] (fontes só do cliente)`, sql }] : [];
  });
  return [...porPosse, ...sobras, ...passosPorClientId(tabelasComCliente, destino)];
}

export function executarPassos(passos, executar) {
  for (let indice = 0; indice < passos.length; indice += 1) {
    try {
      executar(passos[indice]);
    } catch (erro) {
      return { ok: false, falhou: passos[indice].nome, pendentes: passos.slice(indice).map((passo) => passo.nome), erro };
    }
  }
  return { ok: true, falhou: null, pendentes: [], erro: null };
}
