import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Feedback } from '@/../app/_components/Feedback';
import { Shell } from '@/../app/_components/Shell';
import { FormularioDeCredencial } from '@/../app/config/agentes/FormularioDeCredencial';
import { revogarCredencial } from '@/../app/config/agentes/acoes';
import { modules } from '@/composition';
import { VALIDADE_MAXIMA_EM_DIAS, VALIDADE_PADRAO_EM_DIAS, situacaoDaCredencial, type SituacaoDaCredencial } from '@/modules/ia/domain/credencial';
import { canAdminister } from '@/modules/identity/domain/user';
import { vocabularioDe } from '@/modules/organizations/domain/vocabulario';
import { requireContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

const ROTULO_DA_SITUACAO: Record<SituacaoDaCredencial, string> = {
  ativa: 'Ativa',
  vencida: 'Vencida',
  revogada: 'Revogada',
};

const dia = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });

export default async function CredenciaisDeAgentePage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; feito?: string }>;
}) {
  const ctx = await requireContext();
  if (ctx.clientIds !== null || !canAdminister(ctx.role)) redirect('/config');
  const params = await searchParams;

  const organization = ctx.organization;
  const quem = { organizationId: organization.id, papelDeQuemAge: ctx.role };
  const [listadas, clientes] = await Promise.all([modules().ia.credenciais.listar(quem), modules().clients.list(organization.id)]);
  const credenciais = listadas.ok ? listadas.value : [];
  const agora = new Date();
  const vocabulario = vocabularioDe(organization.type);

  return (
    <Shell title="Credenciais de agente" organization={organization} active="/config">
      <div className="page__head">
        <div>
          <div className="page__title">Credenciais de agente</div>
          <div className="page__sub">
            Cada credencial deixa um agente ler, por MCP, só o que você marcar desta organização. <Link href="/config">Voltar às configurações</Link>
          </div>
        </div>
      </div>

      <Feedback message={params.erro} tone="error" />
      <Feedback message={params.feito} tone="ok" />

      <div className="card">
        <div className="card__head">Nova credencial</div>
        <FormularioDeCredencial
          ferramentas={modules().ia.registro.nomes()}
          clientes={clientes.map((cliente) => ({ id: cliente.id, nome: cliente.name }))}
          rotuloDosClientes={`${vocabulario.cliente}s`}
          validadePadrao={VALIDADE_PADRAO_EM_DIAS}
          validadeMaxima={VALIDADE_MAXIMA_EM_DIAS}
        />
      </div>

      <div className="card">
        <div className="card__head">Credenciais</div>
        {credenciais.length === 0 ? (
          <p className="muted">Nenhuma credencial criada.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">Credencial</th>
                  <th scope="col">Alcance</th>
                  <th scope="col">Ferramentas</th>
                  <th scope="col">Vence em</th>
                  <th scope="col">Último uso</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Ação</th>
                </tr>
              </thead>
              <tbody>
                {credenciais.map((credencial) => {
                  const situacao = situacaoDaCredencial(credencial, agora);
                  return (
                    <tr key={credencial.id}>
                      <td className="strong">{credencial.nome}</td>
                      <td className="mono muted">{credencial.rotulo}</td>
                      <td className="muted">
                        {credencial.clienteIds ? `${credencial.clienteIds.length} ${vocabulario.cliente}(s)` : 'Organização inteira'}
                      </td>
                      <td className="mono muted">{credencial.ferramentas.join(', ')}</td>
                      <td className="muted">{dia.format(credencial.venceEm)}</td>
                      <td className="muted">{credencial.ultimoUsoEm ? dia.format(credencial.ultimoUsoEm) : 'Nunca'}</td>
                      <td>{ROTULO_DA_SITUACAO[situacao]}</td>
                      <td>
                        {situacao === 'ativa' ? (
                          <form action={revogarCredencial}>
                            <input type="hidden" name="credencialId" value={credencial.id} />
                            <button className="btn btn--compacto" type="submit">
                              Revogar
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
