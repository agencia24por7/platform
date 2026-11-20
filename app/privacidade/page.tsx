import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentoPublico } from '@/../app/_components/DocumentoPublico';

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description: 'Quais dados a orla acessa, por que, como guarda e como você revoga o acesso.',
};

export default function Privacidade() {
  return (
    <DocumentoPublico
      titulo="Política de Privacidade"
      resumo="Quais dados a orla acessa, por que, onde ficam guardados, com quem são compartilhados e como você controla tudo isso."
      atualizadoEm="20 de novembro de 2026"
    >
      <section>
        <h2>1. Quem é o responsável</h2>
        <p>
          A orla é operada pela Agência 24/7, representada por Bruno Abreu, que também é o encarregado pelo tratamento
          de dados pessoais. Para qualquer assunto de privacidade, escreva para{' '}
          <a href="mailto:contato@agencia24por7.com">contato@agencia24por7.com</a>. Esta política será atualizada com
          a razão social e o CNPJ assim que a empresa estiver constituída.
        </p>
      </section>

      <section>
        <h2>2. Dados que coletamos</h2>
        <h3>Para você entrar na orla</h3>
        <p>
          Ao entrar com Google, recebemos seu nome, e-mail e o identificador da sua conta Google (escopos{' '}
          <code>openid</code>, <code>email</code> e <code>profile</code>). Usamos esses dados só para identificar você
          e mostrar os clientes a que você tem acesso. Mantemos um cookie de sessão, necessário para o login; não
          usamos cookies de publicidade nem de rastreamento.
        </p>

        <h3>Quando você conecta uma conta</h3>
        <p>
          Cada conexão pede só o acesso necessário para aquela fonte, e você autoriza uma a uma:
        </p>
        <ul>
          <li>
            <strong>Google Ads</strong> (<code>adwords</code>): lista das contas, métricas de campanhas e anúncios e,
            quando você pede, o convite para vincular sua conta à conta de administrador da agência.
          </li>
          <li>
            <strong>Google Analytics</strong> (<code>analytics.readonly</code>, só leitura): propriedades e relatórios
            de tráfego e conversões.
          </li>
          <li>
            <strong>Search Console</strong> (<code>webmasters.readonly</code>, só leitura): sites e desempenho na
            pesquisa.
          </li>
          <li>
            <strong>YouTube</strong> (<code>yt-analytics.readonly</code>, só leitura): canais e métricas dos vídeos.
          </li>
          <li>
            <strong>Google Tag Manager</strong> (<code>tagmanager.readonly</code>, só leitura): contêineres e tags.
          </li>
          <li>
            <strong>Perfil da Empresa no Google</strong> (<code>business.manage</code>): locais da empresa e métricas
            de desempenho do perfil. A orla não publica nem altera nada no perfil.
          </li>
          <li>
            <strong>Meta Ads</strong>: contas de anúncio, métricas de campanhas e leads de formulários.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Como usamos os dados</h2>
        <ul>
          <li>Para montar relatórios e painéis de desempenho para a agência e para o cliente dono da conta.</li>
          <li>Para executar as tarefas que você pede, como vincular sua conta de anúncios à agência.</li>
          <li>Para manter a segurança e a auditoria de quem acessou o quê.</li>
        </ul>
        <p>
          Não vendemos dados, não os usamos para publicidade e não os usamos para treinar modelos de inteligência
          artificial.
        </p>
      </section>

      <section>
        <h2>4. Uso Limitado dos dados do Google</h2>
        <p>
          O uso e a transferência para qualquer outro aplicativo das informações recebidas das APIs do Google seguem a{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer">
            Política de Dados do Usuário dos Serviços de API do Google
          </a>
          , incluindo os requisitos de Uso Limitado. Os dados do Google só servem para oferecer e melhorar os recursos
          da orla visíveis a você; pessoas só os leem com seu consentimento, para segurança, por obrigação legal ou
          quando agregados para a operação.
        </p>
      </section>

      <section>
        <h2>5. Onde os dados ficam e como os protegemos</h2>
        <ul>
          <li>Tudo fica na infraestrutura da Agência 24/7 no Google Cloud, nos Estados Unidos.</li>
          <li>
            Os tokens de acesso ficam cifrados num cofre de credenciais e nunca são mostrados nas telas nem enviados a
            terceiros.
          </li>
          <li>As métricas ficam no banco de dados da plataforma e no data warehouse da agência (BigQuery).</li>
          <li>
            O tráfego é sempre cifrado (HTTPS). Cada organização só enxerga os próprios dados, e as ações ficam
            registradas numa trilha de auditoria.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Com quem compartilhamos</h2>
        <p>
          Com ninguém além do necessário para operar: o Google Cloud, que hospeda a plataforma, e as próprias
          plataformas (Google e Meta), que recebem as chamadas autorizadas por você. Os relatórios de um cliente só são
          vistos pela equipe da agência e pelas pessoas que esse cliente indicar.
        </p>
      </section>

      <section>
        <h2>7. Por quanto tempo guardamos</h2>
        <ul>
          <li>Os tokens de acesso ficam guardados enquanto a conexão existir e são apagados quando ela é removida.</li>
          <li>
            As métricas coletadas ficam enquanto o cliente usar a orla, para formar o histórico dos relatórios, e são
            apagadas em até 30 dias depois de um pedido de exclusão.
          </li>
          <li>A trilha de auditoria é guardada pelo tempo exigido por lei.</li>
        </ul>
      </section>

      <section>
        <h2>8. Como você controla o acesso</h2>
        <ul>
          <li>Remova uma conexão a qualquer momento na tela de conectores da orla.</li>
          <li>
            Revogue o acesso direto no Google, em{' '}
            <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
              myaccount.google.com/permissions
            </a>
            , ou na Meta, em Configurações → Integrações comerciais.
          </li>
          <li>
            Peça acesso, correção, portabilidade ou exclusão dos seus dados, conforme a Lei Geral de Proteção de Dados
            (LGPD), por <a href="mailto:contato@agencia24por7.com">contato@agencia24por7.com</a>. Respondemos em até
            15 dias.
          </li>
        </ul>
      </section>

      <section>
        <h2>9. Mudanças nesta política</h2>
        <p>
          Quando a política mudar, atualizamos a data no topo e avisamos quem usa a orla. Veja também os{' '}
          <Link href="/termos">Termos de Serviço</Link>.
        </p>
      </section>
    </DocumentoPublico>
  );
}
