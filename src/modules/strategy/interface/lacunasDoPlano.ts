import type { MemberRole } from '../../identity/domain/user.ts';
import { formatarValor } from '../../clients/domain/regras/valor.ts';
import { lacunaAtendida, podeAprovarSugestoes, type RegraVigenteParaLacuna } from '../domain/lacunas.ts';
import type { Lacuna, Plano, ValorDaSugestao } from '../domain/plano.ts';

export const TEXTO_DO_BOTAO_APROVAR_SUGESTOES = 'Aprovar sugestões do plano';

export type OrigemDaSugestaoVisivel = 'evidencia' | 'hipotese' | 'sem_sugestao';

export type RegraAGravar = {
  readonly categoria: string;
  readonly chave: string | null;
  readonly escopo: string | null;
  readonly natureza: string;
};

export type LacunaDoPlano = {
  readonly id: string;
  readonly descricao: string;
  readonly valorSugerido: ValorDaSugestao | null;
  readonly valorLegivel: string | null;
  readonly origem: OrigemDaSugestaoVisivel;
  readonly evidencias: readonly string[];
  readonly justificativa: string | null;
  readonly editavel: boolean;
  readonly podeAprovar: boolean;
  readonly regraAGravar: RegraAGravar | null;
};

export type EntradaDasLacunas = {
  readonly plano: Pick<Plano, 'lacunas'> | null;
  readonly regrasVigentes: readonly RegraVigenteParaLacuna[];
  readonly papel: MemberRole;
  readonly podeGravarRegras: boolean;
  readonly sugestoesReprovadas?: ReadonlySet<string>;
  readonly regraAGravar?: (lacuna: Lacuna, valor: ValorDaSugestao) => RegraAGravar | null;
};

export function valorLegivelDaSugestao(valor: ValorDaSugestao): string {
  return 'texto' in valor ? valor.texto : formatarValor(valor);
}

export function lacunasDoPlano(entrada: EntradaDasLacunas): LacunaDoPlano[] {
  if (entrada.plano === null) return [];
  const papelAprova = entrada.podeGravarRegras && podeAprovarSugestoes(entrada.papel);
  return entrada.plano.lacunas.itens
    .filter((lacuna) => !lacunaAtendida(lacuna, entrada.regrasVigentes))
    .map((lacuna): LacunaDoPlano => {
      const sugestao = lacuna.sugestao;
      const reprovada = entrada.sugestoesReprovadas?.has(lacuna.id) === true;
      const valor = reprovada ? null : (sugestao?.valor ?? null);
      const temRegra = lacuna.regra !== undefined;
      const origem: OrigemDaSugestaoVisivel = valor === null ? (sugestao?.origem === 'hipotese' ? 'hipotese' : 'sem_sugestao') : 'evidencia';
      return {
        id: lacuna.id,
        descricao: lacuna.descricao,
        valorSugerido: valor,
        valorLegivel: valor === null ? null : valorLegivelDaSugestao(valor),
        origem,
        evidencias: valor === null ? [] : (sugestao?.evidencias ?? []).filter((e) => e.papel !== 'contra').map((e) => e.urn),
        justificativa: sugestao?.justificativa ?? null,
        editavel: papelAprova && temRegra,
        podeAprovar: papelAprova && temRegra && valor !== null,
        regraAGravar: valor === null || !papelAprova || !temRegra ? null : (entrada.regraAGravar?.(lacuna, valor) ?? null),
      };
    });
}
