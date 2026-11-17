import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const CONTAINER = 'orla-postgres';
const VAULT_PREFIX = 'n8n:credential:';

const CREDENTIAL_TYPE = {
  google: 'googleOAuth2Api',
  meta: 'facebookGraphApi',
  ga4: 'googleOAuth2Api',
  searchconsole: 'googleOAuth2Api',
  youtube: 'googleOAuth2Api',
  gbp: 'googleOAuth2Api',
  gtm: 'googleOAuth2Api',
};

const TEMPLATE_FILE_BY_PLATFORM = {
  google: 'n8n/workflows/coletores/coletor-google-ads.json',
  meta: 'n8n/workflows/coletores/coletor-meta-insights.json',
  ga4: 'n8n/workflows/coletores/coletor-ga4.json',
  searchconsole: 'n8n/workflows/coletores/coletor-searchconsole.json',
  youtube: 'n8n/workflows/coletores/coletor-youtube.json',
  gbp: 'n8n/workflows/coletores/coletor-gbp.json',
  gtm: 'n8n/workflows/coletores/coletor-gtm.json',
};

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

function query(sql) {
  return execFileSync('docker', ['exec', CONTAINER, 'psql', '-U', env.POSTGRES_SUPERUSER, '-d', env.POSTGRES_DB, '-t', '-A', '-c', sql])
    .toString()
    .trim();
}

function credentialIdOf(credentialRef) {
  if (!credentialRef.startsWith(VAULT_PREFIX)) return null;
  return credentialRef.slice(VAULT_PREFIX.length);
}

function montarWorkflow(template, tipoEsperado, credentialId, credentialNome) {
  const corpo = structuredClone(template);
  corpo.name = `Coletor · ${credentialNome}`;

  let encontrada = false;
  for (const node of corpo.nodes) {
    if (!node.credentials || !(tipoEsperado in node.credentials)) continue;
    node.credentials[tipoEsperado] = { id: credentialId, name: credentialNome };
    encontrada = true;
  }

  return encontrada ? corpo : null;
}

async function provisionar(connection) {
  const { platform, label, credential_ref: credentialRef } = connection;

  const templateFile = TEMPLATE_FILE_BY_PLATFORM[platform];
  if (!templateFile) return { ok: false, motivo: 'fora_do_v1' };

  const credentialId = credentialIdOf(credentialRef);
  if (!credentialId) return { ok: false, motivo: 'credential_ref_invalido' };

  const template = JSON.parse(readFileSync(templateFile, 'utf8'));
  const corpo = montarWorkflow(template, CREDENTIAL_TYPE[platform], credentialId, `ORLA · coletor · ${label}`);
  if (!corpo) return { ok: false, motivo: 'template_sem_credencial' };

  const response = await fetch(new URL('/api/v1/workflows', env.N8N_API_URL).toString(), {
    method: 'POST',
    headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) return { ok: false, motivo: `n8n_${response.status}` };

  const criado = await response.json();
  if (!criado.id) return { ok: false, motivo: 'n8n_sem_id' };

  return { ok: true, workflowId: criado.id };
}

async function main() {
  if (!env.N8N_API_URL || !env.N8N_API_KEY) {
    console.error('N8N_API_URL/N8N_API_KEY ausentes no .env — nada a fazer.');
    process.exit(1);
  }

  const linhas = query(`
    SELECT json_agg(row_to_json(c))
    FROM (
      SELECT id, organization_id, platform, label, credential_ref
      FROM integrations.connections
      WHERE coletor_ref IS NULL AND status = 'active'
      ORDER BY authorized_at
    ) c
  `);

  const conexoes = linhas && linhas !== '' ? JSON.parse(linhas) : null;
  if (!conexoes || conexoes.length === 0) {
    console.log('Nenhuma conexão ativa sem coletor_ref. Nada a fazer.');
    return;
  }

  console.log(`${conexoes.length} conexão(ões) sem coletor_ref.`);

  let provisionadas = 0;
  let puladas = 0;

  for (const conexao of conexoes) {
    process.stdout.write(`${conexao.platform} · ${conexao.label} (${conexao.id}) ... `);
    const resultado = await provisionar(conexao);

    if (!resultado.ok) {
      console.log(`pulada (${resultado.motivo})`);
      puladas += 1;
      continue;
    }

    if (!/^[A-Za-z0-9_-]+$/.test(resultado.workflowId) || !/^[0-9a-f-]{36}$/i.test(conexao.id)) {
      console.log('pulada (resposta inesperada do n8n ou id de conexão inválido)');
      puladas += 1;
      continue;
    }

    query(`UPDATE integrations.connections SET coletor_ref = '${resultado.workflowId}' WHERE id = '${conexao.id}'`);
    console.log(`ok (workflow ${resultado.workflowId})`);
    provisionadas += 1;
  }

  console.log(`\n${provisionadas} provisionada(s), ${puladas} pulada(s) de ${conexoes.length}.`);
}

main();
