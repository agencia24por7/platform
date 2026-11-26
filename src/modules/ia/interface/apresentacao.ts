import type { SituacaoDaCredencial } from '../domain/credencial.ts';
import type { EstadoDaTarefa } from '../domain/modelos.ts';

export type TomDeEstado = 'ok' | 'warn' | 'danger' | 'neutral';
export type IconeDeEstado = 'check' | 'relogio' | 'bloqueio' | 'alerta' | 'pausa';

export type ApresentacaoDeEstado = {
  readonly tom: TomDeEstado;
  readonly icone: IconeDeEstado;
  readonly rotulo: string;
  readonly explicacao?: string;
};

const ROTULO_DE_FERRAMENTA: Readonly<Record<string, string>> = {
  brain_consultar_catalogo: 'Consultar o catálogo do Brain',
};

export function rotuloDaFerramenta(nome: string): string {
  const conhecido = ROTULO_DE_FERRAMENTA[nome];
  if (conhecido) return conhecido;
  const palavras = nome.split('_').filter((palavra) => palavra.length > 0);
  if (palavras.length === 0) return nome;
  const frase = palavras.join(' ');
  return `${frase.charAt(0).toUpperCase()}${frase.slice(1)}`;
}

const SITUACAO_DA_CREDENCIAL: Readonly<Record<SituacaoDaCredencial, ApresentacaoDeEstado>> = {
  ativa: { tom: 'ok', icone: 'check', rotulo: 'Ativa' },
  vencida: { tom: 'warn', icone: 'relogio', rotulo: 'Vencida' },
  revogada: { tom: 'danger', icone: 'bloqueio', rotulo: 'Revogada' },
};

export function apresentarSituacaoDaCredencial(situacao: SituacaoDaCredencial): ApresentacaoDeEstado {
  return SITUACAO_DA_CREDENCIAL[situacao];
}

const ESTADO_DA_TAREFA: Readonly<Record<EstadoDaTarefa, ApresentacaoDeEstado>> = {
  configurada: { tom: 'ok', icone: 'check', rotulo: 'Configurada' },
  sem_modelo: { tom: 'warn', icone: 'alerta', rotulo: 'Sem modelo', explicacao: 'A tarefa fica bloqueada até você escolher um modelo.' },
  modelo_indisponivel: {
    tom: 'danger',
    icone: 'alerta',
    rotulo: 'Modelo indisponível',
    explicacao: 'O modelo escolhido saiu da lista do fornecedor. Escolha outro ou atualize a lista de modelos.',
  },
};

export function apresentarEstadoDaTarefa(estado: EstadoDaTarefa): ApresentacaoDeEstado {
  return ESTADO_DA_TAREFA[estado];
}

export function apresentarLigada(ligada: boolean): ApresentacaoDeEstado {
  return ligada
    ? { tom: 'ok', icone: 'check', rotulo: 'Ligada', explicacao: 'As tarefas podem chamar o modelo escolhido, dentro dos tetos do dia.' }
    : { tom: 'neutral', icone: 'pausa', rotulo: 'Desligada', explicacao: 'Nenhuma tarefa chama modelo enquanto estiver desligada.' };
}

export function apresentarChaveDoFornecedor(guardada: boolean): ApresentacaoDeEstado {
  return guardada
    ? { tom: 'ok', icone: 'check', rotulo: 'Chave guardada' }
    : { tom: 'warn', icone: 'alerta', rotulo: 'Sem chave', explicacao: 'As tarefas não podem usar este fornecedor.' };
}

const dataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' });

export function dataCurtaDaCredencial(data: Date): string {
  return dataCurta.format(data);
}
