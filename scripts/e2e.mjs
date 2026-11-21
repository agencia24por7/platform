import { readFileSync } from 'node:fs';

const base = 'http://localhost:3000';

function actionId(html) {
  const match = html.match(/name="\$ACTION_ID_([a-f0-9]+)"/);
  if (!match) throw new Error('Formulário sem action id — a página não renderizou a server action.');
  return match[1];
}

async function submit(path, fields) {
  const page = await fetch(`${base}${path}`);
  const html = await page.text();
  const id = actionId(html);

  const body = new FormData();
  body.set(`$ACTION_ID_${id}`, '');
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => body.append(key, item));
    else body.set(key, value);
  }

  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Origin: base, Referer: `${base}${path}` },
    body,
    redirect: 'manual',
  });

  const text = await response.text();
  const location =
    response.headers.get('location') ??
    response.headers.get('x-action-redirect') ??
    text.match(/"(\/clientes\/[a-f0-9-]{36})"/)?.[1] ??
    null;
  return { status: response.status, location, text };
}

console.log('1. criando organização');
const org = await submit('/organizacoes/nova', {
  name: 'Operação Piloto',
  type: 'agency',
  managerAccountId: '812-445-9031',
  businessManagerId: '1094887233',
  developerTokenRef: 'n8n:credential:google-ads-developer-token',
});
console.log('   ->', org.status, org.location ?? '');

console.log('2. criando cliente');
const client = await submit('/clientes/novo', {
  name: 'Cliente Piloto',
  segment: 'Serviços locais',
  businessModel: 'leads',
  parentClientId: '',
});
const clientId = client.location?.split('/').pop() ?? '';
console.log('   ->', client.status, clientId);

console.log('3. conectando conta');
const account = await submit(`/clientes/${clientId}/contas/nova`, {
  clientId,
  platform: 'meta',
  connectionId: 'new',
  connectionLabel: 'Business Manager da organização',
  grantType: 'system_user',
  connectionExternalId: '1094887233',
  scopes: ['ads_read', 'ads_management'],
  externalId: 'act_1234567890',
  name: 'Meta — Cliente Piloto | Principal',
  accountGroup: 'Principal',
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  syncEnabled: 'on',
});
console.log('   ->', account.status, account.location ?? '');

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const queue = await fetch(`${base}/api/v0/sync/queue`, {
  headers: { Authorization: `Bearer ${env.TRIA_WORKER_TOKEN}` },
}).then((r) => r.json());

console.log('4. fila de coleta:', queue.count, 'conta(s)');
if (queue.count > 0) {
  const entry = queue.accounts[0];
  console.log('   conta:', entry.accountName, '| janela', entry.window.start, '→', entry.window.end);
  console.log('   credencial exposta?', Object.keys(entry).some((k) => k !== 'temToken' && /token|secret|password/i.test(k)) ? 'SIM' : 'não — o segredo fica no cofre de tokens');
}
