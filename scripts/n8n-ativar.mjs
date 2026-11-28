import { TAG_DA_PLATAFORMA, criarClienteN8n } from '../src/shared/n8n/clienteN8n.ts';
import { avaliarAlvo } from '../src/shared/n8n/sincronizacao.ts';

const USO = `uso: node --experimental-strip-types scripts/n8n-ativar.mjs <id do workflow> [--aplicar]

Ativa um workflow da plataforma no n8n. Recusa, sem mostrar nome nem conteúdo, o que tiver a tag credaz ou
agencia (ADR 0053) ou não tiver a tag platform nem nota de origem. Sem --aplicar, só mostra o que faria.
Em produção, rode por scripts/n8n-sincronizar-producao.sh --ativar <id>.`;

const argumentos = process.argv.slice(2);
if (argumentos.some((a) => ['--help', '-h', '--ajuda'].includes(a))) {
  console.log(USO);
  process.exit(0);
}
const aplicar = argumentos.includes('--aplicar');
const posicionais = argumentos.filter((a) => a !== '--aplicar');
if (posicionais.length !== 1 || !/^[A-Za-z0-9]{8,32}$/.test(posicionais[0]) || posicionais.some((a) => a.startsWith('-'))) {
  console.error(`informe exatamente um id de workflow\n\n${USO}`);
  process.exit(2);
}
const [id] = posicionais;

const { N8N_API_URL, N8N_API_KEY } = process.env;
if (!N8N_API_URL || !N8N_API_KEY) {
  console.error('Defina N8N_API_URL e N8N_API_KEY no ambiente (em produção, por scripts/n8n-sincronizar-producao.sh).');
  process.exit(1);
}

const silencioso = { info() {}, warn: (m, d) => console.warn(m, d?.status ?? ''), error() {} };
const n8n = criarClienteN8n({ url: N8N_API_URL, apiKey: N8N_API_KEY }, silencioso);

let implantados;
try {
  implantados = await n8n.listar();
} catch (erro) {
  console.error(`não consegui listar os workflows do n8n: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`);
  process.exit(1);
}

const workflow = implantados.find((w) => w.id === id);
if (!workflow) {
  console.error(`workflow ${id} não encontrado`);
  process.exit(1);
}

const avaliacao = avaliarAlvo(workflow, { adotar: false, tagDaPlataforma: TAG_DA_PLATAFORMA });
if (!avaliacao.permitido) {
  console.error(`recusado: ${id}: ${avaliacao.motivo}`);
  process.exit(3);
}

const credenciais = [
  ...new Set(
    workflow.nodes.flatMap((no) => Object.values(no?.credentials ?? {}).map((credencial) => credencial?.name).filter(Boolean)),
  ),
];
console.log(`workflow: ${JSON.stringify({ id, nome: workflow.name, ativo: workflow.active, tags: (workflow.tags ?? []).map((t) => t.name), credenciais })}`);

if (!aplicar) {
  console.log(`simulação: ${workflow.active ? 'já está ativo' : `ativaria ${id}`} (use --aplicar)`);
  process.exit(0);
}
if (workflow.active) {
  console.log(`já está ativo: ${id}`);
  process.exit(0);
}
if (!(await n8n.publicar(id))) {
  console.error(`a ativação de ${id} falhou`);
  process.exit(1);
}
console.log(`ativado: ${id}`);
