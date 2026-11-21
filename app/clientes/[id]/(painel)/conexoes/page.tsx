import { Feedback } from '@/../app/_components/Feedback';
import { SubNavegacao } from '@/../app/clientes/[id]/_componentes/SubNavegacao';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { Fontes } from '@/../app/clientes/[id]/(painel)/conexoes/Fontes';
import { Pedir } from '@/../app/clientes/[id]/(painel)/conexoes/pedir/Pedir';
import {
  ROTULO_DA_SECAO_DE_CONEXOES,
  SECOES_DE_CONEXOES,
  rotaDoCliente,
  secaoDeConexoes,
} from '@/modules/clients/domain/painel/enderecos';

import { vocabularioDe } from '@/modules/organizations/domain/vocabulario';

export const dynamic = 'force-dynamic';

export default async function Conexoes({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { ctx, cliente } = await carregarPainel(id);
  const vocabulario = vocabularioDe(ctx.organization.type);
  const secao = secaoDeConexoes(primeiro(busca['secao']));

  return (
    <div className="pilha">
      <Feedback message={primeiro(busca['erro'])} tone="error" />
      <Feedback message={primeiro(busca['feito'])} tone="ok" />
      <SubNavegacao
        rotulo="Seções de Conexões"
        ativa={secao}
        itens={SECOES_DE_CONEXOES.map((chave) => ({ chave, rotulo: chave === 'pedir' ? vocabulario.rotuloDePedir : ROTULO_DA_SECAO_DE_CONEXOES[chave], href: rotaDoCliente(cliente.id, 'conexoes', { secao: chave }) }))}
      />
      {secao === 'pedir' ? <Pedir clienteId={cliente.id} abrirMapa={primeiro(busca['enviar']) === 'contexto'} /> : <Fontes clienteId={cliente.id} />}
    </div>
  );
}
