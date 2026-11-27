import { centavosDe, somaDeCentavos } from '../dinheiro.ts';
import { urnsDoFoco } from '../plano.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_VERBA_POR_PRODUTO = 'foco_verba_por_produto';
export const CHAVE_ALINHAMENTO_AO_FOCO = 'foco_alinhamento';

function rotuloDoProduto(contexto: ContextoDoGate, urn: string): string {
  const foco = contexto.plano.intencao.foco;
  const produto = foco?.tipo === 'produtos' ? foco.produtos.find((item) => item.urn === urn) : undefined;
  return produto?.rotulo ?? 'produto fora do foco';
}

export function checarVerbaPorProduto(contexto: ContextoDoGate): ResultadoDaChecagem {
  const { plano } = contexto;
  const foco = plano.intencao.foco;
  if (foco === undefined) return aprovar(CHAVE_VERBA_POR_PRODUTO, 'Plano sem foco definido: não há verba por produto a conferir.');
  const divisao = plano.orcamento.por_produto ?? [];
  const total = centavosDe(plano.orcamento.total);
  const permitidos = new Set(urnsDoFoco(foco));
  const problemas: string[] = [];

  if (foco.tipo === 'marca') {
    if (divisao.length > 0) problemas.push('orcamento (campanha de marca não divide a verba por produto)');
  } else {
    const vistos = new Set<string>();
    for (const item of divisao) {
      if (!permitidos.has(item.produto)) problemas.push('orcamento (verba para produto fora do foco)');
      else if (vistos.has(item.produto)) problemas.push(`orcamento (produto repetido: ${rotuloDoProduto(contexto, item.produto)})`);
      vistos.add(item.produto);
      if (centavosDe(item.valor) === 0n && (item.justificativa === undefined || item.justificativa.trim() === '')) {
        problemas.push(`orcamento (valor zero sem justificativa: ${rotuloDoProduto(contexto, item.produto)})`);
      }
    }
    if (foco.produtos.length > 1) {
      for (const produto of foco.produtos) {
        if (!vistos.has(produto.urn)) problemas.push(`orcamento (produto sem verba: ${produto.rotulo})`);
      }
      if (divisao.length > 0 && somaDeCentavos(divisao.map((item) => item.valor)) !== total) {
        problemas.push('orcamento (soma por produto diferente do total)');
      }
    } else if (divisao.length > 0) {
      if (divisao.length !== 1 || somaDeCentavos(divisao.map((item) => item.valor)) !== total) {
        problemas.push('orcamento (com um produto, a verba por produto é o total)');
      }
    }
  }

  if (problemas.length === 0) return aprovar(CHAVE_VERBA_POR_PRODUTO, 'A verba por produto fecha com o total e só usa produtos do foco.');
  return reprovar(CHAVE_VERBA_POR_PRODUTO, `${problemas.length} inconsistência(s) na verba por produto.`, problemas);
}

export function checarAlinhamentoAoFoco(contexto: ContextoDoGate): ResultadoDaChecagem {
  const { plano } = contexto;
  const foco = plano.intencao.foco;
  if (foco === undefined) return aprovar(CHAVE_ALINHAMENTO_AO_FOCO, 'Plano sem foco definido: não há alinhamento a conferir.');
  const permitidos = new Set(urnsDoFoco(foco));
  const exigeProduto = foco.tipo === 'produtos' && foco.produtos.length > 1;
  const problemas: string[] = [];
  for (const campanha of plano.campanhas.campanhas) {
    const local = `campanhas/${campanha.id}`;
    if (campanha.produto === undefined) {
      if (exigeProduto) problemas.push(`${local} (campanha sem produto do foco)`);
    } else if (!permitidos.has(campanha.produto)) {
      problemas.push(`${local} (produto fora do foco)`);
    }
  }
  if (problemas.length === 0) return aprovar(CHAVE_ALINHAMENTO_AO_FOCO, 'As campanhas só citam produtos do foco.');
  return reprovar(CHAVE_ALINHAMENTO_AO_FOCO, `${problemas.length} campanha(s) fora do foco.`, problemas);
}
