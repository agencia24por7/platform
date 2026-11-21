const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ROTA_DO_EXPURGO_DO_ARMAZENAMENTO = '/api/v0/manutencao/expurgar-armazenamento';
export const MODOS_DO_ARMAZENAMENTO = ['tudo', 'derivados'];

export function etapasDoExpurgo({ existe, local, somenteArmazenamento = false }) {
  if (somenteArmazenamento) return ['armazenamento'];
  if (!existe) return local ? ['armazenamento', 'dimensoes'] : ['armazenamento', 'bigquery_por_client_id', 'dimensoes'];
  if (local) return ['armazenamento', 'postgres', 'dimensoes'];
  return ['dimensoes_obrigatoria', 'bigquery', 'armazenamento', 'postgres', 'bigquery_por_client_id', 'dimensoes'];
}

export async function expurgarArmazenamento({ base, token, organizationId, clientId, modo, local, buscar = fetch }) {
  if (!UUID.test(organizationId ?? '') || !UUID.test(clientId ?? '')) {
    return { ok: false, erro: 'organização ou cliente sem UUID válido; leia o estado do cliente antes' };
  }
  if (!MODOS_DO_ARMAZENAMENTO.includes(modo)) return { ok: false, erro: `modo inválido: ${modo}` };
  if (!token) return { ok: false, erro: 'token do worker ausente' };

  let resposta;
  try {
    resposta = await buscar(`${base}${ROTA_DO_EXPURGO_DO_ARMAZENAMENTO}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId, clientId, modo }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (erro) {
    return { ok: false, erro: `sem resposta da rota (${erro?.message ?? 'erro'})` };
  }
  const texto = await resposta.text();
  if (!resposta.ok) return { ok: false, erro: `HTTP ${resposta.status}: ${texto.slice(0, 500)}` };

  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return { ok: false, erro: `resposta não é JSON: ${texto.slice(0, 200)}` };
  }
  const resumo = corpo?.data ?? corpo;
  if (resumo?.desativado && !local) {
    return { ok: false, erro: 'o app respondeu que o bucket está desativado (CONTEXT_BUCKET ausente): nada foi apagado do bucket' };
  }
  return { ok: true, apagados: Number(resumo?.apagados ?? 0), alvo: resumo?.alvo ?? null, desativado: Boolean(resumo?.desativado) };
}
