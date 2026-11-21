import type { EntradaSemSelo } from '../../domain/entrada.ts';
import { fontesVinculadas, type ConexaoDoInventario, type FonteDoInventario } from '../../domain/inventario.ts';
import { limparTextoLivre } from '../../domain/privacidade.ts';
import { SAUDE_OK, type ContextoDeDescoberta, type ProvedorDeCatalogo } from '../../domain/provedor.ts';
import { conectorDe, rotuloDaPlataforma, TABELAS_DO_REGISTRO } from '../../dados/registro.ts';
import { SENSIBILIDADE_DE_NEGOCIO, situacaoDasFontes } from './comum.ts';

const VERSAO = 1;
const ID = 'conexoes';

const ROTULO_DO_STATUS: Readonly<Record<string, string>> = {
  active: 'ativa',
  expiring: 'perto de expirar',
  degraded: 'degradada',
  revoked: 'revogada',
  reauth_pending: 'aguardando reautorização',
};

const TIPO_DE_RECURSO: Readonly<Record<string, string>> = {
  ad_account: 'Conta de anúncio',
  connection_account: 'Recurso',
};

function entradaDaConexao(ctx: ContextoDeDescoberta, conexao: ConexaoDoInventario, fontes: readonly FonteDoInventario[]): EntradaSemSelo {
  const plataforma = rotuloDaPlataforma(conexao.platform);
  const status = ROTULO_DO_STATUS[conexao.status] ?? conexao.status;
  const expira = conexao.expiraEm ? ` Expira em ${conexao.expiraEm.toISOString().slice(0, 10)}.` : '';
  return {
    urn: ctx.urn('conexao', conexao.id),
    tipo: 'conexao',
    id: conexao.id,
    titulo: `Conexão ${plataforma}: ${limparTextoLivre(conexao.rotulo)}`,
    descricao: `Autorização de acesso ao ${plataforma} usada para coletar ${fontes.length} recurso(s) deste cliente. Status: ${status}.${expira} Não expõe credencial.`,
    provedor: ID,
    plataforma: conexao.platform,
    referencia: { sistema: 'postgres', local: `integrations.connections/${conexao.id}` },
    esquema: null,
    grao: null,
    cobertura: null,
    frescor: null,
    qualidade: {
      completude: null,
      avisos: ['reauth_pending', 'revoked', 'degraded'].includes(conexao.status) ? [`Conexão ${status}: a coleta das fontes desta conexão para.`] : [],
    },
    acesso: { tipo: 'status' },
    sensibilidade: SENSIBILIDADE_DE_NEGOCIO,
    epistemico: null,
    valorResumido: status,
    tags: ['conexao', `plataforma:${conexao.platform}`, `status:${conexao.status}`],
    relacoes: fontes.map((fonte) => ({ tipo: 'autoriza', urn: ctx.urn('fonte', fonte.id) })),
    versao: VERSAO,
  };
}

function entradaDaFonte(ctx: ContextoDeDescoberta, fonte: FonteDoInventario): EntradaSemSelo {
  const plataforma = rotuloDaPlataforma(fonte.platform);
  const { cobertura, frescor } = situacaoDasFontes([fonte], ctx.inventario, ctx.agora);
  const tabelas = TABELAS_DO_REGISTRO.filter((t) => t.plataformas.includes(fonte.platform)).map((t) => t.nome);
  const conector = conectorDe(fonte.platform);
  const coleta = conector?.coletavel === false ? ' Fora da coleta automática.' : '';
  const avisos = [
    ...(fonte.coletaHabilitada ? [] : ['Coleta desabilitada para esta conta.']),
    ...(frescor.status === 'parado' ? ['Coleta parada: sem coleta concluída recente.'] : []),
    ...(frescor.status === 'atrasado' ? ['Coleta atrasada.'] : []),
  ];
  return {
    urn: ctx.urn('fonte', fonte.id),
    tipo: 'fonte',
    id: fonte.id,
    titulo: `${plataforma}: ${limparTextoLivre(fonte.nome)}`,
    descricao: `${TIPO_DE_RECURSO[fonte.fonteTipo] ?? 'Recurso'} do ${plataforma} (id ${fonte.externalId}) vinculado ao cliente, que alimenta ${tabelas.length} tabela(s) de dados.${coleta}`,
    provedor: ID,
    plataforma: fonte.platform,
    referencia: { sistema: 'postgres', local: `integrations.${fonte.fonteTipo === 'ad_account' ? 'ad_accounts' : 'connection_accounts'}/${fonte.id}` },
    esquema: null,
    grao: null,
    cobertura,
    frescor,
    qualidade: { completude: null, avisos },
    acesso: { tipo: 'status' },
    sensibilidade: SENSIBILIDADE_DE_NEGOCIO,
    epistemico: null,
    valorResumido: fonte.moeda ? `moeda ${fonte.moeda}${fonte.fuso ? `, fuso ${fonte.fuso}` : ''}` : null,
    tags: ['fonte', `plataforma:${fonte.platform}`, `frescor:${frescor.status}`],
    relacoes: [
      { tipo: 'autorizada_por', urn: ctx.urn('conexao', fonte.conexaoId) },
      ...tabelas.map((tabela) => ({ tipo: 'alimenta', urn: ctx.urn('tabela_de_dados', tabela) })),
    ],
    versao: VERSAO,
  };
}

export const provedorDeConexoes: ProvedorDeCatalogo = {
  id: ID,
  versao: VERSAO,
  descricao: 'Conexões (autorizações) e fontes vinculadas ao cliente, com status e frescor da coleta. Nunca expõe credencial.',
  fase: 'primaria',
  tiposDeclarados: ['conexao', 'fonte'],
  descobrir(ctx) {
    const fontes = fontesVinculadas(ctx.inventario);
    const conexoes = ctx.inventario.conexoesDaOrganizacao.filter((c) => fontes.some((f) => f.conexaoId === c.id));
    return [
      ...conexoes.map((conexao) => entradaDaConexao(ctx, conexao, fontes.filter((f) => f.conexaoId === conexao.id))),
      ...fontes.filter((f) => conexoes.some((c) => c.id === f.conexaoId)).map((fonte) => entradaDaFonte(ctx, fonte)),
    ];
  },
  saude: () => SAUDE_OK,
};
