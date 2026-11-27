import { canOperate, type MemberRole } from '../../../identity/domain/user.ts';
import { CATALOGO, EPISTEMICOS, FONTES, REVISOES, SECOES, camposVisiveisAoCliente, catalogoParaCliente, type Secao } from './catalogo.ts';
import { ehVisivelAoCliente, type ContextoBruto, type Marcacao } from './tipos.ts';

export type VisaoDoContexto = 'equipe' | 'cliente';

export function visaoDoPapel(papel: MemberRole): VisaoDoContexto {
  return canOperate(papel) ? 'equipe' : 'cliente';
}

export function chavesVisiveisAoCliente(secoes: readonly string[]): string[] {
  return camposVisiveisAoCliente(secoes).map((c) => c.key);
}

export function chavesLegiveisPeloCliente(secoes: readonly string[]): string[] {
  return camposVisiveisAoCliente(secoes).flatMap((c) =>
    c.tipo === 'lista' ? [c.key, ...c.item.filter((i) => i.tipo === 'arquivo').map((i) => i.key)] : [c.key],
  );
}

export function catalogoDaVisao(visao: VisaoDoContexto): readonly Secao[] {
  return visao === 'equipe' ? CATALOGO : catalogoParaCliente(SECOES);
}

export function recortarParaOCliente(contexto: ContextoBruto, secoes: readonly string[] = SECOES): ContextoBruto {
  const legiveis = new Set(chavesLegiveisPeloCliente(secoes));
  const naSecao = (secao: string) => secoes.includes(secao);
  return {
    campos: contexto.campos.filter((e) => naSecao(e.secao) && legiveis.has(e.fieldKey) && ehVisivelAoCliente(e)),
    itens: contexto.itens.filter((i) => naSecao(i.secao) && legiveis.has(i.listKey) && ehVisivelAoCliente(i)),
    arquivos: contexto.arquivos.filter((a) => a.compartilhavel && naSecao(a.secao) && legiveis.has(a.fieldKey)),
  };
}

function dentre<T extends string>(opcoes: readonly T[], bruto: unknown): T | null {
  return typeof bruto === 'string' && (opcoes as readonly string[]).includes(bruto) ? (bruto as T) : null;
}

export function marcacaoDoRetrato(retrato: Readonly<Record<string, unknown>>): Marcacao | null {
  const epistemico = dentre(EPISTEMICOS, retrato['epistemic']);
  const fonte = dentre(FONTES, retrato['source']);
  const revisao = dentre(REVISOES, retrato['review']);
  const compartilhavel = retrato['shareable'];
  if (!epistemico || !fonte || !revisao || typeof compartilhavel !== 'boolean') return null;
  return { epistemico, fonte, revisao, compartilhavel };
}

export type RetratosDaRevisao = {
  readonly secao: string;
  readonly chave: string;
  readonly antes: Readonly<Record<string, unknown>> | null;
  readonly depois: Readonly<Record<string, unknown>> | null;
};

export function revisaoVisivelAoCliente(revisao: RetratosDaRevisao, secoes: readonly string[] = SECOES): boolean {
  if (!secoes.includes(revisao.secao) || !chavesLegiveisPeloCliente(secoes).includes(revisao.chave)) return false;
  const retratos = [revisao.antes, revisao.depois].filter((r): r is Readonly<Record<string, unknown>> => r !== null);
  if (retratos.length === 0) return false;
  return retratos.every((retrato) => {
    const marcacao = marcacaoDoRetrato(retrato);
    return marcacao !== null && ehVisivelAoCliente(marcacao);
  });
}
