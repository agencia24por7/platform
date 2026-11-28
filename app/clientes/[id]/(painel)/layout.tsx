import Link from 'next/link';
import type { ReactNode } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { Shell } from '@/../app/_components/Shell';
import { AbasDoCliente } from '@/../app/clientes/[id]/_componentes/AbasDoCliente';
import { AcaoPrincipalDoCabecalho } from '@/../app/clientes/[id]/_componentes/AcaoPrincipalDoCabecalho';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import { CabecalhoDoCliente } from '@/../app/clientes/[id]/_componentes/CabecalhoDoCliente';
import { MenuMais } from '@/../app/clientes/[id]/_componentes/MenuMais';
import { modules } from '@/composition';
import { carregarPainel, carregarProntidao, carregarVersaoDaLogo } from '@/../app/clientes/[id]/_dados';
import { mudarSituacao } from '@/../app/clientes/[id]/(painel)/conexoes/acoes';
import { EFEITO_DA_SITUACAO, ROTULO_DA_SITUACAO, SITUACOES, mudancaPermitida } from '@/modules/clients/domain/ciclo';
import { visaoDoCabecalho } from '@/modules/clients/domain/painel/cabecalho';
import { acaoPrincipal } from '@/modules/clients/domain/painel/prontidao';
import { podeCadastrarCliente } from '@/modules/clients/domain/painel/permissoes';
import { estadoDoBlocoDeRegras, podeRegistrarOuMexer } from '@/modules/clients/domain/painel/regras';
import { podeVerAEstrategia } from '@/modules/strategy/domain/papeis';
import { noVocabularioDe, vocabularioDe } from '@/modules/organizations/domain/vocabulario';

export const dynamic = 'force-dynamic';

async function carregarProntidaoDeRegras(organizationId: string, clientId: string) {
  try {
    const resultado = await modules().regras.prontidao({ organizationId, clientId });
    return resultado.ok ? resultado.value : null;
  } catch {
    return null;
  }
}

export default async function LayoutDoCliente({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { ctx, cliente, podeEditar, organizacaoInteira } = await carregarPainel(id);
  const [prontidao, regras, versaoDaLogo] = await Promise.all([
    carregarProntidao(ctx.organization.id, cliente.id, ctx.role),
    carregarProntidaoDeRegras(ctx.organization.id, cliente.id),
    carregarVersaoDaLogo(ctx.organization.id, cliente.id, ctx.role),
  ]);
  const blocoDeRegras = regras ? estadoDoBlocoDeRegras(regras) : null;
  const principal = prontidao ? acaoPrincipal(prontidao.acoes, cliente.id, { podeEditar, organizacaoInteira, tipo: ctx.organization.type }) : null;
  const vocabulario = vocabularioDe(ctx.organization.type);
  const permitidas = SITUACOES.filter((valor) => mudancaPermitida(ctx.role, valor) === null);
  const podeArquivar = cliente.status !== 'archived' && permitidas.includes('archived');
  const opcoes = permitidas.filter((valor) => valor !== 'archived' || cliente.status === 'archived');
  const contadorDeRegras = regras ? regras.essenciaisFaltando.length + regras.propostasPendentes + regras.aRevisar : 0;
  const cabecalho = visaoDoCabecalho({
    cliente,
    prontidao,
    lacunasDeRegras: regras?.essenciaisFaltando ?? [],
    podeDefinirLimite: podeRegistrarOuMexer(ctx.role, 'limite'),
    podeEditar,
    hashDaLogo: versaoDaLogo,
  });

  return (
    <Shell title={cliente.name} organization={ctx.organization} active="/clientes">
      <CabecalhoDoCliente
        visao={cabecalho}
        migalhas={{ rotulo: vocabulario.clientes, href: '/clientes' }}
        rotuloDoResumo={vocabulario.resumoDoCliente}
        aviso={
          cliente.status !== 'active' ? (
            <div className={`faixa-de-estado faixa-de-estado--${cliente.status}`} role="status">
              <strong>
                {noVocabularioDe(ctx.organization.type, 'Cliente')} {ROTULO_DA_SITUACAO[cliente.status].toLowerCase()}.
              </strong>{' '}
              {noVocabularioDe(ctx.organization.type, EFEITO_DA_SITUACAO[cliente.status])}
            </div>
          ) : null
        }
        acoes={
          <>
            {principal ? <AcaoPrincipalDoCabecalho href={principal.href} rotulo={principal.rotulo} titulo={principal.titulo} ehConexao={principal.ehConexao} /> : null}
            <MenuMais rotulo="Situação">
              {ctx.organization.type === 'advertiser' && organizacaoInteira && podeCadastrarCliente(ctx.organization.type, ctx.role) ? (
                <div className="menu-mais__bloco">
                  <Link className="btn" href="/clientes/novo">
                    Novo negócio
                  </Link>
                </div>
              ) : null}
              {podeEditar ? (
                <form className="menu-mais__bloco" action={mudarSituacao}>
                  <input type="hidden" name="clientId" value={cliente.id} />
                  <label className="field">
                    <span className="field__label">Situação</span>
                    <select className="select" name="situacao" defaultValue={cliente.status}>
                      {opcoes.map((valor) => (
                        <option key={valor} value={valor}>
                          {ROTULO_DA_SITUACAO[valor]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="field__hint">{noVocabularioDe(ctx.organization.type, EFEITO_DA_SITUACAO[cliente.status])}</p>
                  <BotaoDeEnvio className="btn" pendente="Aplicando…">
                    Aplicar
                  </BotaoDeEnvio>
                </form>
              ) : null}
              {podeEditar && podeArquivar ? (
                <div className="menu-mais__bloco">
                  <ConfirmarAcao
                    gatilho="Arquivar"
                    rotuloDoGatilho={`Arquivar ${cliente.name}`}
                    titulo={`Arquivar ${cliente.name}?`}
                    descricao={noVocabularioDe(ctx.organization.type, EFEITO_DA_SITUACAO.archived)}
                    confirmar="Arquivar"
                    pendente="Arquivando…"
                    action={mudarSituacao}
                  >
                    <input type="hidden" name="clientId" value={cliente.id} />
                    <input type="hidden" name="situacao" value="archived" />
                  </ConfirmarAcao>
                  <p className="field__hint">Quem administra pode apagar o cliente; aqui o arquivo mantém o histórico.</p>
                </div>
              ) : null}
            </MenuMais>
          </>
        }
      />
      <AbasDoCliente clienteId={cliente.id} blocos={{ conexoes: prontidao?.conexoes ?? null, contexto: prontidao?.contexto ?? null, regras: blocoDeRegras, estrategia: null, atividade: null }} contadores={{ regras: contadorDeRegras }} abasOcultas={podeVerAEstrategia(ctx.role) ? [] : ['estrategia']} />
      <div className="cliente-aba">{children}</div>
    </Shell>
  );
}
