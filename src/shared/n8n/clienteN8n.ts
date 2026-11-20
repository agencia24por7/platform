export type Registrador = {
  info(mensagem: string, dados?: Record<string, unknown>): void;
  warn(mensagem: string, dados?: Record<string, unknown>): void;
  error(mensagem: string, dados?: Record<string, unknown>): void;
};

export type ConfiguracaoN8n = {
  readonly url: string;
  readonly apiKey: string;
  readonly esperarMs?: number;
};

export type CorpoDeWorkflow = {
  readonly name: string;
  readonly nodes: readonly unknown[];
  readonly connections: Record<string, unknown>;
  readonly settings: Record<string, unknown>;
};

export type WorkflowImplantado = CorpoDeWorkflow & {
  readonly id: string;
  readonly active: boolean;
  readonly tags?: readonly { readonly id: string; readonly name: string }[];
};

export const TAG_DA_PLATAFORMA = 'platform';

export type ClienteN8n = {
  criar(corpo: CorpoDeWorkflow, contexto: Record<string, string>): Promise<string | null>;
  remover(workflowId: string, contexto: Record<string, string>): Promise<boolean>;
  listar(): Promise<WorkflowImplantado[]>;
  atualizar(workflowId: string, corpo: CorpoDeWorkflow): Promise<boolean>;
  publicar(workflowId: string): Promise<boolean>;
  marcarDaPlataforma(workflowId: string, tagsAtuais?: readonly { readonly id: string }[]): Promise<boolean>;
  removerCredencial(credentialId: string): Promise<'removida' | 'ausente' | 'falhou'>;
};

const TENTATIVAS_DE_REMOCAO = 10;
const TAMANHO_DA_PAGINA = 100;
const LIMITE_DE_TAGS = 250;

