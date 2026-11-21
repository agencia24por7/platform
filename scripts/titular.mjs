import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  executarPassos,
  passosPorClientId,
  planoDoExpurgo,
  planoDoExpurgoDaFonte,
  sqlVersoesDoCliente,
  validarEntrada as entradaValida,
  validarFontes,
} from './bq/expurgo.mjs';
import { etapasDoExpurgo, expurgarArmazenamento } from './lib/armazenamentoDoTitular.mjs';

const USO = `uso:
  node scripts/titular.mjs exportar <email>
  node scripts/titular.mjs anonimizar <email> [--confirmar]
  node scripts/titular.mjs excluir-cliente <client_id> [--confirmar] [--por <quem>]
  node scripts/titular.mjs restaurar-cliente <client_id> [--confirmar] [--por <quem>]
  node scripts/titular.mjs expurgar-cliente <client_id> [--confirmar] [--somente-armazenamento]
  node scripts/titular.mjs expurgar-fonte <organization_id> <plataforma> <external_id> [--confirmar]
  node scripts/titular.mjs pedidos-de-exclusao listar
  node scripts/titular.mjs pedidos-de-exclusao andamento <codigo> [--confirmar] [--por <quem>]
  node scripts/titular.mjs pedidos-de-exclusao concluir <codigo> --evidencia <texto> [--confirmar] [--por <quem>]

excluir-cliente é a exclusão lógica (nada é apagado; restaurar-cliente desfaz); despublica do
bucket o brain derivado (contexto/brain/ e brain/), que volta a ser gerado se o cliente for restaurado.
expurgar-cliente apaga de vez no BigQuery, no bucket do contexto (orgs/{org}/clientes/{cliente}/,
todas as gerações) e por fim no Postgres: só para obrigação legal, com o cliente já excluído
logicamente. Se falhar no meio, rode o mesmo comando de novo. --somente-armazenamento repete só
o expurgo do bucket (também depois de o cliente sumir do Postgres).
expurgar-fonte apaga do BigQuery todos os dados de uma fonte (fatos, dimensões, staging) numa
organização, qualquer que seja o cliente: é o expurgo de quando a autorização acaba (YouTube, ADR 0029).
pedidos-de-exclusao lista e atende os pedidos recebidos pelo callback de exclusão da Meta.
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
const somenteArmazenamento = resto.includes('--somente-armazenamento');
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
  return valor.toLowerCase();
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

function validarEntrada(arquivo, entrada) {
  if (!entradaValida(entrada)) falhar(`manifesto inválido em ${arquivo}: ${JSON.stringify(entrada)}`);
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
const DESTINO = { projeto: PROJETO, dataset: DATASET };

function executarNoBigQuery(clientId) {
  return (passo) => {
    console.log(`BigQuery: ${passo.nome}`);
    execFileSync('bq', [
      '--project_id', PROJETO, 'query', '--use_legacy_sql=false', `--parameter=id:STRING:${clientId}`, passo.sql,
    ], { stdio: 'inherit' });
  };
}

function rodarPassos(passos, clientId, contexto) {
  const resultado = executarPassos(passos, executarNoBigQuery(clientId));
  if (resultado.ok) return;
  console.error(`\nFALHOU no BigQuery em ${resultado.falhou} (${resultado.erro?.message ?? 'erro'}).`);
  console.error(`Pendentes (${resultado.pendentes.length}): ${resultado.pendentes.join(', ')}`);
  console.error(contexto);
  process.exit(1);
}

function fontesDoCliente(id) {
  const saida = consultar(`
    SELECT coalesce(json_agg(json_build_object('organizationId', organization_id, 'platform', platform, 'externalId', external_id)), '[]')
    FROM (
      SELECT organization_id, platform::text AS platform, external_id FROM integrations.ad_accounts WHERE client_id = ${id}::uuid
      UNION
      SELECT organization_id, platform::text, external_id FROM integrations.connection_accounts
      WHERE client_id = ${id}::uuid AND platform NOT IN ('google', 'meta')
    ) f;`);
  return validarFontes(JSON.parse(saida || '[]'));
}

function estadoDoCliente(id) {
  return JSON.parse(consultar(`
    SELECT json_build_object(
      'existe', count(*) > 0,
      'id', min(id::text),
      'organizationId', coalesce(min(organization_id::text), (
        SELECT min(organization_id::text) FROM audit.audit_log
         WHERE action = 'client.purged' AND target_type = 'client' AND target_id = ${id}::uuid::text)),
      'excluido', bool_or(excluido_em IS NOT NULL),
      'expurgado', EXISTS (SELECT 1 FROM audit.audit_log
                           WHERE action = 'client.purged' AND target_type = 'client' AND target_id = ${id}::uuid::text))
    FROM core.clients WHERE id = ${id}::uuid;`));
}

function versoesDoClienteEmDimFonte(clientId) {
  const saida = execFileSync('bq', [
    '--project_id', PROJETO, 'query', '--use_legacy_sql=false', '--format=csv', `--parameter=id:STRING:${clientId}`,
    sqlVersoesDoCliente(DESTINO),
  ], { encoding: 'utf8' });
  return Number(saida.split('\n')[1]?.trim() ?? 'NaN');
}

function tabelasComCliente() {
  const saida = execFileSync('bq', [
    '--project_id', PROJETO, 'query', '--use_legacy_sql=false', '--format=csv',
    `SELECT c.table_name FROM \`${PROJETO}.${DATASET}.INFORMATION_SCHEMA.COLUMNS\` c JOIN \`${PROJETO}.${DATASET}.INFORMATION_SCHEMA.TABLES\` t ON t.table_name = c.table_name WHERE c.column_name = 'client_id' AND t.table_type = 'BASE TABLE'`,
  ], { encoding: 'utf8' });
  return saida.split('\n').slice(1).map((linha) => linha.trim()).filter(Boolean);
}

