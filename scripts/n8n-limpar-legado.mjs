import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { criarClienteN8n } from '../src/shared/n8n/clienteN8n.ts';
import { PASTA_DOS_WORKFLOWS, ehDaPlataforma } from '../src/shared/n8n/modelos.ts';
import { executarLimpeza } from '../src/shared/n8n/limpezaDoLegado.ts';

const USO = `uso: node --experimental-strip-types scripts/n8n-limpar-legado.mjs [--aplicar] [--local] [--log <arquivo.json>]

Remove do n8n o legado por conexão do modelo anterior ao cofre de tokens (ADR 0032):
- todo workflow coletor/executor por conexão cujo id foi salvo em integrations.corte_para_cofre_refs;
- toda credencial n8n:credential:{id} salva ali, só quando nenhum workflow restante a usa;
- rede de segurança: workflows "Coletor · ORLA · coletor · …", "Executor · ORLA · tarefas · …" e
  "ORLA · revogação · <uuid>" que tenham a tag platform.
Nunca toca workflow com tag credaz/agencia, os genéricos da plataforma (nome exato do repositório),
nem credencial compartilhada (ORLA · worker token). Sem identificação da plataforma: ignora e relata.

Sem --aplicar é simulação (dry-run). Idempotente: o que já sumiu conta como ausente.
Com --aplicar, marca limpo_em nas conexões cuja limpeza terminou sem pendência.
Banco: VM de produção por IAP (gcloud) por padrão; --local usa o Postgres do docker local.
n8n: N8N_API_URL e N8N_API_KEY no ambiente (em produção, pelo túnel IAP; ver docs/adr/0009).`;

const argumentos = process.argv.slice(2);
if (argumentos.some((a) => ['--help', '-h', '--ajuda'].includes(a))) {
  console.log(USO);
  process.exit(0);
}
const indiceDoLog = argumentos.indexOf('--log');
const arquivoDoLog = indiceDoLog >= 0 ? argumentos[indiceDoLog + 1] : `n8n-limpeza-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const conhecidos = new Set(['--aplicar', '--local', '--log']);
const desconhecido = argumentos.find((a, i) => !conhecidos.has(a) && !(i === indiceDoLog + 1 && indiceDoLog >= 0));
if (desconhecido || (indiceDoLog >= 0 && !arquivoDoLog)) {
  console.error(`${desconhecido ? `opção desconhecida: ${desconhecido}` : '--log exige um arquivo'}\n\n${USO}`);
  process.exit(2);
}
const aplicar = argumentos.includes('--aplicar');
const local = argumentos.includes('--local');

const { N8N_API_URL, N8N_API_KEY } = process.env;
if (!N8N_API_URL || !N8N_API_KEY) {
  console.error('Defina N8N_API_URL e N8N_API_KEY no ambiente (em produção, pelo túnel IAP; ver docs/adr/0009).');
  process.exit(1);
}

const VM = process.env.VM ?? 'tria-producao-vm';
const ZONE = process.env.ZONE ?? 'us-central1-a';
const PSQL = ['docker', 'exec', '-i', 'orla-postgres', 'psql', '-U', 'postgres', '-d', 'tria', '-tA', '-v', 'ON_ERROR_STOP=1'];

function consultar(sqlTexto) {
  const [programa, ...args] = local
    ? PSQL
    : ['gcloud', 'compute', 'ssh', VM, '--zone', ZONE, '--tunnel-through-iap', '--command', `sudo ${PSQL.join(' ')}`];
  return execFileSync(programa, args, { input: sqlTexto, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] }).trim();
}

function lerRefs() {
  const json = consultar(`
    SELECT coalesce(json_agg(json_build_object(
      'connectionId', connection_id, 'platform', platform, 'credentialRef', credential_ref,
      'coletorRef', coletor_ref, 'executorRef', executor_ref) ORDER BY connection_id), '[]')
    FROM integrations.corte_para_cofre_refs
    WHERE limpo_em IS NULL;`);
  return JSON.parse(json || '[]');
}

function marcarLimpas(ids) {
  const validos = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (validos.length === 0) return;
  consultar(`UPDATE integrations.corte_para_cofre_refs SET limpo_em = now()
    WHERE limpo_em IS NULL AND connection_id IN (${validos.map((id) => `'${id}'`).join(', ')});`);
}

function nomesDosGenericos(pasta) {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) return ehDaPlataforma(`${caminho}/`) ? nomesDosGenericos(caminho) : [];
    return entrada.name.endsWith('.json') ? [JSON.parse(readFileSync(caminho, 'utf8')).name] : [];
  });
}

const silencioso = { info() {}, warn: (m, d) => console.warn(m, d), error: (m, d) => console.error(m, d) };

async function main() {
  const n8n = criarClienteN8n({ url: N8N_API_URL, apiKey: N8N_API_KEY }, silencioso);
  const refs = lerRefs();
  const relatorio = await executarLimpeza(refs, n8n, new Set(nomesDosGenericos(PASTA_DOS_WORKFLOWS)), aplicar);
  if (aplicar) marcarLimpas(relatorio.conexoesLimpas);

  writeFileSync(arquivoDoLog, `${JSON.stringify({ em: new Date().toISOString(), conexoesNoCorte: refs.length, ...relatorio }, null, 2)}\n`);

  const linha = (rotulo, itens) => itens.forEach((item) => console.log(`${rotulo.padEnd(12)} ${item.tipo.padEnd(10)} ${item.id} ${item.nome ?? ''}${item.motivo ? ` — ${item.motivo}${item.detalhe ? ` (${item.detalhe})` : ''}` : ''}`));
  linha(aplicar ? 'removido' : 'removeria', aplicar ? relatorio.removidos : relatorio.planejados);
  linha('ausente', relatorio.jaAusentes);
  linha('ignorado', relatorio.ignorados);
  linha('falhou', relatorio.falhas);
  console.log(`\n${aplicar ? 'Aplicado' : 'Simulação (use --aplicar para remover)'}:`, relatorio.contagem, `· conexões limpas: ${relatorio.conexoesLimpas.length}/${refs.length}`);
  console.log(`Log: ${arquivoDoLog}`);
  if (relatorio.falhas.length > 0) process.exitCode = 1;
}

main().catch((erro) => {
  console.error(erro.message);
  process.exit(1);
});
