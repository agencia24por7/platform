import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/../app/_components/Shell';
import { Marca } from '@/../app/_components/Marca';
import { Feedback } from '@/../app/_components/Feedback';
import { modules } from '@/composition';
import {
  PARA_QUE_SERVE,
  ROTULO_DA_PLATAFORMA,
  type Connection,
  type Platform,
} from '@/modules/connections/domain/connection';
import { falaOauth, isConfigured } from '@/modules/connections/domain/oauth';
import { credenciaisDaPlataforma } from '@/modules/connections/application/credenciaisOauth';
import { usaChaveDeApi } from '@/modules/connections/domain/chaveDeApi';
import { requireContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const ORDEM_DOS_CONECTORES: readonly Platform[] = [
  'google',
  'meta',
  'ga4',
  'gtm',
  'pixel',
  'leadads',
  'searchconsole',
  'youtube',
  'gbp',
  'rdstation',
  'apify',
  'zapi',
  'whatsapp',
];

const PESO_DO_ESTADO: Record<Connection['status'], number> = {
  revoked: 4,
  reauth_pending: 3,
  degraded: 2,
  expiring: 1,
  active: 0,
};

const PONTO_DO_ESTADO: Record<Connection['status'], string> = {
  active: 'dot--ok',
  expiring: 'dot--warn',
  degraded: 'dot--warn',
  reauth_pending: 'dot--warn',
  revoked: 'dot--danger',
};

function estadoDoConector(conexoes: readonly Connection[]): {
  readonly ponto: string;
  readonly texto: string;
} | null {
  if (conexoes.length === 0) return null;
  const pior = [...conexoes].sort((a, b) => PESO_DO_ESTADO[b.status] - PESO_DO_ESTADO[a.status])[0]!;
  const ativas = conexoes.filter((conexao) => conexao.status === 'active').length;
  const texto =
    ativas === conexoes.length
      ? `${ativas} conexão${ativas > 1 ? 'es' : ''} ativa${ativas > 1 ? 's' : ''}`
      : `${ativas} de ${conexoes.length} conexões ativas`;
  return { ponto: PONTO_DO_ESTADO[pior.status], texto };
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  const organization = ctx.organization;
  const { aviso } = await searchParams;

  const connections = await modules().connections.listConnections(organization.id);
  const conexoesPor = (platform: Platform) =>
    connections.filter((conexao) => conexao.platform === platform);

  return (
    <Shell title="Conexões" organization={organization} active="/integracoes">
      <div className="page__head">
        <div>
          <div className="page__title">Conexões</div>
          <div className="page__sub">
            Um card por conector. Clique para abrir as configurações. O segredo vive cifrado (Cloud KMS)
            no cofre de tokens do app; o n8n só recebe um token de curta duração na hora de coletar.
          </div>
        </div>
      </div>

      <Feedback message={aviso} tone="info" />

      <div className="grid grid--3">
        {ORDEM_DOS_CONECTORES.map((plataforma) => {
          const conexoes = conexoesPor(plataforma);
          const estado = estadoDoConector(conexoes);
          const prontoParaAutorizar =
            !falaOauth(plataforma) ||
            isConfigured(credenciaisDaPlataforma(plataforma), plataforma);

          return (
            <Link key={plataforma} className="conector" href={`/integracoes/conector/${plataforma}`}>
              <div className="conector__topo">
                <span className="conector__marca">
                  <Marca platform={plataforma} />
                </span>
                <span className="conector__nome">{ROTULO_DA_PLATAFORMA[plataforma]}</span>
              </div>
              <span className="conector__sub">{PARA_QUE_SERVE[plataforma]}</span>
              <span className="conector__estado">
                {estado ? (
                  <>
                    <span className={`dot ${estado.ponto}`} />
                    {estado.texto}
                  </>
                ) : !prontoParaAutorizar ? (
                  <span className="pill pill--warn">falta configurar o app</span>
                ) : usaChaveDeApi(plataforma) ? (
                  'sem conexão · entra por chave de API'
                ) : (
                  'sem conexão'
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </Shell>
  );
}
