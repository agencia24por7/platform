import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USO = `uso:
  node scripts/titular.mjs exportar <email>
  node scripts/titular.mjs anonimizar <email> [--confirmar]
  node scripts/titular.mjs excluir-cliente <client_id> [--confirmar] [--por <quem>]
  node scripts/titular.mjs restaurar-cliente <client_id> [--confirmar] [--por <quem>]
  node scripts/titular.mjs expurgar-cliente <client_id> [--confirmar]

excluir-cliente é a exclusão lógica (nada é apagado; restaurar-cliente desfaz).
expurgar-cliente apaga de vez no Postgres e no BigQuery: só para obrigação legal.
Opções: --local (banco do docker local em vez da VM de produção).
Sem --confirmar, nenhum comando que altera dados executa: só mostra o que seria afetado.
Veja docs/lgpd/atendimento-ao-titular.md.`;

const VM = process.env.VM ?? 'tria-producao-vm';
const ZONE = process.env.ZONE ?? 'us-central1-a';
const PROJETO = process.env.PROJETO ?? 'tria-platform';
const DATASET = process.env.DATASET ?? 'tria_dw';
const APP_URL = process.env.APP_URL ?? 'https://platform.agencia24por7.com';
const SEGREDO_DO_WORKER = process.env.SEGREDO_DO_WORKER ?? 'tria-producao-worker-token';
const PSQL = ['docker', 'exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-tA', '-v', 'ON_ERROR_STOP=1'];

const [comando, alvo, ...resto] = process.argv.slice(2);
const confirmar = resto.includes('--confirmar');
const local = resto.includes('--local') || process.argv.includes('--local');
const indiceDoPor = resto.indexOf('--por');
const por = indiceDoPor >= 0 ? resto[indiceDoPor + 1] : `titular.mjs (${process.env.USER ?? 'operador'})`;

function falhar(mensagem) {
  console.error(mensagem);
  process.exit(1);
}

function literal(valor) {
  if (valor.includes('$')) falhar('valor com caractere não permitido');
  return `$v$${valor}$v$`;
}

function consultar(sqlTexto) {
  const [programa, ...args] = local
    ? PSQL
    : ['gcloud', 'compute', 'ssh', VM, '--zone', ZONE, '--tunnel-through-iap', '--command', `sudo ${PSQL.join(' ')}`];
  return execFileSync(programa, args, { input: sqlTexto, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] }).trim();
}

