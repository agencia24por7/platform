import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TAG_DA_PLATAFORMA, criarClienteN8n } from '../src/shared/n8n/clienteN8n.ts';
import { PASTA_DOS_WORKFLOWS, ehDaPlataforma, ehSubWorkflowGenerico, ordemDeImplantacao } from '../src/shared/n8n/modelos.ts';
import { ehNomeDoLegadoPorConexao } from '../src/shared/n8n/limpezaDoLegado.ts';
import {
  avaliarAlvo,
  credenciaisPorNome,
  localizarImplantado,
  mesclar,
  modeloComCredenciaisPorNome,
  resolverFluxoDeErro,
  resolverSubWorkflows,
  versaoDoModelo,
  versaoImplantada,
} from '../src/shared/n8n/sincronizacao.ts';

const USO = `uso: npm run n8n:sincronizar -- [--aplicar] [--criar] [--adotar]

Publica no n8n só os workflows da plataforma versionados em n8n/workflows (fora de clientes/ e agencia/):
orquestrador, backfill, tarefas de conta, jobs da plataforma e os coletores/executores genéricos
"ORLA · {Plataforma} · coletor|executor" (ADR 0032). Não existe mais cópia por conexão.

  --aplicar  grava (sem ele, só simula)
  --criar    cria o que ainda não está implantado (credenciais ligadas pelo nome, como "ORLA · worker token")
  --adotar   assume workflow sem nota de origem nem tag platform que tenha o mesmo nome

Nunca altera workflow com tag credaz/agencia. Ordem: alertas, genéricos, backfill · janela, demais
(os ids dos sub-workflows e do fluxo de erro são resolvidos pela nota de origem já implantada).
Workflows antigos por conexão ("Coletor · ORLA · coletor · …") são ignorados: remova com scripts/n8n-limpar-legado.mjs.`;

const argumentos = process.argv.slice(2);
if (argumentos.some((a) => ['--help', '-h', '--ajuda'].includes(a))) {
  console.log(USO);
  process.exit(0);
}
const conhecidos = new Set(['--aplicar', '--adotar', '--criar']);
const desconhecido = argumentos.find((a) => !conhecidos.has(a));
if (desconhecido) {
  console.error(`opção desconhecida: ${desconhecido}${desconhecido === '--conexoes' ? ' (não há mais workflow por conexão; ADR 0032)' : ''}\n\n${USO}`);
  process.exit(2);
}
const aplicar = argumentos.includes('--aplicar');
const adotar = argumentos.includes('--adotar');
const criarAusentes = argumentos.includes('--criar');

const { N8N_API_URL, N8N_API_KEY } = process.env;
if (!N8N_API_URL || !N8N_API_KEY) {
  console.error('Defina N8N_API_URL e N8N_API_KEY no ambiente (em produção, pelo túnel IAP; ver docs/adr/0009).');
  process.exit(1);
}

const silencioso = { info() {}, warn: (m, d) => console.warn(m, d), error: (m, d) => console.error(m, d) };
const n8n = criarClienteN8n({ url: N8N_API_URL, apiKey: N8N_API_KEY }, silencioso);

const lerJson = (caminho) => JSON.parse(readFileSync(caminho, 'utf8'));

function arquivosDaPlataforma(pasta) {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(pasta, entrada.name);
    if (entrada.isDirectory()) return ehDaPlataforma(`${caminho}/`) ? arquivosDaPlataforma(caminho) : [];
    return entrada.name.endsWith('.json') ? [caminho] : [];
  });
}

const temTagDaPlataforma = (implantado) => (implantado.tags ?? []).some((tag) => tag.name === TAG_DA_PLATAFORMA);

async function listarDaPlataforma() {
  const todos = await n8n.listar();
  return todos.filter((workflow) => !ehNomeDoLegadoPorConexao(workflow.name));
}

function modeloResolvido(arquivo, implantados) {
  const { modelo: comFluxo, aviso } = resolverFluxoDeErro(lerJson(arquivo), implantados);
  const { modelo, pendencias } = resolverSubWorkflows(comFluxo, implantados);
  return { modelo, aviso, pendencias };
}

