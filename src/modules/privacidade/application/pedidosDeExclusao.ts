import {
  CODIGO_DE_CONFIRMACAO,
  lerSignedRequest,
  novoCodigoDeConfirmacao,
  pseudonimoDoUsuarioDaMeta,
  type MotivoDeRecusa,
} from '@/modules/privacidade/domain/pedidoDeExclusaoMeta';

export type SituacaoDoPedido = {
  readonly situacao: 'pendente' | 'em_andamento' | 'concluido';
  readonly criadoEm: Date;
  readonly concluidoEm: Date | null;
};

export type PedidoNaOrganizacao = {
  readonly codigo: string;
  readonly situacao: SituacaoDoPedido['situacao'];
  readonly criadoEm: Date;
  readonly connectionId: string;
};

export type PedidosDeExclusaoRepository = {
  registrarDaMeta(input: {
    readonly usuarioHash: string;
    readonly usuarioExterno: string;
    readonly codigo: string;
  }): Promise<{ readonly codigo: string; readonly situacao: SituacaoDoPedido['situacao']; readonly novo: boolean }>;
  situacao(codigo: string): Promise<SituacaoDoPedido | null>;
  abertosDaOrganizacao(organizationId: string): Promise<readonly PedidoNaOrganizacao[]>;
};

export type ConfiguracaoDosPedidos = {
  readonly segredoDoApp: string | undefined;
  readonly pimenta: string;
  readonly enderecoPublico: string;
  readonly agoraEmSegundos?: () => number;
  readonly novoCodigo?: () => string;
};

export type RespostaParaAMeta = { readonly url: string; readonly confirmation_code: string };

export type RegistroDoPedido =
  | { readonly ok: true; readonly resposta: RespostaParaAMeta; readonly novo: boolean }
  | { readonly ok: false; readonly motivo: MotivoDeRecusa | 'app_nao_configurado' };

export type PedidosDeExclusaoService = {
  registrarDaMeta(signedRequest: string): Promise<RegistroDoPedido>;
  situacao(codigo: string): Promise<SituacaoDoPedido | null>;
  abertosDaOrganizacao(organizationId: string): Promise<readonly PedidoNaOrganizacao[]>;
};

export const caminhoDaSituacao = (codigo: string): string => `/exclusao-de-dados/status/${encodeURIComponent(codigo)}`;

export function createPedidosDeExclusaoService(
  repositorio: PedidosDeExclusaoRepository,
  configuracao: ConfiguracaoDosPedidos,
): PedidosDeExclusaoService {
  const agora = configuracao.agoraEmSegundos ?? (() => Math.floor(Date.now() / 1000));
  const novoCodigo = configuracao.novoCodigo ?? novoCodigoDeConfirmacao;

  return {
    async registrarDaMeta(signedRequest) {
      if (!configuracao.segredoDoApp) return { ok: false, motivo: 'app_nao_configurado' };
      const leitura = lerSignedRequest(signedRequest, configuracao.segredoDoApp, agora());
      if (!leitura.ok) return { ok: false, motivo: leitura.motivo };

      const registro = await repositorio.registrarDaMeta({
        usuarioHash: pseudonimoDoUsuarioDaMeta(leitura.usuarioDaMeta, configuracao.pimenta),
        usuarioExterno: leitura.usuarioDaMeta,
        codigo: novoCodigo(),
      });
      const url = new URL(caminhoDaSituacao(registro.codigo), configuracao.enderecoPublico).toString();
      return { ok: true, novo: registro.novo, resposta: { url, confirmation_code: registro.codigo } };
    },

    async situacao(codigo) {
      if (!CODIGO_DE_CONFIRMACAO.test(codigo)) return null;
      return repositorio.situacao(codigo);
    },

    abertosDaOrganizacao: (organizationId) => repositorio.abertosDaOrganizacao(organizationId),
  };
}
