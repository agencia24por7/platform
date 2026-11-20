import { TAG_DA_PLATAFORMA, type WorkflowImplantado } from './clienteN8n.ts';
import { TAGS_INTOCAVEIS } from './sincronizacao.ts';

export const PADROES_DO_LEGADO_POR_CONEXAO: readonly RegExp[] = [
  /^Coletor · ORLA · coletor · /,
  /^Executor · ORLA · tarefas · /,
  /^ORLA · revogação · [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
];

export const CREDENCIAIS_COMPARTILHADAS_DA_PLATAFORMA: readonly string[] = ['ORLA · worker token', 'ORLA · token do worker'];

const PREFIXO_DA_CREDENCIAL = 'n8n:credential:';
const ID_DO_N8N = /^[A-Za-z0-9]{1,64}$/;

export const ehNomeDoLegadoPorConexao = (nome: string) => PADROES_DO_LEGADO_POR_CONEXAO.some((padrao) => padrao.test(nome));

export type RefsDoCorte = {
  readonly connectionId: string;
  readonly platform: string;
  readonly credentialRef: string | null;
  readonly coletorRef: string | null;
  readonly executorRef: string | null;
};

export type MotivoDeIgnorar =
  | 'intocavel'
  | 'generico_da_plataforma'
  | 'sem_identificacao_da_plataforma'
  | 'referencia_invalida'
  | 'credencial_em_uso'
  | 'credencial_compartilhada_da_plataforma'
  | 'workflow_ainda_existe';

export type ItemDaLimpeza = {
  readonly tipo: 'workflow' | 'credencial';
  readonly id: string;
  readonly nome: string | null;
  readonly origem: 'corte' | 'padrao_de_nome';
  readonly conexoes: readonly string[];
};

export type Ignorado = ItemDaLimpeza & { readonly motivo: MotivoDeIgnorar; readonly detalhe?: string };

export type PlanoDaLimpeza = {
  readonly workflows: readonly ItemDaLimpeza[];
  readonly credenciais: readonly ItemDaLimpeza[];
  readonly jaAusentes: readonly ItemDaLimpeza[];
  readonly ignorados: readonly Ignorado[];
};

export type ClienteDaLimpeza = {
  listar(): Promise<readonly WorkflowImplantado[]>;
  remover(workflowId: string, contexto: Record<string, string>): Promise<boolean>;
  removerCredencial(credentialId: string): Promise<'removida' | 'ausente' | 'falhou'>;
};

export type RelatorioDaLimpeza = {
  readonly aplicado: boolean;
  readonly removidos: readonly ItemDaLimpeza[];
  readonly jaAusentes: readonly ItemDaLimpeza[];
  readonly ignorados: readonly Ignorado[];
  readonly falhas: readonly ItemDaLimpeza[];
  readonly planejados: readonly ItemDaLimpeza[];
  readonly conexoesLimpas: readonly string[];
  readonly contagem: { readonly removidos: number; readonly jaAusentes: number; readonly ignorados: number; readonly falhas: number; readonly planejados: number };
};

type No = { readonly credentials?: Record<string, { readonly id?: string; readonly name?: string }> };

const nomesDasTags = (workflow: WorkflowImplantado) => (workflow.tags ?? []).map((tag) => tag.name.toLowerCase());

function credenciaisDo(workflow: WorkflowImplantado): { id: string; nome: string | null }[] {
  return (workflow.nodes as readonly No[]).flatMap((no) =>
    Object.values(no.credentials ?? {})
      .filter((credencial) => typeof credencial.id === 'string')
      .map((credencial) => ({ id: credencial.id!, nome: credencial.name ?? null })),
  );
}

export function idDaCredencial(credentialRef: string): string | null {
  if (!credentialRef.startsWith(PREFIXO_DA_CREDENCIAL)) return null;
  const id = credentialRef.slice(PREFIXO_DA_CREDENCIAL.length);
  return ID_DO_N8N.test(id) ? id : null;
}

function acumular(mapa: Map<string, { origem: ItemDaLimpeza['origem']; conexoes: Set<string> }>, id: string, origem: ItemDaLimpeza['origem'], conexao?: string) {
  const atual = mapa.get(id) ?? { origem, conexoes: new Set<string>() };
  if (origem === 'corte') atual.origem = 'corte';
  if (conexao) atual.conexoes.add(conexao);
  mapa.set(id, atual);
}

export function planejarLimpeza(
  refs: readonly RefsDoCorte[],
  implantados: readonly WorkflowImplantado[],
  nomesGenericos: ReadonlySet<string>,
): PlanoDaLimpeza {
  const porId = new Map(implantados.map((workflow) => [workflow.id, workflow]));
  const candidatos = new Map<string, { origem: ItemDaLimpeza['origem']; conexoes: Set<string> }>();
  const credenciaisPedidas = new Map<string, { origem: ItemDaLimpeza['origem']; conexoes: Set<string> }>();
  const ignorados: Ignorado[] = [];

  for (const ref of refs) {
    for (const workflowId of [ref.coletorRef, ref.executorRef]) {
      if (workflowId) acumular(candidatos, workflowId, 'corte', ref.connectionId);
    }
    if (!ref.credentialRef) continue;
    const id = idDaCredencial(ref.credentialRef);
    if (id) acumular(credenciaisPedidas, id, 'corte', ref.connectionId);
    else if (ref.credentialRef.startsWith(PREFIXO_DA_CREDENCIAL)) {
      ignorados.push({ tipo: 'credencial', id: ref.credentialRef, nome: null, origem: 'corte', conexoes: [ref.connectionId], motivo: 'referencia_invalida' });
    }
  }
  for (const workflow of implantados) {
    if (ehNomeDoLegadoPorConexao(workflow.name)) acumular(candidatos, workflow.id, 'padrao_de_nome');
  }

  const workflows: ItemDaLimpeza[] = [];
  const jaAusentes: ItemDaLimpeza[] = [];
  for (const [id, { origem, conexoes }] of candidatos) {
    const implantado = porId.get(id);
    const item: ItemDaLimpeza = { tipo: 'workflow', id, nome: implantado?.name ?? null, origem, conexoes: [...conexoes] };
    if (!implantado) {
      jaAusentes.push(item);
      continue;
    }
    const tags = nomesDasTags(implantado);
    const intocavel = TAGS_INTOCAVEIS.find((tag) => tags.includes(tag));
    if (intocavel) {
      ignorados.push({ ...item, motivo: 'intocavel', detalhe: `tag ${intocavel}` });
      continue;
    }
    if (nomesGenericos.has(implantado.name)) {
      ignorados.push({ ...item, motivo: 'generico_da_plataforma' });
      continue;
    }
    const temTag = tags.includes(TAG_DA_PLATAFORMA);
    const nomeDoLegado = ehNomeDoLegadoPorConexao(implantado.name);
    const identificado = origem === 'corte' ? temTag || nomeDoLegado : temTag && nomeDoLegado;
    if (!identificado) {
      ignorados.push({ ...item, motivo: 'sem_identificacao_da_plataforma', detalhe: origem === 'padrao_de_nome' ? `sem a tag ${TAG_DA_PLATAFORMA}` : 'sem tag nem nome do legado' });
      continue;
    }
    workflows.push(item);
  }

  const vaoSair = new Set(workflows.map((item) => item.id));
  const usoRestante = new Map<string, { workflows: string[]; nomes: Set<string> }>();
  for (const workflow of implantados) {
    for (const { id, nome } of credenciaisDo(workflow)) {
      const uso = usoRestante.get(id) ?? { workflows: [], nomes: new Set<string>() };
      if (!vaoSair.has(workflow.id)) uso.workflows.push(workflow.name);
      if (nome) uso.nomes.add(nome);
      usoRestante.set(id, uso);
    }
  }

  const credenciais: ItemDaLimpeza[] = [];
  for (const [id, { origem, conexoes }] of credenciaisPedidas) {
    const uso = usoRestante.get(id);
    const nome = uso ? [...uso.nomes][0] ?? null : null;
    const item: ItemDaLimpeza = { tipo: 'credencial', id, nome, origem, conexoes: [...conexoes] };
    if (uso && [...uso.nomes].some((n) => CREDENCIAIS_COMPARTILHADAS_DA_PLATAFORMA.includes(n))) {
      ignorados.push({ ...item, motivo: 'credencial_compartilhada_da_plataforma' });
      continue;
    }
    if (uso && uso.workflows.length > 0) {
      ignorados.push({ ...item, motivo: 'credencial_em_uso', detalhe: uso.workflows.slice(0, 5).join(', ') });
      continue;
    }
    credenciais.push(item);
  }

  return { workflows, credenciais, jaAusentes, ignorados };
}

export async function executarLimpeza(
  refs: readonly RefsDoCorte[],
  cliente: ClienteDaLimpeza,
  nomesGenericos: ReadonlySet<string>,
  aplicar: boolean,
): Promise<RelatorioDaLimpeza> {
  const plano = planejarLimpeza(refs, await cliente.listar(), nomesGenericos);
  const removidos: ItemDaLimpeza[] = [];
  const jaAusentes: ItemDaLimpeza[] = [...plano.jaAusentes];
  const ignorados: Ignorado[] = [...plano.ignorados];
  const falhas: ItemDaLimpeza[] = [];
  const planejados = [...plano.workflows, ...plano.credenciais];

  if (aplicar) {
    for (const item of plano.workflows) {
      const ok = await cliente.remover(item.id, { tipo: 'limpeza-do-legado', conexoes: item.conexoes.join(',') });
      (ok ? removidos : falhas).push(item);
    }

    const restantes = await cliente.listar();
    const usadas = new Set(restantes.flatMap((workflow) => credenciaisDo(workflow).map((credencial) => credencial.id)));
    for (const item of plano.credenciais) {
      if (usadas.has(item.id)) {
        ignorados.push({ ...item, motivo: 'workflow_ainda_existe' });
        continue;
      }
      const desfecho = await cliente.removerCredencial(item.id);
      if (desfecho === 'removida') removidos.push(item);
      else if (desfecho === 'ausente') jaAusentes.push(item);
      else falhas.push(item);
    }
  }

  const pendentesPorConexao = new Set<string>();
  for (const item of [...ignorados, ...falhas, ...(aplicar ? [] : planejados)]) {
    for (const conexao of item.conexoes) pendentesPorConexao.add(conexao);
  }
  const conexoesLimpas = refs.map((ref) => ref.connectionId).filter((id) => !pendentesPorConexao.has(id));

  return {
    aplicado: aplicar,
    removidos,
    jaAusentes,
    ignorados,
    falhas,
    planejados,
    conexoesLimpas,
    contagem: {
      removidos: removidos.length,
      jaAusentes: jaAusentes.length,
      ignorados: ignorados.length,
      falhas: falhas.length,
      planejados: planejados.length,
    },
  };
}