async function sincronizar(arquivo, implantado, implantados) {
  const avaliacao = avaliarAlvo(implantado, { adotar, tagDaPlataforma: TAG_DA_PLATAFORMA });
  if (!avaliacao.permitido) return { acao: 'bloqueado', detalhe: avaliacao.motivo };

  const { modelo, aviso, pendencias: semSubWorkflow } = modeloResolvido(arquivo, implantados);
  if (aviso) console.warn(`aviso: ${implantado.name}: ${aviso}`);
  if (semSubWorkflow.length > 0) return { acao: 'bloqueado', detalhe: semSubWorkflow.join('; ') };
  if (versaoImplantada(implantado) === versaoDoModelo(modelo)) {
    if (temTagDaPlataforma(implantado)) return { acao: 'igual' };
    if (!aplicar) return { acao: 'marcaria', detalhe: `sem a tag ${TAG_DA_PLATAFORMA}` };
    return (await n8n.marcarDaPlataforma(implantado.id)) ? { acao: 'marcado' } : { acao: 'falhou', detalhe: 'tag não aplicada' };
  }

  const { corpo, pendencias } = mesclar(modelo, implantado, implantado.name, arquivo);
  if (pendencias.length > 0) return { acao: 'bloqueado', detalhe: pendencias.join('; ') };
  if (!aplicar) return { acao: 'atualizaria' };

  if (!(await n8n.atualizar(implantado.id, corpo))) return { acao: 'falhou', detalhe: 'atualização recusada' };
  const deveFicarPublicado = implantado.active || ehSubWorkflowGenerico(arquivo);
  if (deveFicarPublicado && !(await n8n.publicar(implantado.id))) return { acao: 'falhou', detalhe: 'atualizado, mas não publicado' };
  if (!temTagDaPlataforma(implantado) && !(await n8n.marcarDaPlataforma(implantado.id))) {
    return { acao: 'falhou', detalhe: 'atualizado, mas sem a tag' };
  }
  return { acao: 'atualizado' };
}

async function criar(arquivo, implantados) {
  const { modelo, aviso, pendencias: semSubWorkflow } = modeloResolvido(arquivo, implantados);
  if (aviso) console.warn(`aviso: ${modelo.name}: ${aviso}`);
  if (semSubWorkflow.length > 0) return { acao: 'bloqueado', detalhe: `${semSubWorkflow.join('; ')} (rode de novo depois de criar os genéricos)` };
  const ligado = modeloComCredenciaisPorNome(modelo, credenciaisPorNome(implantados));
  const { corpo, pendencias } = mesclar(ligado, null, modelo.name, arquivo);
  if (pendencias.length > 0) return { acao: 'bloqueado', detalhe: `${pendencias.join('; ')} (crie a credencial no n8n ou implante à mão)` };
  if (!aplicar) return { acao: 'criaria' };
  const id = await n8n.criar(corpo, { arquivo });
  return id ? { acao: 'criado', detalhe: id } : { acao: 'falhou', detalhe: 'criação recusada' };
}

async function main() {
  const legados = (await n8n.listar()).filter((workflow) => ehNomeDoLegadoPorConexao(workflow.name));
  let implantados = await listarDaPlataforma();
  const resultados = [];

  const arquivos = arquivosDaPlataforma(PASTA_DOS_WORKFLOWS).sort((a, b) => ordemDeImplantacao(a) - ordemDeImplantacao(b) || a.localeCompare(b));
  for (const arquivo of arquivos) {
    const nome = lerJson(arquivo).name;
    const achado = localizarImplantado(arquivo, nome, implantados);
    if (!achado) {
      const resultado = criarAusentes
        ? { arquivo, alvo: nome, ...(await criar(arquivo, implantados)) }
        : { arquivo, alvo: nome, acao: 'não implantado', detalhe: 'use --criar (credenciais ligadas pelo nome) ou implante à mão (docs/adr/0009)' };
      resultados.push(resultado);
      if (resultado.acao === 'criado') implantados = await listarDaPlataforma();
      continue;
    }
    const alvo = `${achado.workflow.name} (${achado.workflow.id})${achado.por === 'nome' ? ' [adotado pelo nome]' : ''}`;
    const resultado = { arquivo, alvo, ...(await sincronizar(arquivo, achado.workflow, implantados)) };
    resultados.push(resultado);
    if (resultado.acao === 'atualizado' || resultado.acao === 'marcado') implantados = await listarDaPlataforma();
  }

  for (const r of resultados) console.log(`${r.acao.padEnd(15)} ${r.alvo}${r.detalhe ? ` — ${r.detalhe}` : ''}`);

  const contagem = resultados.reduce((acc, r) => ({ ...acc, [r.acao]: (acc[r.acao] ?? 0) + 1 }), {});
  console.log(`\n${aplicar ? 'Aplicado' : 'Simulação (use --aplicar para gravar)'}:`, contagem);
  if (legados.length > 0) {
    console.log(`${legados.length} workflow(s) por conexão do modelo antigo ignorado(s): rode scripts/n8n-limpar-legado.mjs (ADR 0032).`);
  }

  if (resultados.some((r) => ['falhou', 'bloqueado'].includes(r.acao))) process.exitCode = 1;
}

main().catch((erro) => {
  console.error(erro.message);
  process.exit(1);
});
