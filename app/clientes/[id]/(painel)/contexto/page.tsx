import { Feedback } from '@/../app/_components/Feedback';
import { SubNavegacao } from '@/../app/clientes/[id]/_componentes/SubNavegacao';
import { carregarPainel, primeiro } from '@/../app/clientes/[id]/_dados';
import { BrainView } from '@/../app/clientes/[id]/(painel)/contexto/brain/BrainView';
import { Perfil } from '@/../app/clientes/[id]/(painel)/contexto/Perfil';
import { ROTULO_DA_SECAO_DE_CONTEXTO, SECOES_DE_CONTEXTO, rotaDoCliente, secaoDeContexto } from '@/modules/clients/domain/painel/enderecos';

export const dynamic = 'force-dynamic';

export default async function Contexto({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, busca] = await Promise.all([params, searchParams]);
  const { cliente } = await carregarPainel(id);
  const secaoBruta = primeiro(busca['secao']) ?? null;
  const secao = secaoDeContexto(secaoBruta);
  const secaoDoEditor = secaoBruta && secaoBruta !== 'perfil' && secaoBruta !== 'brain' ? secaoBruta : null;

  return (
    <div className="pilha">
      <Feedback message={primeiro(busca['erro'])} tone="error" />
      <Feedback message={primeiro(busca['feito'])} tone="ok" />
      <SubNavegacao
        rotulo="Seções de Contexto"
        ativa={secao}
        itens={SECOES_DE_CONTEXTO.map((chave) => ({ chave, rotulo: ROTULO_DA_SECAO_DE_CONTEXTO[chave], href: rotaDoCliente(cliente.id, 'contexto', { secao: chave }) }))}
      />
      {secao === 'brain' ? <BrainView clienteId={cliente.id} /> : <Perfil clienteId={cliente.id} secaoInicial={secaoDoEditor} campoInicial={primeiro(busca['campo']) ?? null} />}
    </div>
  );
}