function exigirPlataforma(valor) {
  if (!valor || !/^[a-z][a-z0-9_]*$/.test(valor)) falhar(`plataforma inválida.\n\n${USO}`);
  return valor;
}

function exigirCodigo(valor) {
  if (!valor || !/^[A-Z0-9]{16,64}$/.test(valor)) falhar(`código de confirmação inválido.\n\n${USO}`);
  return valor;
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

async function sincronizarDimensoes({ obrigatoria = false } = {}) {
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
    if (obrigatoria) {
      falhar(`A sincronização de dimensões falhou (${erro.message}). Expurgo abortado antes de apagar qualquer coisa: o período de posse em dim_fonte_scd2 precisa estar em dia. Corrija e rode de novo.`);
    }
    console.warn(`AVISO: a mudança no Postgres foi feita, mas a sincronização de dimensões falhou (${erro.message}).`);
    console.warn('As views vw_* refletem na próxima sincronização diária, ou rode de novo pelo workflow de dimensões.');
  }
}

async function purgarArmazenamento(organizationId, clientId, modo, { obrigatoria, contexto }) {
  const base = local ? 'http://localhost:3000' : APP_URL;
  let token = '';
  try {
    token = tokenDoWorker();
  } catch (erro) {
    token = '';
    console.warn(`Token do worker indisponível (${erro.message}).`);
  }
  const resultado = await expurgarArmazenamento({ base, token, organizationId, clientId, modo, local });
  if (resultado.ok) {
    const sufixo = resultado.desativado ? ' (bucket desativado neste ambiente)' : '';
    console.log(`Bucket do contexto (${modo}): ${resultado.apagados} objeto(s) apagado(s), todas as gerações${sufixo}.`);
    return true;
  }
  if (obrigatoria) falhar(`O expurgo do bucket falhou (${resultado.erro}). ${contexto}`);
  console.warn(`AVISO: o bucket não foi despublicado (${resultado.erro}). ${contexto}`);
  return false;
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
  const excluido = JSON.parse(consultar(`SELECT core.excluir_cliente(${id}::uuid, ${quem});`));
  console.log(JSON.stringify(excluido, null, 2));
  await sincronizarDimensoes();
  await purgarArmazenamento(excluido.organizacao, clientId, 'derivados', {
    obrigatoria: false,
    contexto: 'A varredura do brain (publicar-pendentes) despublica o export do cliente excluído na próxima rodada; ou rode de novo pelo workflow.',
  });
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

async function expurgarCliente(idInformado) {
  const estado = estadoDoCliente(literal(idInformado));
  if (!estado.existe && !estado.expurgado) {
    falhar(`Cliente ${idInformado} não existe e não há client.purged para esse id na auditoria. Confira o id.`);
  }
  const clientId = estado.existe ? estado.id : idInformado;
  const id = literal(clientId);
  const organizationId = estado.organizationId;
  const etapas = etapasDoExpurgo({ existe: estado.existe, local, somenteArmazenamento });

  if (somenteArmazenamento) {
    console.log(`Só o bucket do contexto: orgs/${organizationId}/clientes/${clientId}/ (todas as gerações).`);
    if (!estado.excluido && estado.existe) {
      console.log('O cliente ainda não foi excluído logicamente: o app recusa apagar o bucket de cliente ativo.');
      if (confirmar) process.exit(1);
    }
    if (!confirmar) {
      console.log('Simulação. Rode de novo com --confirmar para apagar o prefixo do cliente no bucket.');
      return;
    }
    await purgarArmazenamento(organizationId, clientId, 'tudo', { obrigatoria: true, contexto: 'Rode o mesmo comando de novo: é idempotente.' });
    return;
  }

  const tabelas = local ? [] : tabelasComCliente();

  if (!estado.existe) {
    console.log('O cliente já não existe no Postgres: o expurgo foi até o fim lá. Falta repetir o bucket do contexto e a limpeza por client_id no BigQuery.');
    if (!confirmar) {
      console.log(`Simulação. Rode de novo com --confirmar para apagar o prefixo do cliente no bucket e as linhas com client_id em ${tabelas.join(', ') || '(nenhuma tabela)'}.`);
      return;
    }
    await executarEtapas(etapas, {
      armazenamento: () => purgarArmazenamento(organizationId, clientId, 'tudo', { obrigatoria: true, contexto: 'Rode o mesmo comando de novo: cada passo é idempotente.' }),
      bigquery_por_client_id: () => rodarPassos(passosPorClientId(tabelas, DESTINO), clientId, 'Rode o mesmo comando de novo: cada passo é idempotente.'),
      dimensoes: () => sincronizarDimensoes(),
    });
    console.log('Limpeza por client_id concluída.');
    return;
  }

  console.log(resumoDoCliente(id));
  const fontes = fontesDoCliente(id);
  if (!local) {
    console.log(`BigQuery: tabelas do manifesto (scripts/bq/manifesto), pelo período de posse em dim_fonte_scd2: ${FATOS_POR_FONTE.map((f) => `${f.tabela}[${f.plataforma}${f.todoPeriodo ? ', todo o período' : ''}]`).join(', ')}`);
    console.log(`BigQuery: depois, as linhas das fontes que só foram deste cliente (${fontes.length} fonte(s)), e por fim as linhas com client_id em ${tabelas.join(', ')}`);
  }
  console.log(`Bucket do contexto: orgs/${organizationId}/clientes/${clientId}/ inteiro (arquivos/, contexto/, brain/, todas as gerações), antes do Postgres.`);
  console.log(`Ordem: ${etapas.join(' → ')}`);
  if (!estado.excluido) {
    console.log('\nO cliente ainda não foi excluído logicamente. Rode antes excluir-cliente (tira o cliente da coleta) e depois o expurgo.');
    if (confirmar) process.exit(1);
  }

  if (!confirmar) {
    console.log('\nSimulação. EXPURGO apaga de vez e não tem volta: use só por obrigação legal de eliminação (docs/lgpd/atendimento-ao-titular.md).');
    console.log('Rode de novo com --confirmar para expurgar no BigQuery, no bucket e depois no Postgres.');
    return;
  }

  await executarEtapas(etapas, {
    dimensoes_obrigatoria: () => sincronizarDimensoes({ obrigatoria: true }),
    bigquery: () => {
      if (fontes.length > 0) {
        const versoes = versoesDoClienteEmDimFonte(clientId);
        if (!(versoes > 0)) {
          falhar(`dim_fonte_scd2 não tem versões do cliente ${clientId}, que tem ${fontes.length} fonte(s) no Postgres. Expurgo abortado antes de apagar qualquer coisa: confira a sincronização de dimensões.`);
        }
      }
      const plano = planoDoExpurgo({ manifesto: FATOS_POR_FONTE, tabelasComCliente: tabelas, fontes, destino: DESTINO });
      rodarPassos(plano, clientId, 'O Postgres ainda não foi tocado. Rode o mesmo comando de novo: cada passo é idempotente.');
    },
    armazenamento: () =>
      purgarArmazenamento(organizationId, clientId, 'tudo', {
        obrigatoria: true,
        contexto: 'O Postgres ainda não foi tocado. Rode o mesmo comando de novo: cada passo é idempotente.',
      }),
    postgres: () => console.log(consultar(`SELECT jsonb_pretty(core.expurgar_cliente(${id}::uuid));`)),
    bigquery_por_client_id: () =>
      rodarPassos(
        passosPorClientId(tabelas, DESTINO),
        clientId,
        'O Postgres já foi expurgado. Rode o mesmo comando de novo: ele só repete o bucket e a limpeza por client_id.',
      ),
    dimensoes: () => sincronizarDimensoes(),
  });
  console.log('Cliente expurgado. Os backups expiram em até 30 dias, o time travel do BigQuery em até 7 e a exclusão reversível do bucket em 7 (docs/lgpd/retencao.md).');
}

async function executarEtapas(etapas, executores) {
  for (const etapa of etapas) {
    const executor = executores[etapa];
    if (!executor) falhar(`etapa sem executor: ${etapa}`);
    await executor();
  }
}

function executarNoBigQuerySemParametro(passo) {
  console.log(`BigQuery: ${passo.nome}`);
  execFileSync('bq', ['--project_id', PROJETO, 'query', '--use_legacy_sql=false', passo.sql], { stdio: 'inherit' });
}

async function expurgarFonte(organizationId, platform, externalId) {
  if (!externalId || externalId.startsWith('--')) falhar(`external_id ausente.\n\n${USO}`);
  const [fonte] = validarFontes([{ organizationId, platform: exigirPlataforma(platform), externalId }]);
  const passos = planoDoExpurgoDaFonte({ manifesto: FATOS_POR_FONTE, fonte, destino: DESTINO });
  console.log(`Fonte ${fonte.platform} ${fonte.externalId} da organização ${fonte.organizationId}. Passos no BigQuery:`);
  for (const passo of passos) console.log(`  - ${passo.nome}`);
  if (!confirmar) {
    console.log('\nSimulação. Rode de novo com --confirmar para apagar de vez esses dados no BigQuery (todos os clientes da organização).');
    return;
  }
  if (local) {
    console.log('--local: o BigQuery não é tocado. Nada a fazer.');
    return;
  }
  const resultado = executarPassos(passos, executarNoBigQuerySemParametro);
  if (!resultado.ok) {
    falhar(`FALHOU no BigQuery em ${resultado.falhou} (${resultado.erro?.message ?? 'erro'}). Pendentes: ${resultado.pendentes.join(', ')}. Rode o mesmo comando de novo: cada passo é idempotente.`);
  }
  await sincronizarDimensoes();
  console.log('Fonte expurgada do BigQuery.');
}

function listarPedidosDeExclusao() {
  return consultar(`
    SELECT jsonb_pretty(coalesce(jsonb_agg(jsonb_build_object(
      'codigo', p.codigo_de_confirmacao, 'situacao', p.status, 'recebidoEm', p.criado_em, 'concluidoEm', p.concluido_em,
      'conexoes', (SELECT coalesce(jsonb_agg(jsonb_build_object('organizacao', o.name, 'connectionId', c.id,
                     'plataforma', c.platform, 'estado', c.status)), '[]')
                   FROM privacidade.pedidos_de_exclusao_conexoes l
                   JOIN integrations.connections c ON c.id = l.connection_id
                   JOIN core.organizations o ON o.id = l.organization_id
                   WHERE l.pedido_id = p.id)) ORDER BY p.criado_em), '[]'))
    FROM privacidade.pedidos_de_exclusao p
    WHERE p.status <> 'concluido' OR p.concluido_em > now() - interval '30 days';`);
}

function atenderPedidoDeExclusao(acao, codigo) {
  const situacao = acao === 'concluir' ? 'concluido' : 'em_andamento';
  const indiceDaEvidencia = resto.indexOf('--evidencia');
  const evidencia = indiceDaEvidencia >= 0 ? resto[indiceDaEvidencia + 1] ?? '' : '';
  if (situacao === 'concluido' && (!evidencia || evidencia.startsWith('--') || evidencia.length > 2000)) {
    falhar(`concluir exige --evidencia <o que foi feito: conexões removidas, expurgos>.\n\n${USO}`);
  }
  console.log(listarPedidosDeExclusao());
  if (!confirmar) {
    console.log(`\nSimulação. Rode de novo com --confirmar para marcar ${codigo} como ${situacao}.`);
    return;
  }
  console.log(consultar(`SELECT jsonb_pretty(privacidade.atualizar_pedido_de_exclusao(${literal(codigo)}, ${literal(situacao)}, ${literal(evidencia || ' ')}, ${literal(exigirPor(por))}));`));
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
  case 'expurgar-fonte':
    await expurgarFonte(exigirUuid(alvo), resto[0], resto[1]);
    break;
  case 'pedidos-de-exclusao':
    if (alvo === 'listar') console.log(listarPedidosDeExclusao());
    else if (alvo === 'andamento' || alvo === 'concluir') atenderPedidoDeExclusao(alvo, exigirCodigo(resto[0]));
    else falhar(USO);
    break;
  default:
    falhar(USO);
}
