import type { ComiteConfigurado } from '@/modules/strategy/application/comitesService';
import { NUMERO_DE_MESAS_DO_COMITE } from '@/modules/strategy/domain/index';
import { apresentarEstadoDaTarefa, type ApresentacaoDeEstado } from '@/modules/ia/interface/apresentacao';
import type { EstadoDaTarefa } from '@/modules/ia/domain/modelos';

export type TarefaDoPainel = {
  readonly chave: string;
  readonly escolha: { readonly fornecedor: string; readonly modelo: string } | null;
  readonly herdada: boolean;
  readonly estado: EstadoDaTarefa;
};

export const VALOR_DO_MODELO_PADRAO = 'padrao';

export type CartaoDoComite = {
  readonly chave: string;
  readonly tarefa: string;
  readonly nome: string;
  readonly proposito: string;
  readonly membros: string;
  readonly custo: string;
  readonly estado: ApresentacaoDeEstado;
  readonly travado: boolean;
  readonly explicacaoDaTrava: string | null;
  readonly acao: { readonly ligado: 'sim' | 'nao'; readonly rotulo: string; readonly pendente: string } | null;
  readonly modelo: { readonly valor: string; readonly rotuloDoPadrao: string; readonly estado: ApresentacaoDeEstado; readonly rotuloDoSalvar: string };
};

export type VisaoDosComites = {
  readonly cartoes: readonly CartaoDoComite[];
  readonly aviso: string;
  readonly chamadasPorRodada: number;
};

const LIGADO: ApresentacaoDeEstado = { tom: 'ok', icone: 'check', rotulo: 'Ligado' };
const DESLIGADO: ApresentacaoDeEstado = { tom: 'neutral', icone: 'pausa', rotulo: 'Desligado', explicacao: 'Não revisa os planos novos nem as correções.' };
const TRAVA = 'Sempre ligado: a reprovação deste comitê obriga ajuste no plano, por regra legal, de plataforma e de privacidade.';

const numero = new Intl.NumberFormat('pt-BR');

function custo(comite: ComiteConfigurado): string {
  const membros = comite.comite.membros.length;
  return `${numero.format(comite.chamadasPorRodada)} chamadas por rodada (${membros} membros e ${NUMERO_DE_MESAS_DO_COMITE} mesas).`;
}

function estadoDoModelo(tarefa: TarefaDoPainel | undefined): ApresentacaoDeEstado {
  if (tarefa === undefined) return apresentarEstadoDaTarefa('sem_modelo');
  const base = apresentarEstadoDaTarefa(tarefa.estado);
  if (!tarefa.herdada) return base;
  return { ...base, rotulo: `${base.rotulo} (modelo padrão do Comitê)` };
}

export function visaoDosComites(configurados: readonly ComiteConfigurado[], tarefas: readonly TarefaDoPainel[]): VisaoDosComites {
  const cartoes = configurados.map((configurado): CartaoDoComite => {
    const { comite } = configurado;
    const tarefa = tarefas.find((candidata) => candidata.chave === comite.tarefa);
    return {
      chave: comite.chave,
      tarefa: comite.tarefa,
      nome: comite.nome,
      proposito: comite.proposito,
      membros: comite.membros.map((membro) => (membro.relatora ? `${membro.nome} (relatora)` : membro.nome)).join(', '),
      custo: custo(configurado),
      estado: configurado.ligado ? LIGADO : DESLIGADO,
      travado: configurado.obrigatorio,
      explicacaoDaTrava: configurado.obrigatorio ? TRAVA : null,
      acao: configurado.obrigatorio
        ? null
        : configurado.ligado
          ? { ligado: 'nao', rotulo: `Desligar ${comite.nome}`, pendente: 'Desligando…' }
          : { ligado: 'sim', rotulo: `Ligar ${comite.nome}`, pendente: 'Ligando…' },
      modelo: {
        valor: tarefa?.escolha && !tarefa.herdada ? `${tarefa.escolha.fornecedor}|${tarefa.escolha.modelo}` : VALOR_DO_MODELO_PADRAO,
        rotuloDoPadrao: 'Usar o modelo padrão do Comitê',
        estado: estadoDoModelo(tarefa),
        rotuloDoSalvar: `Salvar modelo do ${comite.nome}`,
      },
    };
  });
  const ligados = configurados.filter((configurado) => configurado.ligado);
  const chamadasPorRodada = ligados.reduce((soma, configurado) => soma + configurado.chamadasPorRodada, 0);
  const aviso = `Com ${numero.format(ligados.length)} comitês ligados, cada rodada do Comitê faz cerca de ${numero.format(chamadasPorRodada)} chamadas ao modelo, além do juiz, do ajuste e dos Gates. Cada chamada conta nos tetos do dia.`;
  return { cartoes, aviso, chamadasPorRodada };
}

export function tarefasForaDosComites<T extends { readonly herdaDe?: string }>(tarefas: readonly T[]): readonly T[] {
  return tarefas.filter((tarefa) => tarefa.herdaDe === undefined);
}
