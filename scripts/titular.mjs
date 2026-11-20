import { execFileSync } from 'node:child_process';

const USO = `uso:
  node scripts/titular.mjs exportar <email>
  node scripts/titular.mjs anonimizar <email> [--confirmar]
  node scripts/titular.mjs excluir-cliente <client_id> [--confirmar]

Opções: --local (banco do docker local em vez da VM de produção).
Sem --confirmar, anonimizar e excluir-cliente só mostram o que seria afetado.
Veja docs/lgpd/atendimento-ao-titular.md.`;

const VM = process.env.VM ?? 'tria-producao-vm';
const ZONE = process.env.ZONE ?? 'us-central1-a';
const PROJETO = process.env.PROJETO ?? 'tria-platform';
const DATASET = process.env.DATASET ?? 'tria_dw';
const PSQL = ['docker', 'exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-tA', '-v', 'ON_ERROR_STOP=1'];

const [comando, alvo, ...resto] = process.argv.slice(2);
const confirmar = resto.includes('--confirmar');
const local = resto.includes('--local') || process.argv.includes('--local');

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
  console.log(consultar(`SELECT jsonb_pretty(core.anonimizar_titular(${literal(email)}));`));
}

function tabelasComCliente() {
  const saida = execFileSync('bq', [
    '--project_id', PROJETO, 'query', '--use_legacy_sql=false', '--format=csv',
    `SELECT table_name FROM \`${PROJETO}.${DATASET}.INFORMATION_SCHEMA.COLUMNS\` WHERE column_name = 'client_id'`,
  ], { encoding: 'utf8' });
  return saida.split('\n').slice(1).map((linha) => linha.trim()).filter(Boolean);
}

function excluirCliente(clientId) {
  const id = literal(clientId);
  const resumo = consultar(`
    SELECT jsonb_pretty(jsonb_build_object(
      'cliente', (SELECT name FROM core.clients WHERE id = ${id}::uuid),
      'contas', (SELECT count(*) FROM integrations.ad_accounts WHERE client_id = ${id}::uuid),
      'metricas', (SELECT count(*) FROM metrics.metrics_daily d JOIN integrations.ad_accounts a ON a.id = d.ad_account_id
                   WHERE a.client_id = ${id}::uuid)
    ));`);
  console.log(resumo);
  const tabelas = local ? [] : tabelasComCliente();
  if (!local) console.log(`BigQuery: ${tabelas.length} tabela(s) com client_id em ${DATASET}: ${tabelas.join(', ')}`);

  if (!confirmar) {
    console.log('\nSimulação. Rode de novo com --confirmar para excluir no Postgres e no BigQuery.');
    return;
  }

  console.log(consultar(`SELECT jsonb_pretty(core.excluir_cliente(${id}::uuid));`));
  for (const tabela of tabelas) {
    execFileSync('bq', [
      '--project_id', PROJETO, 'query', '--use_legacy_sql=false', `--parameter=id:STRING:${clientId}`,
      `DELETE FROM \`${PROJETO}.${DATASET}.${tabela}\` WHERE CAST(client_id AS STRING) = @id`,
    ], { stdio: 'inherit' });
  }
  console.log('Cliente excluído. Os backups expiram em até 30 dias (docs/lgpd/retencao.md).');
}

switch (comando) {
  case 'exportar':
    console.log(exportar(exigirEmail(alvo)));
    break;
  case 'anonimizar':
    anonimizar(exigirEmail(alvo));
    break;
  case 'excluir-cliente':
    excluirCliente(exigirUuid(alvo));
    break;
  default:
    falhar(USO);
}
