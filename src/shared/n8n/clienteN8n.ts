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

export type ClienteN8n = {
  criar(corpo: CorpoDeWorkflow, contexto: Record<string, string>): Promise<string | null>;
  remover(workflowId: string, contexto: Record<string, string>): Promise<boolean>;
};

const TENTATIVAS_DE_REMOCAO = 10;

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

  return {
    async criar(corpo, contexto) {
      try {
        const resposta = await chamar('POST', 'workflows', corpo);
        if (!resposta.ok) {
          logger.error('n8n.workflow.criar.falhou', { ...contexto, status: resposta.status });
          return null;
        }

        const criado = (await resposta.json()) as { id?: string };
        if (!criado.id) return null;

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
  };
}
