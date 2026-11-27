import type { Plataforma } from '../plano.ts';
import { esquemaCatalogoDeCampos, type CampoDoCatalogo, type CatalogoDeCampos } from './tipos.ts';

const campo = (
  chave: string,
  secao: string,
  tipoDoValor: CampoDoCatalogo['tipoDoValor'],
  obrigatorio: boolean,
  opcoes?: readonly string[],
): CampoDoCatalogo => ({ chave, secao, obrigatorio, tipoDoValor, ...(opcoes ? { opcoes: [...opcoes] } : {}) });

const CATALOGO_DA_META: CatalogoDeCampos = {
  plataforma: 'meta',
  versaoDaApi: 'marketing-api-v21.0',
  objetivos: ['leads', 'vendas', 'trafego', 'reconhecimento', 'engajamento', 'mensagens'],
  campos: [
    campo('objetivo_da_campanha', 'objetivo', 'escolha', true, ['OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT']),
    campo('meta_de_otimizacao', 'objetivo', 'escolha', true, ['LEAD_GENERATION', 'OFFSITE_CONVERSIONS', 'LINK_CLICKS', 'LANDING_PAGE_VIEWS', 'REACH', 'IMPRESSIONS', 'CONVERSATIONS', 'THRUPLAY']),
    campo('destino_do_anuncio', 'objetivo', 'escolha', true, ['WEBSITE', 'WHATSAPP', 'MESSENGER', 'INSTAGRAM_DIRECT', 'ON_AD']),
    campo('localizacoes', 'publico', 'lista', true),
    campo('idade_minima', 'publico', 'numero', true),
    campo('idade_maxima', 'publico', 'numero', true),
    campo('interesses', 'publico', 'lista', false),
    campo('publicos_personalizados', 'publico', 'lista', false),
    campo('exclusoes_de_publico', 'publico', 'lista', false),
    campo('tipo_de_orcamento', 'orcamento_e_lances', 'escolha', true, ['DAILY', 'LIFETIME']),
    campo('valor_do_orcamento', 'orcamento_e_lances', 'numero', true),
    campo('estrategia_de_lance', 'orcamento_e_lances', 'escolha', true, ['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS']),
    campo('valor_do_limite_de_lance', 'orcamento_e_lances', 'numero', false),
    campo('data_de_inicio', 'programacao', 'texto', true),
    campo('data_de_fim', 'programacao', 'texto', false),
    campo('posicionamentos_automaticos', 'posicionamentos', 'booleano', true),
    campo('posicionamentos_manuais', 'posicionamentos', 'lista', false),
    campo('url_de_destino', 'conversao', 'texto', true),
    campo('parametros_de_url', 'conversao', 'texto', true),
    campo('evento_de_conversao', 'conversao', 'texto', false),
    campo('numero_do_whatsapp', 'conversao', 'texto', false),
    campo('formato_do_anuncio', 'copy', 'escolha', true, ['IMAGEM', 'VIDEO', 'CARROSSEL', 'COLECAO']),
    campo('texto_principal', 'copy', 'texto', true),
    campo('titulo', 'copy', 'texto', true),
    campo('descricao', 'copy', 'texto', false),
    campo('chamada_para_acao', 'copy', 'escolha', true, ['LEARN_MORE', 'SIGN_UP', 'CONTACT_US', 'WHATSAPP_MESSAGE', 'SHOP_NOW', 'GET_QUOTE']),
    campo('variavel_do_teste', 'testes_ab', 'texto', false),
    campo('meta_de_resultado', 'metas', 'texto', true),
    campo('custo_alvo', 'metas', 'numero', false),
  ],
};

export const CATALOGOS_DISPONIVEIS: readonly CatalogoDeCampos[] = [CATALOGO_DA_META].map((catalogo) => esquemaCatalogoDeCampos.parse(catalogo));

export function plataformasComCatalogo(catalogos: readonly CatalogoDeCampos[] = CATALOGOS_DISPONIVEIS): readonly Plataforma[] {
  return catalogos.map((catalogo) => catalogo.plataforma);
}

export function catalogosDasPlataformas(
  plataformas: readonly Plataforma[],
  catalogos: readonly CatalogoDeCampos[] = CATALOGOS_DISPONIVEIS,
): readonly CatalogoDeCampos[] {
  return catalogos.filter((catalogo) => plataformas.includes(catalogo.plataforma));
}
