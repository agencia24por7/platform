import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentoPublico } from '@/../app/_components/DocumentoPublico';

export const metadata: Metadata = {
  title: 'Exclusão de dados',
  description: 'Como remover o acesso da orla às suas contas e pedir a exclusão dos seus dados.',
};

export default function ExclusaoDeDados() {
  return (
    <DocumentoPublico
      titulo="Exclusão de dados"
      resumo="Como remover o acesso da orla às suas contas do Facebook, Instagram, WhatsApp ou Google e pedir a exclusão dos dados que guardamos."
      atualizadoEm="20 de novembro de 2026"
    >
      <section>
        <h2>1. Remover o acesso agora</h2>
        <ul>
          <li>
            <strong>Facebook e Meta:</strong> em Configurações e privacidade → Configurações → Integrações comerciais,
            remova o app <em>Agencia24/7 Ads</em>. O acesso termina na hora.
          </li>
          <li>
            <strong>Google:</strong> em{' '}
            <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
              myaccount.google.com/permissions
            </a>
            , remova <em>Orla - Ads Platform</em>.
          </li>
        </ul>
        <p>
          Quando o acesso é revogado, a orla deixa de conseguir coletar dados dessa conta. A equipe da agência também pode
          remover a conexão na tela de conectores, o que apaga o token guardado.
        </p>
      </section>

      <section>
        <h2>2. Pedir a exclusão dos dados</h2>
        <p>
          Escreva para <a href="mailto:contato@agencia24por7.com">contato@agencia24por7.com</a> a partir do e-mail da
          conta, com o assunto <em>Exclusão de dados</em>. Confirmamos o recebimento e, em até 15 dias:
        </p>
        <ul>
          <li>apagamos os tokens de acesso e as conexões da sua conta;</li>
          <li>anonimizamos seu nome, e-mail e foto e os retiramos da trilha de auditoria;</li>
          <li>
            se você for cliente da agência e pedir o encerramento, excluímos as métricas das suas contas em até 30
            dias, inclusive no data warehouse.
          </li>
        </ul>
        <p>
          Respondemos com a confirmação do que foi feito. Cópias de segurança expiram sozinhas em até 30 dias. Detalhes
          na <Link href="/privacidade">Política de Privacidade</Link>.
        </p>
      </section>
    </DocumentoPublico>
  );
}
