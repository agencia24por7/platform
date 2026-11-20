import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentoPublico } from '@/../app/_components/DocumentoPublico';

export const metadata: Metadata = {
  title: 'Sobre',
  description: 'Plataforma da Agência 24/7 que reúne os dados de marketing dos clientes num só lugar.',
};

export default function Sobre() {
  return (
    <DocumentoPublico
      titulo="Sobre a orla"
      resumo="A orla é a plataforma da Agência 24/7 que reúne, num só lugar, os dados de marketing dos clientes da agência: anúncios, site, buscas, vídeos e perfil da empresa no Google."
    >
      <section>
        <h2>O que a orla faz</h2>
        <ul>
          <li>
            Conecta, com a autorização do dono da conta, as contas de Google Ads, Google Analytics, Search Console,
            YouTube, Google Tag Manager, Perfil da Empresa no Google e Meta Ads.
          </li>
          <li>Coleta métricas de desempenho dessas contas e monta relatórios para a agência e para cada cliente.</li>
          <li>
            A pedido do cliente, vincula a conta de Google Ads dele à conta de administrador da agência, para que a
            agência possa gerenciar as campanhas.
          </li>
        </ul>
      </section>

      <section>
        <h2>Quem usa</h2>
        <p>
          O acesso é por convite: a equipe da Agência 24/7 e as pessoas que cada cliente indicar. Cada pessoa só vê os
          dados dos clientes a que tem acesso.
        </p>
      </section>

      <section>
        <h2>Seus dados</h2>
        <p>
          Explicamos tudo o que acessamos, por que e como você revoga o acesso na{' '}
          <Link href="/privacidade">Política de Privacidade</Link>. As regras de uso estão nos{' '}
          <Link href="/termos">Termos de Serviço</Link>.
        </p>
      </section>
    </DocumentoPublico>
  );
}
