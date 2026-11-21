import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerArgumentos, resolverAlvo } from '../lib/alvoDoBigQuery.mjs';

const USO = `uso:
  node scripts/bq/verificar-integridade.mjs (--projeto <projeto> --dataset <dataset> | --prod)
                                            [--desde AAAA-MM-DD] [--tolerancia 0.005] [--estrito] [--imprimir-sql]

Só leitura (SELECT e dry run). Sai com código 1 se houver falha grave. Não há alvo padrão.
--prod        atalho para tria-platform.tria_dw (produção)
--desde       início da janela das somas de consistência (padrão: 35 dias atrás)
--tolerancia  diferença relativa aceita nas somas (padrão 0,5%)
--estrito     avisos (órfãos) também falham
--imprimir-sql mostra as consultas e não executa nada`;

const DIR = fileURLToPath(new URL('.', import.meta.url));
const VALIDO_ATE_ABERTO = "TIMESTAMP '9999-12-31 00:00:00+00'";
const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/;
const TRANSVERSAIS = {
  dim_fonte_scd2: ['organization_id', 'platform', 'external_id'],
  dim_cliente_scd2: ['organization_id', 'client_id'],
};
const OPERACIONAIS = ['gov_snapshot_fontes', 'gov_paridade', 'qc_execucoes', 'gov_cobertura_cliente'];

const CONSISTENCIAS = [
  {
    nome: 'Meta: fato_ads_diario = soma de fato_meta_entrega_diaria por campanha x dia',
    a: { tabela: 'fato_ads_diario', filtro: "platform = 'meta'", chave: ['organization_id', 'ad_account_id', 'external_campaign_id', 'data_dia'] },
    b: { tabela: 'fato_meta_entrega_diaria', chave: ['organization_id', 'ad_account_id', 'campaign_id', 'data_dia'] },
    metricas: ['investimento', 'impressoes', 'cliques'],
  },
  {
    nome: 'Google: fato_ads_diario = fato_google_campanha_diario por campanha x dia',
    a: { tabela: 'fato_ads_diario', filtro: "platform = 'google'", chave: ['organization_id', 'ad_account_id', 'external_campaign_id', 'data_dia'] },
    b: { tabela: 'fato_google_campanha_diario', chave: ['organization_id', 'ad_account_id', 'external_campaign_id', 'data_dia'] },
    metricas: ['investimento', 'impressoes', 'cliques', 'conversoes'],
  },
];

function opcoes(argv) {
  const valores = lerArgumentos(
    argv,
    {
      desde: { type: 'string' },
      tolerancia: { type: 'string', default: '0.005' },
      estrito: { type: 'boolean', default: false },
      'imprimir-sql': { type: 'boolean', default: false },
    },
    USO,
  );
  const alvo = resolverAlvo(valores, USO);
  const trintaECincoDias = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
  const resultado = {
    projeto: alvo.projeto,
    dataset: alvo.dataset,
    desde: valores.desde ?? trintaECincoDias,
    tolerancia: Number(valores.tolerancia),
    estrito: valores.estrito,
    imprimirSql: valores['imprimir-sql'],
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resultado.desde)) sair(`--desde inválido.\n\n${USO}`);
  if (!(resultado.tolerancia >= 0)) sair(`--tolerancia inválida.\n\n${USO}`);
  return resultado;
}

function sair(mensagem) {
  console.error(mensagem);
  process.exit(2);
}

const lista = (valor) => (Array.isArray(valor) ? valor : [valor]);

function exigirIdentificadores(origem, ...valores) {
  for (const valor of valores.flat()) {
    if (!IDENTIFICADOR.test(valor ?? '')) sair(`identificador inválido em ${origem}: ${JSON.stringify(valor)}`);
  }
}

