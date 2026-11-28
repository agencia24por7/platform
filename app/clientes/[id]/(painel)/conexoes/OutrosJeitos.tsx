import Link from 'next/link';
import { CabecalhoDeSecao } from '@/../app/clientes/[id]/_componentes/CabecalhoDeSecao';
import { carregarConexoes, carregarPainel } from '@/../app/clientes/[id]/_dados';
import { pedirAcessoMetaPartner } from '@/../app/clientes/[id]/acoes';
import { modules } from '@/composition';

export async function OutrosJeitos({ clienteId }: { readonly clienteId: string }) {
  const { ctx, cliente, podeAdministrar, organizacaoInteira } = await carregarPainel(clienteId);
  if (!podeAdministrar || !organizacaoInteira) return null;
  const [organizacao, conexoes] = await Promise.all([modules().organizations.byId(ctx.organization.id), carregarConexoes(ctx.organization.id)]);
  const temConexaoMeta = conexoes.some((c) => c.platform === 'meta' && c.grantType === 'oauth_user' && c.authorizedVia === 'staff');
  const temBusinessManager = organizacao.ok && Boolean(organizacao.value.businessManagerId);
  const conexaoGoogle = conexoes.find((c) => c.platform === 'google' && c.authorizedVia === 'staff');

  return (
    <section className="pilha" aria-labelledby="t-outros-jeitos">
      <CabecalhoDeSecao id="t-outros-jeitos" titulo="Outros jeitos" descricao="MCC do Google Ads e parceiro do Meta, sem OAuth com a Orla." />
      <div className="card card__body grade-auto">
        <div className="pilha">
          <div className="strong">Google Ads · administradora (MCC)</div>
          <p className="subtle small">O dono aceita o convite direto no Google Ads, sem OAuth com a Orla. Depois vincule a conta em Fontes.</p>
          {conexaoGoogle ? (
            <Link className="btn btn--compacto" href={`/integracoes/${conexaoGoogle.id}`}>
              Ver conexão do Google Ads →
            </Link>
          ) : (
            <span className="subtle small">Autorize o Google Ads com uma conta administradora primeiro.</span>
          )}
        </div>
        <div className="pilha">
          <div className="strong">Meta Ads · parceiro do Business Manager</div>
          <p className="subtle small">O aceite é no Gerenciador de Negócios. Formato: act_1234567890.</p>
          {temConexaoMeta && temBusinessManager ? (
            <form action={pedirAcessoMetaPartner} className="form--inline">
              <input type="hidden" name="clientId" value={cliente.id} />
              <input className="input input--compacto" name="contaDeAnuncio" placeholder="act_1234567890" aria-label="Conta de anúncio" required />
              <button className="btn btn--compacto" type="submit">
                Pedir acesso Meta Partner
              </button>
            </form>
          ) : (
            <span className="subtle small">Autorize o Meta Ads com uma conta administradora do Business Manager para liberar o pedido.</span>
          )}
        </div>
      </div>
    </section>
  );
}