function exigirEmail(valor) {
  if (!valor || !/^[^\s@$']+@[^\s@$']+\.[^\s@$']+$/.test(valor)) falhar(`e-mail inválido.\n\n${USO}`);
  return valor;
}

function exigirUuid(valor) {
  if (!valor || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor)) {
    falhar(`client_id inválido.\n\n${USO}`);
  }
  return valor;
}

function exportar(email) {
  const e = literal(email.toLowerCase());
  return consultar(`
    WITH u AS (SELECT * FROM core.users WHERE lower(email) = ${e})
    SELECT jsonb_pretty(jsonb_build_object(
      'geradoEm', now(),
      'usuario', (SELECT to_jsonb(u) FROM u),
      'vinculos', (SELECT coalesce(jsonb_agg(jsonb_build_object('organizacao', o.name, 'papel', m.role,
                     'desde', m.created_at, 'revogadoEm', m.revoked_at)), '[]')
                   FROM core.members m JOIN core.organizations o ON o.id = m.organization_id
                   WHERE m.user_id IN (SELECT id FROM u)),
      'convites', (SELECT coalesce(jsonb_agg(jsonb_build_object('organizacao', o.name, 'papel', i.role,
                     'criadoEm', i.created_at, 'aceitoEm', i.accepted_at, 'revogadoEm', i.revoked_at)), '[]')
                   FROM core.invitations i JOIN core.organizations o ON o.id = i.organization_id
                   WHERE lower(i.email) = ${e}),
      'conexoesAutorizadas', (SELECT coalesce(jsonb_agg(jsonb_build_object('plataforma', c.platform,
                     'conta', c.label, 'autorizadaEm', c.authorized_at, 'estado', c.status)), '[]')
                   FROM integrations.connections c WHERE lower(c.account_email) = ${e}),
      'trilhaDeAuditoria', (SELECT coalesce(jsonb_agg(jsonb_build_object('quando', a.occurred_at, 'acao', a.action,
                     'ip', host(a.source_ip)) ORDER BY a.occurred_at), '[]')
                   FROM audit.audit_log a
                   WHERE a.actor_id IN (SELECT id::text FROM u) OR a.target_id IN (SELECT id::text FROM u)
                      OR lower(a.metadata ->> 'email') = ${e})
    ));`);
}

function anonimizar(email) {
  if (!confirmar) {
    console.log('Simulação. O que seria anonimizado:');
    console.log(exportar(email));
    console.log('\nRode de novo com --confirmar para anonimizar.');
    return;
  }
  console.log(consultar(`SELECT jsonb_pretty(core.anonimizar_titular_e_encerrar(${literal(email)}));`));
}

const IDENTIFICADOR = /^[a-z][a-z0-9_]*$/;

function validarEntrada(arquivo, entrada) {
  const { tabela, chave, plataforma, colunaPlataforma, data, momento, todoPeriodo } = entrada;
  const recorte = [data !== undefined, momento !== undefined, todoPeriodo === true].filter(Boolean).length;
  const valido = [tabela, chave, plataforma].every((valor) => IDENTIFICADOR.test(valor ?? ''))
    && [colunaPlataforma, data, momento].every((valor) => valor === undefined || IDENTIFICADOR.test(valor))
    && (todoPeriodo === undefined || todoPeriodo === true)
    && recorte === 1;
  if (!valido) falhar(`manifesto inválido em ${arquivo}: ${JSON.stringify(entrada)}`);
  return entrada;
}

function lerManifesto() {
  const dir = fileURLToPath(new URL('./bq/manifesto/', import.meta.url));
  return readdirSync(dir)
    .filter((nome) => nome.endsWith('.json'))
    .sort()
    .flatMap((nome) => JSON.parse(readFileSync(join(dir, nome), 'utf8')).map((entrada) => validarEntrada(nome, entrada)));
}

const FATOS_POR_FONTE = lerManifesto();

function sqlExpurgo(fato) {
  const alvo = `\`${PROJETO}.${DATASET}.${fato.tabela}\``;
  const dim = `\`${PROJETO}.${DATASET}.dim_fonte_scd2\``;
  const plataforma = `'${fato.plataforma}'`;
  const mesmaFonte = (alias) =>
    `${alias}.organization_id = f.organization_id AND ${alias}.platform = ${plataforma} AND ${alias}.external_id = f.${fato.chave}`;
  const filtroPlataforma = fato.colunaPlataforma ? ` AND f.${fato.colunaPlataforma} = ${plataforma}` : '';

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

function expurgarFatosDoCliente(clientId) {
  for (const fato of FATOS_POR_FONTE) {
    execFileSync('bq', [
      '--project_id', PROJETO, 'query', '--use_legacy_sql=false', `--parameter=id:STRING:${clientId}`, sqlExpurgo(fato),
    ], { stdio: 'inherit' });
  }
}

function tabelasComCliente() {
  const saida = execFileSync('bq', [
    '--project_id', PROJETO, 'query', '--use_legacy_sql=false', '--format=csv',
    `SELECT c.table_name FROM \`${PROJETO}.${DATASET}.INFORMATION_SCHEMA.COLUMNS\` c JOIN \`${PROJETO}.${DATASET}.INFORMATION_SCHEMA.TABLES\` t ON t.table_name = c.table_name WHERE c.column_name = 'client_id' AND t.table_type = 'BASE TABLE'`,
  ], { encoding: 'utf8' });
  return saida.split('\n').slice(1).map((linha) => linha.trim()).filter(Boolean);
}

function exigirPor(valor) {
  if (!valor || valor.startsWith('--') || valor.length > 200) falhar(`--por inválido.\n\n${USO}`);
  return valor;
}

function resumoDoCliente(id) {
  return consultar(`
    SELECT jsonb_pretty(jsonb_build_object(
      'cliente', (SELECT name FROM core.clients WHERE id = ${id}::uuid),
      'status', (SELECT status FROM core.clients WHERE id = ${id}::uuid),
      'excluidoEm', (SELECT excluido_em FROM core.clients WHERE id = ${id}::uuid),
      'contas', (SELECT count(*) FROM integrations.ad_accounts WHERE client_id = ${id}::uuid),
      'metricas', (SELECT count(*) FROM metrics.metrics_daily d JOIN integrations.ad_accounts a ON a.id = d.ad_account_id
                   WHERE a.client_id = ${id}::uuid)
    ));`);
}

const AVISO_BIGQUERY =
  'BigQuery: nada é apagado. Depois da mudança no Postgres o script dispara a sincronização de dimensões, que grava a nova versão do cliente em dim_cliente_scd2; as views vw_* refletem na hora (ADR 0022).';

function tokenDoWorker() {
  if (local) return process.env.WORKER_TOKEN ?? process.env.TRIA_WORKER_TOKEN ?? '';
  return execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret', SEGREDO_DO_WORKER, '--project', PROJETO], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function sincronizarDimensoes() {
  const base = local ? 'http://localhost:3000' : APP_URL;
  try {
    const token = tokenDoWorker();
    if (!token) throw new Error(local ? 'WORKER_TOKEN ausente no ambiente' : `segredo ${SEGREDO_DO_WORKER} vazio`);
    const resposta = await fetch(`${base}/api/v0/manutencao/dimensoes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(120_000),
    });
    const corpo = await resposta.text();
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}: ${corpo.slice(0, 500)}`);
    console.log(`Dimensões sincronizadas no BigQuery: ${corpo.slice(0, 500)}`);
  } catch (erro) {
    console.warn(`AVISO: a mudança no Postgres foi feita, mas a sincronização de dimensões falhou (${erro.message}).`);
    console.warn('As views vw_* refletem na próxima sincronização diária, ou rode de novo pelo workflow de dimensões.');
  }
}

async function excluirCliente(clientId) {
  const id = literal(clientId);
  const quem = literal(exigirPor(por));
  console.log(resumoDoCliente(id));
  console.log(AVISO_BIGQUERY);
  if (!confirmar) {
    console.log('\nSimulação. Rode de novo com --confirmar para a exclusão lógica (some do app, sai da coleta, nada é apagado).');
    return;
  }
  console.log(consultar(`SELECT jsonb_pretty(core.excluir_cliente(${id}::uuid, ${quem}));`));
  await sincronizarDimensoes();
  console.log(`Cliente excluído logicamente. Para desfazer: node scripts/titular.mjs restaurar-cliente ${clientId} --confirmar`);
}

async function restaurarCliente(clientId) {
  const id = literal(clientId);
  const quem = literal(exigirPor(por));
  console.log(resumoDoCliente(id));
  console.log(AVISO_BIGQUERY);
  if (!confirmar) {
    console.log('\nSimulação. Rode de novo com --confirmar para restaurar (o cliente volta pausado).');
    return;
  }
  console.log(consultar(`SELECT jsonb_pretty(core.restaurar_cliente(${id}::uuid, ${quem}));`));
  await sincronizarDimensoes();
  console.log('Cliente restaurado e pausado. Retome a coleta na tela do cliente.');
}

async function expurgarCliente(clientId) {
  const id = literal(clientId);
  console.log(resumoDoCliente(id));
  const tabelas = local ? [] : tabelasComCliente();
  if (!local) {
    console.log(`BigQuery: tabelas do manifesto (scripts/bq/manifesto), pelo período de posse em dim_fonte_scd2: ${FATOS_POR_FONTE.map((f) => `${f.tabela}[${f.plataforma}${f.todoPeriodo ? ', todo o período' : ''}]`).join(', ')}`);
    console.log(`BigQuery: depois, linhas com client_id em ${tabelas.join(', ')}`);
  }

  if (!confirmar) {
    console.log('\nSimulação. EXPURGO apaga de vez e não tem volta: use só por obrigação legal de eliminação (docs/lgpd/atendimento-ao-titular.md).');
    console.log('Rode de novo com --confirmar para expurgar no Postgres e no BigQuery.');
    return;
  }

  console.log(consultar(`SELECT jsonb_pretty(core.expurgar_cliente(${id}::uuid));`));
  if (!local) expurgarFatosDoCliente(clientId);
  for (const tabela of tabelas) {
    execFileSync('bq', [
      '--project_id', PROJETO, 'query', '--use_legacy_sql=false', `--parameter=id:STRING:${clientId}`,
      `DELETE FROM \`${PROJETO}.${DATASET}.${tabela}\` WHERE CAST(client_id AS STRING) = @id`,
    ], { stdio: 'inherit' });
  }
  await sincronizarDimensoes();
  console.log('Cliente expurgado. Os backups expiram em até 30 dias (docs/lgpd/retencao.md).');
}

switch (comando) {
  case 'exportar':
    console.log(exportar(exigirEmail(alvo)));
    break;
  case 'anonimizar':
    anonimizar(exigirEmail(alvo));
    break;
  case 'excluir-cliente':
    await excluirCliente(exigirUuid(alvo));
    break;
  case 'restaurar-cliente':
    await restaurarCliente(exigirUuid(alvo));
    break;
  case 'expurgar-cliente':
    await expurgarCliente(exigirUuid(alvo));
    break;
  default:
    falhar(USO);
}
