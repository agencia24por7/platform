import {
  diasParaVencer,
  estaVigente,
  LIMITES_DO_SINAL,
  PLATAFORMAS_DE_SINAL,
  radarSemSinalVigente,
  TIPOS_DE_SINAL,
  type SinalDeCultura,
  type TipoDeSinal,
} from '../domain/cultura.ts';
import { NOTAS_DE_EVIDENCIA } from '../domain/entrada.ts';
import { somarDias } from '../domain/tempo.ts';

export const ROTULO_DO_TIPO_DE_SINAL: Readonly<Record<TipoDeSinal, string>> = {
  tendencia: 'Tendência',
  meme: 'Meme',
  conversa: 'Conversa emergente',
  comunidade: 'Movimento de comunidade',
  referencia_criativa: 'Referência criativa',
  anti_referencia: 'Anti-referência',
};

const AJUDA_DO_TIPO: Readonly<Record<TipoDeSinal, string>> = {
  tendencia: 'Assunto ou formato em alta agora.',
  meme: 'Piada ou formato de humor em circulação.',
  conversa: 'Debate que está surgindo entre pessoas, sem dono.',
  comunidade: 'Movimento ou comunidade pública em torno de um tema.',
  referencia_criativa: 'Campanha ou território criativo que serve de inspiração.',
  anti_referencia: 'Campanha ou território que a marca quer evitar.',
};

const ROTULO_DA_NOTA: Readonly<Record<(typeof NOTAS_DE_EVIDENCIA)[number], string>> = {
  A: 'Nota A: fonte primária e verificada',
  B: 'Nota B: fonte confiável',
  C: 'Nota C: fonte secundária, não confirmada',
  D: 'Nota D: não verificável, nunca sustenta meta',
};

const ROTULO_DA_PLATAFORMA: Readonly<Record<string, string>> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  x: 'X',
  kwai: 'Kwai',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  twitch: 'Twitch',
  whatsapp: 'WhatsApp',
  google_trends: 'Google Trends',
  outra: 'Outra',
};

const PRAZO_PADRAO_EM_DIAS = 30;
const DIAS_DE_AVISO = 7;

export type SituacaoDoSinal = 'vigente' | 'vence_em_breve' | 'vencido';

const SITUACAO: Readonly<Record<SituacaoDoSinal, { readonly rotulo: string; readonly icone: string }>> = {
  vigente: { rotulo: 'Vigente', icone: '✓' },
  vence_em_breve: { rotulo: 'Vence em breve', icone: '!' },
  vencido: { rotulo: 'Vencido: fora do Brain', icone: '×' },
};

export type VisaoDeCultura = {
  readonly podeEditar: boolean;
  readonly aviso: string | null;
  readonly contagem: string;
  readonly semSinais: string;
  readonly sinais: readonly {
    readonly id: string;
    readonly tipo: string;
    readonly titulo: string;
    readonly resumo: string;
    readonly fonteNome: string;
    readonly fonteUrl: string;
    readonly plataforma: string | null;
    readonly nota: string;
    readonly origem: string;
    readonly janela: string;
    readonly situacao: { readonly chave: SituacaoDoSinal; readonly rotulo: string; readonly icone: string };
  }[];
  readonly formulario: {
    readonly tipos: readonly { readonly valor: string; readonly rotulo: string; readonly ajuda: string }[];
    readonly notas: readonly { readonly valor: string; readonly rotulo: string }[];
    readonly plataformas: readonly { readonly valor: string; readonly rotulo: string }[];
    readonly limites: typeof LIMITES_DO_SINAL;
    readonly observadoEmPadrao: string;
    readonly validoAtePadrao: string;
    readonly validoAteMaximo: string;
    readonly lembrete: string;
  };
};

const formatarData = (iso: string): string => iso.split('-').reverse().join('/');

function situacaoDe(sinal: SinalDeCultura, hoje: string): SituacaoDoSinal {
  if (!estaVigente(sinal, hoje)) return 'vencido';
  return diasParaVencer(sinal, hoje) <= DIAS_DE_AVISO ? 'vence_em_breve' : 'vigente';
}

export function contagemDeVigentes(sinais: readonly SinalDeCultura[], hoje: string): string {
  if (sinais.length === 0) return 'Nenhum sinal';
  const vigentes = sinais.filter((sinal) => estaVigente(sinal, hoje)).length;
  return `${vigentes} ${vigentes === 1 ? 'vigente' : 'vigentes'} de ${sinais.length}`;
}

export function visaoDeCultura(entrada: { readonly sinais: readonly SinalDeCultura[]; readonly podeEditar: boolean; readonly hoje: string }): VisaoDeCultura {
  const { hoje } = entrada;
  const ordenados = [...entrada.sinais].sort(
    (a, b) => Number(estaVigente(b, hoje)) - Number(estaVigente(a, hoje)) || a.validoAte.localeCompare(b.validoAte) || a.id.localeCompare(b.id),
  );
  return {
    podeEditar: entrada.podeEditar,
    aviso: radarSemSinalVigente(entrada.sinais, hoje)
      ? 'Radar sem sinal vigente: o planejador não terá referência de cultura. Cadastre um sinal ou espere o coletor.'
      : null,
    contagem: contagemDeVigentes(entrada.sinais, hoje),
    semSinais: entrada.podeEditar ? 'Cadastre o primeiro sinal de cultura ou referência criativa.' : 'Nenhum sinal de cultura cadastrado.',
    sinais: ordenados.map((sinal) => {
      const chave = situacaoDe(sinal, hoje);
      return {
        id: sinal.id,
        tipo: ROTULO_DO_TIPO_DE_SINAL[sinal.tipo],
        titulo: sinal.titulo,
        resumo: sinal.resumo,
        fonteNome: sinal.fonteNome,
        fonteUrl: sinal.fonteUrl,
        plataforma: sinal.plataforma === null ? null : (ROTULO_DA_PLATAFORMA[sinal.plataforma] ?? sinal.plataforma),
        nota: ROTULO_DA_NOTA[sinal.nota],
        origem: sinal.origem === 'manual' ? 'Cadastrado pela equipe' : 'Trazido pelo coletor',
        janela: `Observado em ${formatarData(sinal.observadoEm)} · vale até ${formatarData(sinal.validoAte)}`,
        situacao: { chave, ...SITUACAO[chave] },
      };
    }),
    formulario: {
      tipos: TIPOS_DE_SINAL.map((valor) => ({ valor, rotulo: ROTULO_DO_TIPO_DE_SINAL[valor], ajuda: AJUDA_DO_TIPO[valor] })),
      notas: NOTAS_DE_EVIDENCIA.map((valor) => ({ valor, rotulo: ROTULO_DA_NOTA[valor] })),
      plataformas: PLATAFORMAS_DE_SINAL.map((valor) => ({ valor, rotulo: ROTULO_DA_PLATAFORMA[valor] ?? valor })),
      limites: LIMITES_DO_SINAL,
      observadoEmPadrao: hoje,
      validoAtePadrao: somarDias(hoje, PRAZO_PADRAO_EM_DIAS),
      validoAteMaximo: somarDias(hoje, LIMITES_DO_SINAL.diasDeValidade),
      lembrete: 'Descreva só o fenômeno público. Não cadastre perfis (@), nomes de pessoas, e-mails nem telefones.',
    },
  };
}
