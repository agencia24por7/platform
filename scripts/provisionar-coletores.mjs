import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { criarClienteN8n } from '../src/shared/n8n/clienteN8n.ts';
import { MODELO_DE_COLETOR } from '../src/shared/n8n/modelos.ts';

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
  rdstation: 'httpQueryAuth',
  pixel: 'facebookGraphApi',
  leadads: 'facebookGraphApi',
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

const silencioso = { info() {}, warn: (m, d) => console.warn(m, d), error: (m, d) => console.error(m, d) };
let clienteN8n = null;
const n8n = () => (clienteN8n ??= criarClienteN8n({ url: env.N8N_API_URL, apiKey: env.N8N_API_KEY }, silencioso));

async function provisionar(connection) {
  const { platform, label, credential_ref: credentialRef } = connection;

  const templateFile = MODELO_DE_COLETOR[platform];
  if (!templateFile) return { ok: false, motivo: 'fora_do_v1' };

  const credentialId = credentialIdOf(credentialRef);
  if (!credentialId) return { ok: false, motivo: 'credential_ref_invalido' };

  const template = JSON.parse(readFileSync(templateFile, 'utf8'));
  const corpo = montarWorkflow(template, CREDENTIAL_TYPE[platform], credentialId, `ORLA · coletor · ${label}`);
  if (!corpo) return { ok: false, motivo: 'template_sem_credencial' };

  const workflowId = await n8n().criar(corpo, { platform, conexaoId: connection.id });
  if (!workflowId) return { ok: false, motivo: 'n8n_recusou' };

  return { ok: true, workflowId };
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