function lerManifestos() {
  const dir = join(DIR, 'manifesto');
  return readdirSync(dir)
    .filter((nome) => nome.endsWith('.json'))
    .sort()
    .flatMap((nome) => JSON.parse(readFileSync(join(dir, nome), 'utf8')).map((entrada) => {
      exigirIdentificadores(nome, entrada.tabela, entrada.chave, entrada.plataforma, entrada.grao ?? []);
      for (const opcional of [entrada.colunaPlataforma, entrada.data, entrada.momento]) {
        if (opcional !== undefined) exigirIdentificadores(nome, opcional);
      }
      for (const entidade of entrada.entidades ?? []) exigirIdentificadores(nome, entidade.dimensao, lista(entidade.coluna), lista(entidade.chaveDim));
      return { ...entrada, arquivo: nome };
    }));
}

function lerDocumentadas() {
  const texto = readFileSync(join(DIR, 'README.md'), 'utf8');
  return new Set([...texto.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]));
}

const pareceTabela = (nome) => /^(fato|vw|gov|qc)_[a-z0-9_]+$/.test(nome) || /^dim_[a-z0-9_]+_scd2$/.test(nome);

function criarConsultor({ projeto, dataset, imprimirSql }) {
  const ref = (nome) => `\`${projeto}.${dataset}.${nome}\``;

  function somenteLeitura(sql) {
    if (!/^\s*(SELECT|WITH)\b/i.test(sql) || /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE)\s/i.test(sql)) {
      throw new Error(`consulta recusada (não é só leitura): ${sql.slice(0, 120)}`);
    }
    return sql;
  }

  function consultar(sql) {
    somenteLeitura(sql);
    if (imprimirSql) {
      console.log(`\n-- consulta\n${sql};`);
      return [];
    }
    const saida = execFileSync('bq', [
      '--project_id', projeto, '--quiet', 'query', '--use_legacy_sql=false', '--format=json', '--max_rows=1000000', sql,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });
    const texto = saida.trim();
    return texto ? JSON.parse(texto) : [];
  }

  function validar(sql) {
    somenteLeitura(sql);
    if (imprimirSql) {
      console.log(`\n-- dry run\n${sql};`);
      return null;
    }
    try {
      execFileSync('bq', ['--project_id', projeto, '--quiet', 'query', '--dry_run', '--use_legacy_sql=false', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return null;
    } catch (erro) {
      return String(erro.stderr || erro.stdout || erro.message).trim().split('\n').slice(-3).join(' ').slice(0, 400);
    }
  }

  return { ref, consultar, validar };
}

const unir = (consultas) => consultas.join('\nUNION ALL\n');
const struct = (colunas, alias = '') => `TO_JSON_STRING(STRUCT(${colunas.map((c) => `${alias}${c} AS ${c}`).join(', ')}))`;
const literalTexto = (valor) => `'${String(valor).replace(/[^a-z0-9_ :=x.-]/gi, '')}'`;

function relatorio() {
  const graves = [];
  const avisos = [];
  return {
    graves,
    avisos,
    secao(titulo) {
      console.log(`\n== ${titulo}`);
    },
    ok(mensagem) {
      console.log(`  ok    ${mensagem}`);
    },
    grave(mensagem) {
      graves.push(mensagem);
      console.log(`  FALHA ${mensagem}`);
    },
    aviso(mensagem) {
      avisos.push(mensagem);
      console.log(`  aviso ${mensagem}`);
    },
  };
}

function verificarInventario(ctx) {
  const { consultor, manifestos, documentadas, rel } = ctx;
  rel.secao('Inventário: manifesto, dataset e README');
  const linhas = consultor.consultar(`SELECT table_name, table_type FROM ${consultor.ref('INFORMATION_SCHEMA.TABLES')}`);
  const existentes = new Map(linhas.map((linha) => [linha.table_name, linha.table_type]));
  ctx.existentes = existentes;
  if (consultor.imprimir) return;

  const esperadas = new Set([...manifestos.map((m) => m.tabela), ...Object.keys(TRANSVERSAIS), ...OPERACIONAIS]);
  const ausentes = [...esperadas].filter((tabela) => !existentes.has(tabela));
  if (ausentes.length) rel.grave(`tabelas do manifesto/transversais ausentes no dataset: ${ausentes.join(', ')}`);
  else rel.ok(`${esperadas.size} tabelas esperadas existem`);

  const publicadas = [...existentes].filter(([nome, tipo]) => (tipo === 'BASE TABLE' || tipo === 'VIEW') && !nome.startsWith('stg_')).map(([nome]) => nome);
  const semDoc = publicadas.filter((nome) => !documentadas.has(nome));
  if (semDoc.length) rel.grave(`no dataset e fora do README: ${semDoc.join(', ')}`);
  else rel.ok(`${publicadas.length} tabelas/views do dataset documentadas`);

  const fantasmas = [...documentadas].filter((nome) => pareceTabela(nome) && !existentes.has(nome));
  if (fantasmas.length) rel.grave(`no README e fora do dataset (DDL não aplicado?): ${fantasmas.join(', ')}`);
  else rel.ok('todo nome de tabela do README existe no dataset');
}

function porTabela(manifestos) {
  const mapa = new Map();
  for (const entrada of manifestos) if (!mapa.has(entrada.tabela)) mapa.set(entrada.tabela, entrada);
  return mapa;
}

function verificarDuplicatas(ctx) {
  const { consultor, manifestos, rel, existentes } = ctx;
  rel.secao('Duplicatas por grão (fatos)');
  const fatos = [...porTabela(manifestos).values()].filter((m) => m.tabela.startsWith('fato_') && m.grao && existentes.has(m.tabela));
  if (fatos.length === 0) return rel.aviso('nenhum fato com grão para conferir');
  const linhas = consultor.consultar(unir(fatos.map((m) => `SELECT ${literalTexto(m.tabela)} AS tabela, COUNT(*) AS linhas, COUNT(DISTINCT ${struct(m.grao)}) AS distintas FROM ${consultor.ref(m.tabela)}`)));
  for (const linha of linhas) {
    const excesso = Number(linha.linhas) - Number(linha.distintas);
    if (excesso > 0) rel.grave(`${linha.tabela}: ${excesso} linhas duplicadas no grão (${linha.linhas} linhas, ${linha.distintas} distintas)`);
  }
  if (linhas.length && !rel.graves.some((g) => g.includes('duplicadas'))) rel.ok(`${linhas.length} fatos sem duplicata no grão`);
}

function sqlScd2(consultor, tabela, chave) {
  const k = struct(chave);
  return `SELECT ${literalTexto(tabela)} AS tabela,
  (SELECT COUNT(*) FROM (SELECT ${k} AS k FROM ${consultor.ref(tabela)} GROUP BY k HAVING COUNTIF(atual) != 1)) AS chaves_sem_uma_atual,
  COUNTIF(proximo_de IS NOT NULL AND proximo_de < valido_ate) AS sobrepostas,
  COUNTIF(proximo_de IS NOT NULL AND proximo_de > valido_ate) AS lacunas,
  COUNTIF(valido_de >= valido_ate) AS intervalo_invalido,
  COUNTIF(atual != (valido_ate = ${VALIDO_ATE_ABERTO})) AS atual_inconsistente
FROM (
  SELECT valido_de, valido_ate, atual, LEAD(valido_de) OVER (PARTITION BY ${k} ORDER BY valido_de) AS proximo_de
  FROM ${consultor.ref(tabela)}
)`;
}

function verificarScd2(ctx) {
  const { consultor, manifestos, rel, existentes } = ctx;
  rel.secao('Dimensões SCD2: uma atual por chave, sem sobreposição nem lacuna');
  const chaves = new Map(Object.entries(TRANSVERSAIS));
  for (const m of manifestos) if (m.tabela.startsWith('dim_') && m.tabela.endsWith('_scd2') && m.grao) chaves.set(m.tabela, m.grao);
  for (const nome of existentes.keys()) {
    if (/^dim_.*_scd2$/.test(nome) && !chaves.has(nome)) rel.grave(`${nome}: SCD2 sem grão declarado no manifesto`);
  }
  const alvo = [...chaves].filter(([tabela]) => existentes.has(tabela));
  if (alvo.length === 0) return;
  const linhas = consultor.consultar(unir(alvo.map(([tabela, chave]) => sqlScd2(consultor, tabela, chave))));
  let problemas = 0;
  for (const linha of linhas) {
    const achados = ['chaves_sem_uma_atual', 'sobrepostas', 'lacunas', 'intervalo_invalido', 'atual_inconsistente']
      .filter((campo) => Number(linha[campo]) > 0)
      .map((campo) => `${campo}=${linha[campo]}`);
    if (achados.length) {
      problemas += 1;
      rel.grave(`${linha.tabela}: ${achados.join(', ')}`);
    }
  }
  if (linhas.length && problemas === 0) rel.ok(`${linhas.length} dimensões SCD2 íntegras`);
}

function momentoDoFato(entrada) {
  return entrada.momento ? `f.${entrada.momento}` : `TIMESTAMP(f.${entrada.data}, 'America/Sao_Paulo')`;
}

function verificarOrfaos(ctx) {
  const { consultor, manifestos, rel, existentes } = ctx;
  rel.secao('Órfãos: fato sem versão de dim_fonte_scd2 que cubra a data');
  const fonte = consultor.ref('dim_fonte_scd2');
  const alvo = manifestos.filter((m) => !m.todoPeriodo && existentes.has(m.tabela));
  if (alvo.length && existentes.has('dim_fonte_scd2')) {
    const linhas = consultor.consultar(unir(alvo.map((m) => {
      const filtro = m.colunaPlataforma ? `f.${m.colunaPlataforma} = ${literalTexto(m.plataforma)} AND ` : '';
      return `SELECT ${literalTexto(m.tabela)} AS tabela, ${literalTexto(m.plataforma)} AS plataforma, COUNT(*) AS orfas
FROM ${consultor.ref(m.tabela)} f
WHERE ${filtro}NOT EXISTS (
  SELECT 1 FROM ${fonte} d
  WHERE d.organization_id = f.organization_id AND d.platform = ${literalTexto(m.plataforma)} AND d.external_id = f.${m.chave}
    AND ${momentoDoFato(m)} >= d.valido_de AND ${momentoDoFato(m)} < d.valido_ate)`;
    })));
    const comOrfas = linhas.filter((linha) => Number(linha.orfas) > 0);
    for (const linha of comOrfas) rel.aviso(`${linha.tabela} [${linha.plataforma}]: ${linha.orfas} linhas sem dono na data`);
    if (linhas.length && comOrfas.length === 0) rel.ok(`${linhas.length} fatos com dono em toda linha`);
  }

  rel.secao('Órfãos de entidade: id do fato ausente na dimensão da entidade');
  const dims = porTabela(manifestos);
  const entidades = manifestos.flatMap((m) => (m.entidades ?? []).map((entidade) => ({ m, entidade, dim: dims.get(entidade.dimensao) })))
    .filter(({ m, dim }) => dim && existentes.has(m.tabela) && existentes.has(dim.tabela));
  if (entidades.length === 0) return;
  const linhas = consultor.consultar(unir(entidades.map(({ m, entidade, dim }) => {
    const colunas = lista(entidade.coluna);
    const chavesDim = lista(entidade.chaveDim);
    const filtro = m.colunaPlataforma ? `f.${m.colunaPlataforma} = ${literalTexto(m.plataforma)} AND ` : '';
    const iguais = chavesDim.map((c, i) => `d.${c} = f.${colunas[i]}`).join(' AND ');
    return `SELECT ${literalTexto(m.tabela)} AS tabela, ${literalTexto(entidade.dimensao)} AS dimensao, COUNT(DISTINCT ${struct(colunas, 'f.')}) AS orfas
FROM ${consultor.ref(m.tabela)} f
WHERE ${filtro}${colunas.map((c) => `f.${c} IS NOT NULL`).join(' AND ')}
  AND NOT EXISTS (SELECT 1 FROM ${consultor.ref(dim.tabela)} d WHERE d.organization_id = f.organization_id AND d.${dim.chave} = f.${m.chave} AND ${iguais})`;
  })));
  const comOrfas = linhas.filter((linha) => Number(linha.orfas) > 0);
  for (const linha of comOrfas) rel.aviso(`${linha.tabela} -> ${linha.dimensao}: ${linha.orfas} ids sem versão na dimensão`);
  if (linhas.length && comOrfas.length === 0) rel.ok(`${linhas.length} ligações fato -> entidade completas`);
}

function baseDaView(definicao) {
  const referencias = [...definicao.matchAll(/`?[\w-]+`?\.`?\w+`?\.`?(\w+)`?/g)].map((m) => m[1]);
  return referencias.find((nome) => !Object.hasOwn(TRANSVERSAIS, nome) && !nome.startsWith('INFORMATION_SCHEMA')) ?? null;
}

function verificarViews(ctx) {
  const { consultor, manifestos, rel, existentes } = ctx;
  rel.secao('Views: executam e não multiplicam linhas da base');
  const views = [...existentes].filter(([nome, tipo]) => tipo === 'VIEW' && nome.startsWith('vw_')).map(([nome]) => nome).sort();
  if (views.length === 0) return;

  const todas = unir(views.map((v) => `SELECT 1 AS um FROM ${consultor.ref(v)} WHERE FALSE`));
  if (consultor.validar(todas)) {
    for (const v of views) {
      const erro = consultor.validar(`SELECT 1 AS um FROM ${consultor.ref(v)} LIMIT 0`);
      if (erro) rel.grave(`${v} não executa: ${erro}`);
    }
  } else {
    rel.ok(`${views.length} views executam (dry run)`);
  }

  const definicoes = consultor.consultar(`SELECT table_name, view_definition FROM ${consultor.ref('INFORMATION_SCHEMA.VIEWS')} WHERE STARTS_WITH(table_name, 'vw_')`);
  const graos = porTabela(manifestos);
  const pares = definicoes
    .map((linha) => ({ view: linha.table_name, base: baseDaView(linha.view_definition), deduplica: /\bQUALIFY\b/i.test(linha.view_definition) }))
    .filter((par) => par.base && existentes.has(par.base) && !rel.graves.some((g) => g.startsWith(`${par.view} `)));
  for (const linha of definicoes) if (!baseDaView(linha.view_definition)) rel.aviso(`${linha.table_name}: base não identificada`);
  if (pares.length === 0) return;

  const linhas = consultor.consultar(unir(pares.map(({ view, base, deduplica }) => {
    const grao = graos.get(base)?.grao;
    const contagemBase = deduplica && grao ? `COUNT(DISTINCT ${struct(grao)})` : 'COUNT(*)';
    return `SELECT ${literalTexto(view)} AS view, ${literalTexto(base)} AS base,
  (SELECT COUNT(*) FROM ${consultor.ref(view)}) AS linhas_view,
  (SELECT ${contagemBase} FROM ${consultor.ref(base)}) AS linhas_base`;
  })));
  let divergentes = 0;
  let ocultas = 0;
  for (const linha of linhas) {
    const naView = Number(linha.linhas_view);
    const naBase = Number(linha.linhas_base);
    if (naView > naBase) {
      divergentes += 1;
      rel.grave(`${linha.view}: ${naView} linhas na view x ${naBase} na base ${linha.base} (a view multiplica linhas)`);
    }
    if (naView < naBase) ocultas += naBase - naView;
  }
  if (linhas.length && divergentes === 0) rel.ok(`${linhas.length} views sem multiplicar linhas da base`);
  if (ocultas > 0) rel.ok(`${ocultas} linhas de cliente excluído ocultas pelas views (exclusão lógica, ADR 0022)`);
}

function ladoDaSoma(consultor, lado, metricas, grao, desde) {
  const dedup = grao ? `QUALIFY ROW_NUMBER() OVER (PARTITION BY ${grao.join(', ')} ORDER BY inserido_em DESC) = 1` : '';
  const filtro = [`data_dia >= DATE '${desde}'`, lado.filtro].filter(Boolean).join(' AND ');
  const chave = lado.chave.map((c, i) => `${c} AS k${i}`).join(', ');
  return `SELECT ${chave}, ${metricas.map((m) => `SUM(${m}) AS ${m}`).join(', ')}
  FROM (SELECT * FROM ${consultor.ref(lado.tabela)} WHERE ${filtro} ${dedup})
  GROUP BY ${lado.chave.map((_, i) => `k${i}`).join(', ')}`;
}

function verificarConsistencia(ctx) {
  const { consultor, manifestos, rel, existentes, desde, tolerancia } = ctx;
  rel.secao(`Consistência de somas (desde ${desde}, tolerância ${(tolerancia * 100).toFixed(2)}%)`);
  const graos = porTabela(manifestos);
  for (const regra of CONSISTENCIAS) {
    if (!existentes.has(regra.a.tabela) || !existentes.has(regra.b.tabela)) {
      rel.aviso(`${regra.nome}: tabela ausente, pulada`);
      continue;
    }
    const juncao = regra.a.chave.map((_, i) => `a.k${i} = b.k${i}`).join(' AND ');
    const diverge = regra.metricas
      .map((m) => `ABS(COALESCE(a.${m}, 0) - COALESCE(b.${m}, 0)) > GREATEST(${tolerancia} * GREATEST(ABS(COALESCE(a.${m}, 0)), ABS(COALESCE(b.${m}, 0))), 0.01)`)
      .join(' OR ');
    const linhas = consultor.consultar(`WITH a AS (${ladoDaSoma(consultor, regra.a, regra.metricas, graos.get(regra.a.tabela)?.grao, desde)}),
b AS (${ladoDaSoma(consultor, regra.b, regra.metricas, graos.get(regra.b.tabela)?.grao, desde)})
SELECT TO_JSON_STRING(STRUCT(${regra.a.chave.map((c, i) => `COALESCE(a.k${i}, b.k${i}) AS ${c}`).join(', ')})) AS chave,
  ${regra.metricas.map((m) => `a.${m} AS a_${m}, b.${m} AS b_${m}`).join(', ')}
FROM a FULL OUTER JOIN b ON ${juncao}
WHERE ${diverge}
ORDER BY chave
LIMIT 50`);
    if (consultor.imprimir) continue;
    if (linhas.length === 0) rel.ok(regra.nome);
    else {
      rel.grave(`${regra.nome}: ${linhas.length}${linhas.length === 50 ? '+' : ''} chaves divergentes`);
      for (const linha of linhas.slice(0, 5)) {
        console.log(`        ${linha.chave} ${regra.metricas.map((m) => `${m}: ${linha[`a_${m}`] ?? '-'} x ${linha[`b_${m}`] ?? '-'}`).join('; ')}`);
      }
    }
  }
}

function principal() {
  const opc = opcoes(process.argv.slice(2));
  const consultor = { ...criarConsultor(opc), imprimir: opc.imprimirSql };
  const manifestos = lerManifestos();
  const rel = relatorio();
  const ctx = { ...opc, consultor, manifestos, documentadas: lerDocumentadas(), rel, existentes: new Map() };

  console.log(`Integridade do BigQuery: ${opc.projeto}.${opc.dataset} (${manifestos.length} entradas de manifesto)`);
  try {
    verificarInventario(ctx);
    if (opc.imprimirSql) {
      ctx.existentes = new Map([...manifestos.map((m) => [m.tabela, 'BASE TABLE']), ...Object.keys(TRANSVERSAIS).map((t) => [t, 'BASE TABLE'])]);
    }
    verificarDuplicatas(ctx);
    verificarScd2(ctx);
    verificarOrfaos(ctx);
    verificarViews(ctx);
    verificarConsistencia(ctx);
  } catch (erro) {
    const detalhe = String(erro.stderr || erro.message).trim().split('\n').slice(-5).join('\n');
    console.error(`\nErro ao consultar o BigQuery:\n${detalhe}`);
    process.exit(2);
  }

  const avisosGraves = opc.estrito ? rel.avisos.length : 0;
  console.log(`\nResumo: ${rel.graves.length} falha(s), ${rel.avisos.length} aviso(s)${opc.estrito ? ' (modo estrito)' : ''}.`);
  process.exit(rel.graves.length + avisosGraves > 0 ? 1 : 0);
}

principal();
