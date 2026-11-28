import Link from 'next/link';
import type { ReactNode } from 'react';
import { BotaoDeEnvio } from '@/../app/_components/BotaoDeEnvio';
import { Shell } from '@/../app/_components/Shell';
import { AbasDoCliente } from '@/../app/clientes/[id]/_componentes/AbasDoCliente';
import { AcaoPrincipalDoCabecalho } from '@/../app/clientes/[id]/_componentes/AcaoPrincipalDoCabecalho';
import { ConfirmarAcao } from '@/../app/clientes/[id]/_componentes/ConfirmarAcao';
import { Icone } from '@/../app/clientes/[id]/_componentes/Icones';
import { MenuMais } from '@/../app/clientes/[id]/_componentes/MenuMais';
import { modules } from '@/composition';
import { carregarPainel, carregarProntidao } from '@/../app/clientes/[id]/_dados';
import { mudarSituacao } from '@/../app/clientes/[id]/(painel)/conexoes/acoes';
import { EFEITO_DA_SITUACAO, ROTULO_DA_SITUACAO, SITUACOES, mudancaPermitida } from '@/modules/clients/domain/ciclo';
import { acaoPrincipal, ROTULO_DO_VEREDITO, type Veredito } from '@/modules/clients/domain/painel/prontidao';
import { podeCadastrarCliente } from '@/modules/clients/domain/painel/permissoes';
import { rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { estadoDoBlocoDeRegras, podeRegistrarOuMexer } from '@/modules/clients/domain/painel/regras';
import { podeVerAEstrategia } from '@/modules/strategy/domain/papeis';
import { noVocabularioDe, vocabularioDe } from '@/modules/organizations/domain/vocabulario';

export const dynamic = 'force-dynamic';

const TOM_DA_SITUACAO = { active: 'pill--ok', paused: 'pill--warn', archived: '' } as const;
async function carregarProntidaoDeRegras(organizationId: string, clientId: string) {
  try {
    const resultado = await modules().regras.prontidao({ organizationId, clientId });
    return resultado.ok ? resultado.value : null;
  } catch {
    return null;
  }
}

const CLASSE_DO_VEREDITO: Record<Veredito, string> = { sim: 'pill--ok', parcial: 'pill--warn', nao: 'pill--danger' };

type Prontidao = NonNullable<Awaited<ReturnType<typeof carregarProntidao>>>;
type Regras = NonNullable<Awaited<ReturnType<typeof carregarProntidaoDeRegras>>>;

function FaixaDeProntidao({ prontidao, regras, clienteId, podeDefinir }: { readonly prontidao: Prontidao | null; readonly regras: Regras | null; readonly clienteId: string; readonly podeDefinir: boolean }) {
  const lacunasDoPlanejamento = prontidao && prontidao.veredito !== 'sim' ? prontidao.lacunas : [];
  const lacunasDeRegras = regras?.essenciaisFaltando ?? [];
  const total = lacunasDoPlanejamento.length + lacunasDeRegras.length;
  const veredito: Veredito | null = prontidao ? (prontidao.veredito === 'sim' && lacunasDeRegras.length > 0 ? 'parcial' : prontidao.veredito) : lacunasDeRegras.length > 0 ? 'parcial' : null;
  if (!veredito) return null;
  const icone = veredito === 'sim' ? 'ok' : veredito === 'parcial' ? 'parcial' : 'nao';
  const pill = (
    <span className={`pill ${CLASSE_DO_VEREDITO[veredito]}`}>
      <Icone nome={icone} tamanho={14} />
      {ROTULO_DO_VEREDITO[veredito]}
    </span>
  );
  if (total === 0) {
    return (
      <section className="prontidao" aria-label="Pronto para planejar">
        <span className="prontidao__titulo">Pronto para planejar</span>
        {pill}
      </section>
    );
  }
  return (
    <details className="prontidao prontidao--recolhivel">
      <summary className="prontidao__resumo">
        <span className="prontidao__titulo">Pronto para planejar</span>
        {pill}
        <span className="prontidao__contagem">
          {total} {total === 1 ? 'sugestão' : 'sugestões'}
        </span>
      </summary>
      <ul className="prontidao__lacunas" aria-label="O que falta">
        {lacunasDoPlanejamento.map((lacuna) => (
          <li key={lacuna.id}>{lacuna.titulo}</li>
        ))}
        {lacunasDeRegras.map((lacuna) => (
          <li key={lacuna.chave}>
            <span>{lacuna.nome}</span>
            {podeDefinir ? (
              <Link className="btn btn--compacto" href={rotaDoCliente(clienteId, 'regras', { secao: 'registrar', natureza: 'limite', definicao: lacuna.chave })}>
                Definir
              </Link>
            ) : (
              <span className="subtle xsmall">Peça a quem administra</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
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
  const [prontidao, regras] = await Promise.all([carregarProntidao(ctx.organization.id, cliente.id, ctx.role), carregarProntidaoDeRegras(ctx.organization.id, cliente.id)]);
  const blocoDeRegras = regras ? estadoDoBlocoDeRegras(regras) : null;
  const principal = prontidao ? acaoPrincipal(prontidao.acoes, cliente.id, { podeEditar, organizacaoInteira, tipo: ctx.organization.type }) : null;
  const vocabulario = vocabularioDe(ctx.organization.type);
  const permitidas = SITUACOES.filter((valor) => mudancaPermitida(ctx.role, valor) === null);
  const podeArquivar = cliente.status !== 'archived' && permitidas.includes('archived');
  const opcoes = permitidas.filter((valor) => valor !== 'archived' || cliente.status === 'archived');
  const contadorDeRegras = regras ? regras.essenciaisFaltando.length + regras.propostasPendentes + regras.aRevisar : 0;

  return (
    <Shell title={cliente.name} organization={ctx.organization} active="/clientes">
      <header className="cliente-topo">
        <nav className="migalhas" aria-label="Você está em">
          <Link href="/clientes">{vocabulario.clientes}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{cliente.name}</span>
        </nav>
        <div className="cliente-topo__linha">
          <div className="cliente-topo__quem">
            <span className="cliente-topo__monograma" aria-hidden="true">
              {cliente.name.trim().charAt(0).toUpperCase()}
            </span>
            <div className="cliente-topo__textos">
              <h1 className="page__title">{cliente.name}</h1>
              <div className="cliente-topo__fatos" role="group" aria-label={vocabulario.resumoDoCliente}>
                <span className={`pill ${TOM_DA_SITUACAO[cliente.status]}`}>
                  <span className="dot" />
                  {ROTULO_DA_SITUACAO[cliente.status]}
                </span>
                <span>
                  {[
                    cliente.businessModel === 'ecommerce' ? 'E-commerce' : 'Geração de leads',
                    cliente.segment ?? 'Sem segmento',
                    cliente.parentClientId ? 'Unidade de uma rede' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            </div>
          </div>
          <div className="cliente-topo__direita">
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
          </div>
        </div>
        {cliente.status !== 'active' ? (
          <div className={`faixa-de-estado faixa-de-estado--${cliente.status}`} role="status">
            <strong>{noVocabularioDe(ctx.organization.type, 'Cliente')} {ROTULO_DA_SITUACAO[cliente.status].toLowerCase()}.</strong> {noVocabularioDe(ctx.organization.type, EFEITO_DA_SITUACAO[cliente.status])}
          </div>
        ) : null}
        <FaixaDeProntidao prontidao={prontidao} regras={regras} clienteId={cliente.id} podeDefinir={podeRegistrarOuMexer(ctx.role, 'limite')} />
      </header>
      <AbasDoCliente clienteId={cliente.id} blocos={{ conexoes: prontidao?.conexoes ?? null, contexto: prontidao?.contexto ?? null, regras: blocoDeRegras, estrategia: null, atividade: null }} contadores={{ regras: contadorDeRegras }} abasOcultas={podeVerAEstrategia(ctx.role) ? [] : ['estrategia']} />
      <div className="cliente-aba">{children}</div>
    </Shell>
  );
}