export function criarClienteN8n(configuracao: ConfiguracaoN8n, logger: Registrador): ClienteN8n {
  const esperarMs = configuracao.esperarMs ?? 2_000;
  const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

  const chamar = (metodo: string, caminho: string, corpo?: unknown) =>
    fetch(new URL(`/api/v1/${caminho}`, configuracao.url).toString(), {
      method: metodo,
      headers: { 'X-N8N-API-KEY': configuracao.apiKey, 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });

  let tagDaPlataforma: string | null = null;

  const idDaTagDaPlataforma = async (): Promise<string | null> => {
    if (tagDaPlataforma) return tagDaPlataforma;
    const lista = await chamar('GET', `tags?limit=${LIMITE_DE_TAGS}`);
    if (lista.ok) {
      const { data } = (await lista.json()) as { data: { id: string; name: string }[] };
      tagDaPlataforma = data.find((tag) => tag.name === TAG_DA_PLATAFORMA)?.id ?? null;
    }
    if (!tagDaPlataforma) {
      const criada = await chamar('POST', 'tags', { name: TAG_DA_PLATAFORMA });
      if (criada.ok) tagDaPlataforma = ((await criada.json()) as { id: string }).id;
    }
    return tagDaPlataforma;
  };

  const tagsDoWorkflow = async (workflowId: string): Promise<{ id: string }[] | null> => {
    const resposta = await chamar('GET', `workflows/${workflowId}`);
    if (!resposta.ok) return null;
    const { tags } = (await resposta.json()) as { tags?: { id: string }[] | null };
    return (tags ?? []).map((tag) => ({ id: tag.id }));
  };

  const marcarDaPlataforma = async (workflowId: string, tagsAtuais?: readonly { readonly id: string }[]): Promise<boolean> => {
    try {
      const tagId = await idDaTagDaPlataforma();
      if (!tagId) return false;
      const atuais = tagsAtuais ? tagsAtuais.map((tag) => ({ id: tag.id })) : await tagsDoWorkflow(workflowId);
      if (!atuais) {
        logger.warn('n8n.workflow.tag.leitura_falhou', { workflowId });
        return false;
      }
      if (atuais.some((tag) => tag.id === tagId)) return true;
      const resposta = await chamar('PUT', `workflows/${workflowId}/tags`, [...atuais, { id: tagId }]);
      if (!resposta.ok) logger.warn('n8n.workflow.tag.falhou', { workflowId, status: resposta.status });
      return resposta.ok;
    } catch (error) {
      logger.warn('n8n.workflow.tag.erro', { workflowId, error: error instanceof Error ? error.message : 'desconhecido' });
      return false;
    }
  };

  return {
    marcarDaPlataforma,

    async criar(corpo, contexto) {
      try {
        const resposta = await chamar('POST', 'workflows', corpo);
        if (!resposta.ok) {
          logger.error('n8n.workflow.criar.falhou', { ...contexto, status: resposta.status });
          return null;
        }

        const criado = (await resposta.json()) as { id?: string };
        if (!criado.id) return null;

        await marcarDaPlataforma(criado.id, []);

        const publicacao = await chamar('POST', `workflows/${criado.id}/activate`);
        if (!publicacao.ok) {
          logger.warn('n8n.workflow.publicar.falhou', { ...contexto, workflowId: criado.id, status: publicacao.status });
        }

        logger.info('n8n.workflow.criar.ok', { ...contexto, workflowId: criado.id, publicado: publicacao.ok });
        return criado.id;
      } catch (error) {
        logger.error('n8n.workflow.criar.erro', { ...contexto, error: error instanceof Error ? error.message : 'desconhecido' });
        return null;
      }
    },

    async remover(workflowId, contexto) {
      try {
        await chamar('POST', `workflows/${workflowId}/deactivate`);
        for (let tentativa = 1; tentativa <= TENTATIVAS_DE_REMOCAO; tentativa++) {
          const resposta = await chamar('DELETE', `workflows/${workflowId}`);
          if (resposta.ok || resposta.status === 404) {
            logger.info('n8n.workflow.remover.ok', { ...contexto, workflowId });
            return true;
          }
          if (resposta.status !== 409) {
            logger.error('n8n.workflow.remover.falhou', { ...contexto, workflowId, status: resposta.status });
            return false;
          }
          await esperar(esperarMs);
        }
        logger.error('n8n.workflow.remover.esgotou', { ...contexto, workflowId });
        return false;
      } catch (error) {
        logger.error('n8n.workflow.remover.erro', { ...contexto, workflowId, error: error instanceof Error ? error.message : 'desconhecido' });
        return false;
      }
    },

    async listar() {
      const todos: WorkflowImplantado[] = [];
      let cursor: string | undefined;
      do {
        const consulta = new URLSearchParams({ limit: String(TAMANHO_DA_PAGINA) });
        if (cursor) consulta.set('cursor', cursor);
        const resposta = await chamar('GET', `workflows?${consulta}`);
        if (!resposta.ok) throw new Error(`n8n respondeu ${resposta.status} ao listar workflows`);
        const pagina = (await resposta.json()) as { data: WorkflowImplantado[]; nextCursor?: string | null };
        todos.push(...pagina.data);
        cursor = pagina.nextCursor ?? undefined;
      } while (cursor);
      return todos;
    },

    async atualizar(workflowId, corpo) {
      const resposta = await chamar('PUT', `workflows/${workflowId}`, corpo);
      if (!resposta.ok) logger.error('n8n.workflow.atualizar.falhou', { workflowId, status: resposta.status });
      return resposta.ok;
    },

    async removerCredencial(credentialId) {
      try {
        const resposta = await chamar('DELETE', `credentials/${encodeURIComponent(credentialId)}`);
        if (resposta.ok) return 'removida';
        if (resposta.status === 404) return 'ausente';
        logger.error('n8n.credencial.remover.falhou', { credentialId, status: resposta.status });
        return 'falhou';
      } catch (error) {
        logger.error('n8n.credencial.remover.erro', { credentialId, error: error instanceof Error ? error.message : 'desconhecido' });
        return 'falhou';
      }
    },

    async publicar(workflowId) {
      const resposta = await chamar('POST', `workflows/${workflowId}/activate`);
      if (!resposta.ok) logger.warn('n8n.workflow.publicar.falhou', { workflowId, status: resposta.status });
      return resposta.ok;
    },
  };
}
