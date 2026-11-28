import { ROTULO_DA_SITUACAO, type Situacao } from '../ciclo.ts';
import { CAMPO_DA_LOGO, SECAO_DA_LOGO } from '../contexto/logo.ts';
import { rotaDoCliente, rotaDoMapaDeContexto } from './enderecos.ts';
import { ICONE_DO_VEREDITO, TOM_DA_SITUACAO, TOM_DO_VEREDITO, rotuloDoModelo, type IconeDoVeredito, type TomDoIndicador } from './indicadores.ts';
import { ROTULO_DO_VEREDITO, type LacunaDaProntidao, type Veredito } from './prontidao.ts';

export type ClienteDoCabecalho = {
  readonly id: string;
  readonly name: string;
  readonly segment: string | null;
  readonly businessModel: string;
  readonly status: Situacao;
  readonly parentClientId: string | null;
};

export type LacunaDeRegra = { readonly chave: string; readonly nome: string };

export type ProntidaoDoCabecalho = {
  readonly rotulo: string;
  readonly icone: IconeDoVeredito;
  readonly tom: TomDoIndicador;
  readonly contagem: string | null;
  readonly lacunas: readonly { readonly chave: string; readonly titulo: string }[];
  readonly lacunasDeRegras: readonly { readonly chave: string; readonly nome: string; readonly href: string | null }[];
};

export type VisaoDoCabecalho = {
  readonly nome: string;
  readonly inicial: string;
  readonly logo: string | null;
  readonly pedirLogo: string | null;
  readonly fatos: readonly string[];
  readonly situacao: { readonly rotulo: string; readonly tom: TomDoIndicador };
  readonly prontidao: ProntidaoDoCabecalho | null;
};


function vereditoCombinado(veredito: Veredito | null, faltamRegras: boolean): Veredito | null {
  if (veredito === null) return faltamRegras ? 'parcial' : null;
  return veredito === 'sim' && faltamRegras ? 'parcial' : veredito;
}

export function rotaDaLogo(clienteId: string, sha256: string): string {
  return `/api/contexto/${encodeURIComponent(clienteId)}/logo?v=${encodeURIComponent(sha256.slice(0, 16))}`;
}

export function visaoDoCabecalho(entrada: {
  readonly cliente: ClienteDoCabecalho;
  readonly prontidao: { readonly veredito: Veredito; readonly lacunas: readonly LacunaDaProntidao[] } | null;
  readonly lacunasDeRegras: readonly LacunaDeRegra[];
  readonly podeDefinirLimite: boolean;
  readonly podeEditar: boolean;
  readonly hashDaLogo: string | null;
}): VisaoDoCabecalho {
  const { cliente } = entrada;
  const lacunas = entrada.prontidao && entrada.prontidao.veredito !== 'sim' ? entrada.prontidao.lacunas : [];
  const veredito = vereditoCombinado(entrada.prontidao?.veredito ?? null, entrada.lacunasDeRegras.length > 0);
  const total = lacunas.length + entrada.lacunasDeRegras.length;
  return {
    nome: cliente.name,
    inicial: cliente.name.trim().charAt(0).toLocaleUpperCase('pt-BR') || '?',
    logo: entrada.hashDaLogo ? rotaDaLogo(cliente.id, entrada.hashDaLogo) : null,
    pedirLogo: !entrada.hashDaLogo && entrada.podeEditar ? rotaDoMapaDeContexto(cliente.id, SECAO_DA_LOGO, CAMPO_DA_LOGO) : null,
    fatos: [rotuloDoModelo(cliente.businessModel), cliente.segment ?? 'Sem segmento', ...(cliente.parentClientId ? ['Unidade de uma rede'] : [])],
    situacao: { rotulo: ROTULO_DA_SITUACAO[cliente.status], tom: TOM_DA_SITUACAO[cliente.status] },
    prontidao: veredito
      ? {
          rotulo: ROTULO_DO_VEREDITO[veredito],
          icone: ICONE_DO_VEREDITO[veredito],
          tom: TOM_DO_VEREDITO[veredito],
          contagem: total === 0 ? null : `${total} ${total === 1 ? 'sugestão' : 'sugestões'}`,
          lacunas: lacunas.map((lacuna) => ({ chave: lacuna.id, titulo: lacuna.titulo })),
          lacunasDeRegras: entrada.lacunasDeRegras.map((lacuna) => ({
            chave: lacuna.chave,
            nome: lacuna.nome,
            href: entrada.podeDefinirLimite ? rotaDoCliente(cliente.id, 'regras', { secao: 'registrar', natureza: 'limite', definicao: lacuna.chave }) : null,
          })),
        }
      : null,
  };
}
