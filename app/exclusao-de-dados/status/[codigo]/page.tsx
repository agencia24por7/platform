import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocumentoPublico } from '@/../app/_components/DocumentoPublico';
import { modules } from '@/composition';
import type { SituacaoDoPedido } from '@/modules/privacidade/application/pedidosDeExclusao';
import { comoPublico } from '@/shared/db/client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Situação do pedido de exclusão',
  robots: { index: false, follow: false },
};

const ROTULO: Record<SituacaoDoPedido['situacao'], string> = {
  pendente: 'Recebido: ainda não começamos a atender.',
  em_andamento: 'Em andamento: estamos apagando os dados.',
  concluido: 'Concluído: os dados foram apagados.',
};

const data = (valor: Date) => valor.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export default async function SituacaoDoPedidoDeExclusao({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const pedido = await comoPublico(() => modules().pedidosDeExclusao.situacao(codigo));
  if (!pedido) notFound();

  return (
    <DocumentoPublico
      titulo="Situação do pedido de exclusão"
      resumo="Pedido de exclusão de dados recebido da Meta quando você removeu o app da orla da sua conta."
    >
      <section>
        <p>
          Código de confirmação: <span className="mono">{codigo}</span>
        </p>
        <p>
          <strong>{ROTULO[pedido.situacao]}</strong>
        </p>
        <p>Recebido em {data(pedido.criadoEm)}.{pedido.concluidoEm ? ` Concluído em ${data(pedido.concluidoEm)}.` : ''}</p>
        <p>
          Atendemos em até 15 dias. Dúvidas: <a href="mailto:contato@agencia24por7.com">contato@agencia24por7.com</a>,
          informando o código acima. Detalhes em <Link href="/exclusao-de-dados">Exclusão de dados</Link>.
        </p>
      </section>
    </DocumentoPublico>
  );
}
