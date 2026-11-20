import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TAG_DA_PLATAFORMA, criarClienteN8n } from '../src/shared/n8n/clienteN8n.ts';
import { MODELO_DE_COLETOR, MODELO_DE_EXECUTOR, PASTA_DOS_WORKFLOWS, ehDaPlataforma, ehModelo } from '../src/shared/n8n/modelos.ts';
import { localizarImplantado, mesclar, versaoDoModelo, versaoImplantada } from '../src/shared/n8n/sincronizacao.ts';

const argumentos = process.argv.slice(2);
const aplicar = argumentos.includes('--aplicar');
const indiceDasConexoes = argumentos.indexOf('--conexoes');
const arquivoDeConexoes = indiceDasConexoes >= 0 ? argumentos[indiceDasConexoes + 1] : null;

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
    return entrada.name.endsWith('.json') && !ehModelo(caminho) ? [caminho] : [];
  });
}

function alvosDasConexoes() {
  if (!arquivoDeConexoes) return [];

  return lerJson(arquivoDeConexoes).flatMap((conexao) => [
    conexao.coletorRef && MODELO_DE_COLETOR[conexao.platform] ? { arquivo: MODELO_DE_COLETOR[conexao.platform], id: conexao.coletorRef } : null,
    conexao.executorRef && MODELO_DE_EXECUTOR[conexao.platform] ? { arquivo: MODELO_DE_EXECUTOR[conexao.platform], id: conexao.executorRef } : null,
  ]).filter(Boolean);
}

const temTagDaPlataforma = (implantado) => (implantado.tags ?? []).some((tag) => tag.name === TAG_DA_PLATAFORMA);

async function sincronizar(arquivo, implantado) {
  const modelo = lerJson(arquivo);
  if (versaoImplantada(implantado) === versaoDoModelo(modelo)) {
    if (temTagDaPlataforma(implantado)) return { acao: 'igual' };
    if (!aplicar) return { acao: 'marcaria', detalhe: `sem a tag ${TAG_DA_PLATAFORMA}` };
    return (await n8n.marcarDaPlataforma(implantado.id)) ? { acao: 'marcado' } : { acao: 'falhou', detalhe: 'tag não aplicada' };
  }

  const { corpo, pendencias } = mesclar(modelo, implantado, implantado.name, arquivo);
  if (pendencias.length > 0) return { acao: 'bloqueado', detalhe: pendencias.join('; ') };
  if (!aplicar) return { acao: 'atualizaria' };

  if (!(await n8n.atualizar(implantado.id, corpo))) return { acao: 'falhou', detalhe: 'atualização recusada' };
  const deveFicarPublicado = implantado.active || ehModelo(arquivo);
  if (deveFicarPublicado && !(await n8n.publicar(implantado.id))) return { acao: 'falhou', detalhe: 'atualizado, mas não publicado' };
  if (!temTagDaPlataforma(implantado) && !(await n8n.marcarDaPlataforma(implantado.id))) {
    return { acao: 'falhou', detalhe: 'atualizado, mas sem a tag' };
  }
  return { acao: 'atualizado' };
}

async function main() {
  const implantados = await n8n.listar();
  const porId = new Map(implantados.map((w) => [w.id, w]));
  const resultados = [];

  for (const arquivo of arquivosDaPlataforma(PASTA_DOS_WORKFLOWS)) {
    const nome = lerJson(arquivo).name;
    const achado = localizarImplantado(arquivo, nome, implantados);
    if (!achado) {
      resultados.push({ arquivo, alvo: nome, acao: 'não implantado', detalhe: 'a primeira implantação é manual (ver docs/adr/0009)' });
      continue;
    }
    const alvo = `${achado.workflow.name} (${achado.workflow.id})${achado.por === 'nome' ? ' [adotado pelo nome]' : ''}`;
    resultados.push({ arquivo, alvo, ...(await sincronizar(arquivo, achado.workflow)) });
  }

  for (const { arquivo, id } of alvosDasConexoes()) {
    const implantado = porId.get(id);
    if (!implantado) {
      resultados.push({ arquivo, alvo: id, acao: 'ausente', detalhe: 'a conexão aponta para um workflow que não existe' });
      continue;
    }
    resultados.push({ arquivo, alvo: `${implantado.name} (${id})`, ...(await sincronizar(arquivo, implantado)) });
  }

  for (const r of resultados) console.log(`${r.acao.padEnd(15)} ${r.alvo}${r.detalhe ? ` — ${r.detalhe}` : ''}`);

  const contagem = resultados.reduce((acc, r) => ({ ...acc, [r.acao]: (acc[r.acao] ?? 0) + 1 }), {});
  console.log(`\n${aplicar ? 'Aplicado' : 'Simulação (use --aplicar para gravar)'}:`, contagem);
  if (!arquivoDeConexoes) console.log('Coletores e executores por conexão não verificados: passe --conexoes <arquivo.json>.');

  if (resultados.some((r) => ['falhou', 'ausente', 'bloqueado'].includes(r.acao))) process.exitCode = 1;
}

main().catch((erro) => {
  console.error(erro.message);
  process.exit(1);
});
