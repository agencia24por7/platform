const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/;
const STAGING = /^stg_[a-z0-9_]+$/;
const CONTROLE = /[\u0000-\u001f\u007f]/;

export const STATUS_DE_DONO_DESCONHECIDO = 'desconhecido';
export const PLATAFORMAS_COM_NOME_RESTRITO = ['youtube'];
export const DIAS_DE_RETENCAO_DO_YOUTUBE = 30;

export function validarEntrada(entrada) {
  const { tabela, chave, plataforma, colunaPlataforma, data, momento, todoPeriodo, staging } = entrada;
  const recorte = [data !== undefined, momento !== undefined, todoPeriodo === true].filter(Boolean).length;
  return [tabela, chave, plataforma].every((valor) => IDENTIFICADOR.test(valor ?? ''))
    && [colunaPlataforma, data, momento].every((valor) => valor === undefined || IDENTIFICADOR.test(valor))
    && (staging === undefined || STAGING.test(staging))
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

const outroDonoOuDesconhecido = (alias) =>
  `((${alias}.client_id IS NOT NULL AND ${alias}.client_id != @id) OR ${alias}.status = '${STATUS_DE_DONO_DESCONHECIDO}')`;

export function sqlExpurgoPorPosse(fato, destino) {
  const { alvo, dim, mesmaFonte, filtroPlataforma } = partes(fato, destino);
  if (fato.todoPeriodo) {
    return `DELETE FROM ${alvo} f WHERE EXISTS (
         SELECT 1 FROM ${dim} d WHERE d.client_id = @id AND ${mesmaFonte('d')})
       AND NOT EXISTS (
         SELECT 1 FROM ${dim} o WHERE ${outroDonoOuDesconhecido('o')} AND ${mesmaFonte('o')})${filtroPlataforma}`;
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
         SELECT 1 FROM ${dim} o WHERE ${outroDonoOuDesconhecido('o')} AND ${mesmaFonte('o')})${filtroPlataforma}`;
}

function chavesDasFontes(fato, fontes) {
  return [...new Set(fontes.filter((fonte) => fonte.platform === fato.plataforma).map((fonte) => `${fonte.organizationId}|${fonte.externalId}`))].sort();
}

export function sqlExpurgoDaStaging(fato, destino, fontes) {
  if (!fato.staging) return null;
  const chaves = chavesDasFontes(fato, fontes);
  if (chaves.length === 0) return null;
  const filtroPlataforma = fato.colunaPlataforma ? ` AND s.${fato.colunaPlataforma} = '${fato.plataforma}'` : '';
  return `DELETE FROM ${qualificada(destino, fato.staging)} s
       WHERE CONCAT(s.organization_id, '|', CAST(s.${fato.chave} AS STRING)) IN UNNEST([${chaves.map(literalBigQuery).join(', ')}])${filtroPlataforma}`;
}

export function passosDaStaging(manifesto, destino, fontes) {
  const vistos = new Set();
  return manifesto.flatMap((fato) => {
    const sql = sqlExpurgoDaStaging(fato, destino, fontes);
    if (!sql || vistos.has(sql)) return [];
    vistos.add(sql);
    return [{ nome: `${fato.staging}[${fato.plataforma}] (staging)`, sql }];
  });
}

function filtroDaFonte(alias, coluna, fonte) {
  return `${alias}.organization_id = ${literalBigQuery(fonte.organizationId)} AND CAST(${alias}.${coluna} AS STRING) = ${literalBigQuery(fonte.externalId)}`;
}

export function planoDoExpurgoDaFonte({ manifesto, fonte, destino }) {
  const [valida] = validarFontes([fonte]);
  const daPlataforma = manifesto.filter((fato) => fato.plataforma === valida.platform);
  const tabelas = daPlataforma.map((fato) => ({
    nome: `${fato.tabela}[${fato.plataforma}] (fonte)`,
    sql: `DELETE FROM ${qualificada(destino, fato.tabela)} f WHERE ${filtroDaFonte('f', fato.chave, valida)}${
      fato.colunaPlataforma ? ` AND f.${fato.colunaPlataforma} = '${fato.plataforma}'` : ''}`,
  }));
  const nome = PLATAFORMAS_COM_NOME_RESTRITO.includes(valida.platform)
    ? [{
        nome: `dim_fonte_scd2[${valida.platform}] (nome da fonte)`,
        sql: `UPDATE ${qualificada(destino, 'dim_fonte_scd2')} d SET nome = NULL
       WHERE d.organization_id = ${literalBigQuery(valida.organizationId)} AND d.platform = '${valida.platform}'
         AND d.external_id = ${literalBigQuery(valida.externalId)} AND d.nome IS NOT NULL`,
      }]
    : [];
  return [...tabelas, ...passosDaStaging(daPlataforma, destino, [valida]), ...nome];
}

const HA_DIAS = (dias) => `TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${Number.parseInt(String(dias), 10)} DAY)`;

export function planoDeConformidadeDoYoutube({ manifesto, destino, dias = DIAS_DE_RETENCAO_DO_YOUTUBE }) {
  if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_DE_RETENCAO_DO_YOUTUBE) throw new Error(`prazo inválido: ${dias}`);
  const dimensoes = manifesto.filter((fato) => fato.plataforma === 'youtube' && fato.todoPeriodo && fato.tabela.startsWith('dim_'));
  return [
    ...dimensoes.map((fato) => ({
      nome: `${fato.tabela} (sem renovação há ${dias} dias)`,
      sql: `DELETE FROM ${qualificada(destino, fato.tabela)} WHERE carregado_em < ${HA_DIAS(dias)}`,
    })),
    {
      nome: `dim_fonte_scd2[youtube] (nome em versão encerrada há ${dias} dias)`,
      sql: `UPDATE ${qualificada(destino, 'dim_fonte_scd2')} SET nome = NULL
       WHERE platform = 'youtube' AND NOT atual AND nome IS NOT NULL AND valido_de < ${HA_DIAS(dias)}`,
    },
  ];
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
  return [...porPosse, ...sobras, ...passosDaStaging(manifesto, destino, fontes), ...passosPorClientId(tabelasComCliente, destino)];
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
