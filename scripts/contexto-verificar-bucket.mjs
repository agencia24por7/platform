import { randomUUID } from 'node:crypto';
import { Storage } from '@google-cloud/storage';

const nomeDoBucket = process.argv[2] ?? process.env.CONTEXT_BUCKET;
if (!nomeDoBucket) {
  console.error('Uso: node scripts/contexto-verificar-bucket.mjs <bucket>  (ou defina CONTEXT_BUCKET)');
  process.exit(2);
}

const bucket = new Storage().bucket(nomeDoBucket);
const resultados = [];

async function verificar(rotulo, passo) {
  try {
    const detalhe = await passo();
    resultados.push({ rotulo, ok: true, detalhe: detalhe ?? '' });
  } catch (erro) {
    resultados.push({ rotulo, ok: false, detalhe: erro?.message ?? String(erro) });
  }
}

await verificar('configuração do bucket (precisa de buckets.get; sem ele, só avisa)', async () => {
  const [meta] = await bucket.getMetadata();
  const esperado = {
    'acesso uniforme': meta.iamConfiguration?.uniformBucketLevelAccess?.enabled === true,
    'prevenção de acesso público': meta.iamConfiguration?.publicAccessPrevention === 'enforced',
    versionamento: meta.versioning?.enabled === true,
    'soft delete 7 dias': meta.softDeletePolicy?.retentionDurationSeconds === '604800',
    'sem CORS': !(meta.cors?.length > 0),
  };
  const falhas = Object.entries(esperado).filter(([, ok]) => !ok).map(([nome]) => nome);
  if (falhas.length > 0) throw new Error(`divergências: ${falhas.join(', ')}`);
  return `local ${meta.location}, ${Object.keys(esperado).join(', ')}`;
});

await verificar('listar orgs/ (somente leitura)', async () => {
  const [arquivos] = await bucket.getFiles({ prefix: 'orgs/', maxResults: 1, autoPaginate: false });
  return `${arquivos.length} objeto(s) na primeira página`;
});

const caminhoCanario = `_saude/${randomUUID()}.txt`;
let geracaoCanario;

await verificar('gravar objeto canário em _saude/', async () => {
  const arquivo = bucket.file(caminhoCanario);
  await arquivo.save(Buffer.from(`canario ${new Date().toISOString()}`), { contentType: 'text/plain', resumable: false });
  geracaoCanario = String(arquivo.metadata.generation ?? '');
  return `geração ${geracaoCanario}`;
});

await verificar('ler o canário de volta', async () => {
  const [conteudo] = await bucket.file(caminhoCanario).download();
  return `${conteudo.length} bytes`;
});

await verificar('apagar o canário (geração exata)', async () => {
  const alvo = geracaoCanario ? bucket.file(caminhoCanario, { generation: geracaoCanario }) : bucket.file(caminhoCanario);
  await alvo.delete();
  const [restantes] = await bucket.getFiles({ prefix: caminhoCanario, versions: true });
  if (restantes.length > 0) throw new Error(`${restantes.length} versão(ões) do canário ainda visível(is)`);
  return 'nenhuma versão restante';
});

for (const { rotulo, ok, detalhe } of resultados) {
  console.log(`${ok ? 'OK    ' : 'FALHOU'}  ${rotulo}${detalhe ? ` — ${detalhe}` : ''}`);
}

const falhou = resultados.some((resultado) => !resultado.ok);
console.log(falhou ? '\nBucket com problema.' : `\nBucket ${nomeDoBucket} pronto.`);
process.exit(falhou ? 1 : 0);
