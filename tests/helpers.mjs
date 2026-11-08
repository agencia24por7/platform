import { readFileSync } from 'node:fs';

export const BASE = 'http://localhost:3000';

export function env() {
  return Object.fromEntries(
    readFileSync('.env', 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

export function workerHeaders() {
  return { Authorization: `Bearer ${env().TRIA_WORKER_TOKEN}`, 'Content-Type': 'application/json' };
}

export async function appIsUp() {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

function actionId(html) {
  const match = html.match(/name="\$ACTION_ID_([a-f0-9]+)"/);
  if (!match) throw new Error('A página não renderizou nenhuma server action.');
  return match[1];
}

export async function submitForm(path, fields) {
  const html = await fetch(`${BASE}${path}`).then((response) => response.text());
  const id = actionId(html);

  const body = new FormData();
  body.set(`$ACTION_ID_${id}`, '');
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => body.append(key, item));
    else body.set(key, value);
  }

  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Origin: BASE, Referer: `${BASE}${path}` },
    body,
    redirect: 'manual',
  });

  const text = await response.text();
  return {
    status: response.status,
    location: response.headers.get('location'),
    redirectedTo: text.match(/"(\/[a-z0-9/-]*(?:[a-f0-9-]{36})?)"/)?.[1] ?? null,
    text,
  };
}

export const post = (path, body) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: workerHeaders(), body: JSON.stringify(body) });

export const get = (path) => fetch(`${BASE}${path}`, { headers: workerHeaders() });
