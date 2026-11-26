import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EstadoComIcone } from '@/../app/_components/EstadoComIcone';
import { MensagemDaUrl } from '@/../app/_components/MensagemDaUrl';
import { Shell } from '@/../app/_components/Shell';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import { FormularioDeCredencial } from '@/../app/config/agentes/FormularioDeCredencial';
import { revogarCredencial } from '@/../app/config/agentes/acoes';
import { modules } from '@/composition';
import { VALIDADE_MAXIMA_EM_DIAS, VALIDADE_PADRAO_EM_DIAS, situacaoDaCredencial } from '@/modules/ia/domain/credencial';
import { apresentarSituacaoDaCredencial, dataCurtaDaCredencial, rotuloDaFerramenta } from '@/modules/ia/interface/apresentacao';
import { canAdminister } from '@/modules/identity/domain/user';
import { vocabularioDe } from '@/modules/organizations/domain/vocabulario';
import { requireContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Credenciais de agente' };

export default async function CredenciaisDeAgentePage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; feito?: string; n?: string }>;
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
      <div className="tela-config">
        <div className="page__head">
          <div>
            <h1 className="page__title">Credenciais de agente</h1>
            <p className="page__sub">
              Cada credencial deixa um agente ler, por MCP, só o que você marcar desta organização. <Link href="/config">Voltar às configurações</Link>
            </p>
          </div>
        </div>

        <MensagemDaUrl erro={params.erro} feito={params.feito} n={params.n} />

        <section className="card" aria-labelledby="t-nova">
          <h2 className="card__head card__title" id="t-nova">
            Nova credencial
          </h2>
          <div className="card__body">
            <p className="card__ajuda">Dê um nome, marque o que o agente pode usar e até quando. O segredo aparece uma única vez, logo após criar.</p>
          </div>
          <FormularioDeCredencial
            ferramentas={modules().ia.registro.nomes()}
            clientes={clientes.map((cliente) => ({ id: cliente.id, nome: cliente.name }))}
            rotuloDosClientes={`${vocabulario.cliente}s`}
            validadePadrao={VALIDADE_PADRAO_EM_DIAS}
            validadeMaxima={VALIDADE_MAXIMA_EM_DIAS}
          />
        </section>

        <section className="card" aria-labelledby="t-lista">
          <h2 className="card__head card__title" id="t-lista">
            Credenciais criadas
          </h2>
          {credenciais.length === 0 ? (
            <div className="vazio">
              <p className="card__ajuda">Nenhuma credencial criada ainda. Use o formulário acima para criar a primeira e entregá-la ao agente.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table table--credenciais">
                <thead>
                  <tr>
                    <th scope="col">Credencial</th>
                    <th scope="col">Alcance</th>
                    <th scope="col">Ferramentas</th>
                    <th scope="col">Datas</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {credenciais.map((credencial) => {
                    const situacao = situacaoDaCredencial(credencial, agora);
                    return (
                      <tr key={credencial.id} className={situacao === 'ativa' ? undefined : 'inativa'}>
                        <td>
                          <div className="duas">
                            <span className="strong">{credencial.nome}</span>
                            <span className="mono">{credencial.rotulo}</span>
                          </div>
                        </td>
                        <td className="muted">
                          {credencial.clienteIds ? `${credencial.clienteIds.length} ${vocabulario.cliente}(s)` : 'Organização inteira'}
                        </td>
                        <td>
                          <div className="config-etiquetas">
                            {credencial.ferramentas.map((ferramenta) => (
                              <span key={ferramenta} className="pill" title={ferramenta}>
                                {rotuloDaFerramenta(ferramenta)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="muted">
                          <div className="duas">
                            <span>Vence {dataCurtaDaCredencial(credencial.venceEm)}</span>
                            <span>Uso {credencial.ultimoUsoEm ? dataCurtaDaCredencial(credencial.ultimoUsoEm) : 'nunca'}</span>
                          </div>
                        </td>
                        <td>
                          <EstadoComIcone estado={apresentarSituacaoDaCredencial(situacao)} />
                        </td>
                        <td>
                          {situacao === 'ativa' ? (
                            <ConfirmarAcao
                              gatilho="Revogar"
                              rotuloDoGatilho={`Revogar a credencial ${credencial.nome}`}
                              titulo={`Revogar a credencial “${credencial.nome}”?`}
                              descricao="O agente que usa esta credencial perde o acesso na hora. Não dá para desfazer: seria preciso criar outra."
                              confirmar="Revogar credencial"
                              pendente="Revogando…"
                              action={revogarCredencial}
                            >
                              <input type="hidden" name="credencialId" value={credencial.id} />
                            </ConfirmarAcao>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}
