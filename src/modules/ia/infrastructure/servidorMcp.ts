import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { executarFerramenta, type EscopoDoAgente, type FerramentaRegistrada, type RegistroDeFerramentas } from '../domain/ferramenta.ts';

export const CORPO_MAXIMO_DO_MCP = 64 * 1024;
const NOME_DO_SERVIDOR = 'orla';
const VERSAO_DO_SERVIDOR = '1.0.0';
const FALHA_GENERICA = 'A ferramenta não pôde ser executada agora.';

export type ManipuladorMcp = (request: Request, escopo: EscopoDoAgente) => Promise<Response>;

type AvisoDeFalha = (evento: string, dados: Record<string, unknown>) => void;

type ResultadoDaFerramenta = { content: { type: 'text'; text: string }[]; isError?: boolean };

function texto(conteudo: string, erro = false): ResultadoDaFerramenta {
  return erro ? { content: [{ type: 'text', text: conteudo }], isError: true } : { content: [{ type: 'text', text: conteudo }] };
}

async function executar(ferramenta: FerramentaRegistrada, entrada: unknown, escopo: EscopoDoAgente, avisar: AvisoDeFalha): Promise<ResultadoDaFerramenta> {
  try {
    const resultado = await executarFerramenta(ferramenta, entrada, escopo);
    return resultado.ok ? texto(JSON.stringify(resultado.value)) : texto(resultado.error.message, true);
  } catch (erro) {
    avisar('ia.mcp.ferramenta_falhou', {
      ferramenta: ferramenta.nome,
      requestId: escopo.requestId,
      erro: erro instanceof Error ? erro.name : 'desconhecido',
    });
    return texto(FALHA_GENERICA, true);
  }
}

function servidorDoEscopo(registro: RegistroDeFerramentas, escopo: EscopoDoAgente | null, avisar: AvisoDeFalha): McpServer {
  const servidor = new McpServer({ name: NOME_DO_SERVIDOR, version: VERSAO_DO_SERVIDOR });
  if (!escopo) return servidor;
  for (const ferramenta of registro.permitidas(escopo)) {
    servidor.registerTool(
      ferramenta.nome,
      {
        description: ferramenta.descricao,
        inputSchema: ferramenta.entrada,
        annotations: { readOnlyHint: ferramenta.classe === 'leitura', destructiveHint: false, openWorldHint: false },
      },
      (entrada: unknown) => executar(ferramenta, entrada, escopo, avisar),
    );
  }
  return servidor;
}

function escopoDe(extra: Record<string, unknown> | undefined): EscopoDoAgente | null {
  const escopo = extra?.escopo;
  return escopo && typeof escopo === 'object' ? (escopo as EscopoDoAgente) : null;
}

export function criarManipuladorMcp(registro: RegistroDeFerramentas, avisar: AvisoDeFalha): ManipuladorMcp {
  const { fetch: atender } = createMcpHandler((contexto) => servidorDoEscopo(registro, escopoDe(contexto.authInfo?.extra), avisar), {
    maxRequestBodySize: CORPO_MAXIMO_DO_MCP,
    maxSubscriptions: 1,
    onerror: (erro) => avisar('ia.mcp.erro_de_protocolo', { erro: erro.name }),
  });

  return (request, escopo) =>
    atender(request, {
      authInfo: { token: 'redigido', clientId: escopo.credencialId, scopes: [...escopo.ferramentas], extra: { escopo } },
    });
}
