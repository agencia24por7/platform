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
      resumo="Quais dados a orla acessa, por que, onde ficam guardados, com quem são compartilhados, por quanto tempo e como você controla tudo isso."
      atualizadoEm="20 de novembro de 2026"
    >
      <section>
        <h2>1. Quem é o responsável</h2>
        <p>
          A orla é operada pela Agência 24/7, representada por Filipe Jones, que também é o encarregado pelo tratamento
          de dados pessoais. Para qualquer assunto de privacidade, escreva para{' '}
          <a href="mailto:contato@agencia24por7.com">contato@agencia24por7.com</a>. Esta política será atualizada com
          a razão social e o CNPJ assim que a empresa estiver constituída.
        </p>
        <p>
          Para os dados da equipe que usa a orla, a Agência 24/7 é controladora. Para os dados que pertencem aos
          clientes da agência, como métricas de campanha e leads, a Agência 24/7 atua como operadora, seguindo as
          instruções de cada cliente.
        </p>
      </section>

      <section>
        <h2>2. Dados que tratamos</h2>
        <h3>Para você entrar na orla</h3>
        <p>
          Ao entrar com Google, recebemos seu nome, e-mail, foto de perfil e o identificador da sua conta Google
          (escopos <code>openid</code>, <code>email</code> e <code>profile</code>). Usamos esses dados para identificar
          você e mostrar os clientes a que você tem acesso. Registramos as ações feitas na plataforma, com o endereço
          IP de origem, numa trilha de auditoria.
        </p>

        <h3>Quando uma conta é conectada</h3>
        <p>
          Cada conexão pede só o acesso necessário para aquela fonte e é autorizada pelo dono da conta. Nas conexões do
          Google também recebemos o e-mail de quem autorizou (<code>userinfo.email</code>), para mostrar quem concedeu
          o acesso.
        </p>
        <ul>
          <li>
            <strong>Google Ads</strong> (<code>adwords</code>): lista das contas, métricas de campanhas e anúncios e,
            quando o cliente pede, o convite para vincular a conta dele à conta de administrador da agência.
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
            <strong>YouTube</strong> (<code>youtube.readonly</code>, <code>yt-analytics.readonly</code> e{' '}
            <code>yt-analytics-monetary.readonly</code>, só leitura): canais, vídeos e métricas de audiência e de
            receita.
          </li>
          <li>
            <strong>Google Tag Manager</strong> (<code>tagmanager.readonly</code>, só leitura): contêineres e tags.
          </li>
          <li>
            <strong>Perfil da Empresa no Google</strong> (<code>business.manage</code>): locais da empresa e métricas
            de desempenho do perfil. A orla não publica nem altera nada no perfil.
          </li>
          <li>
            <strong>Meta</strong> (<code>ads_read</code>, <code>ads_management</code>,{' '}
            <code>business_management</code> e <code>leads_retrieval</code>): contas de anúncio, métricas, eventos do
            Pixel, leads de formulários e, quando o cliente pede, o pedido de acesso de parceiro para a agência.
          </li>
          <li>
            <strong>WhatsApp Business</strong>: avisos de mensagens recebidas, usados para atribuir conversas aos
            anúncios que as originaram. Guardamos só o identificador e o horário da mensagem, a origem do anúncio e um
            pseudônimo do telefone; o texto, o nome e o número do contato não são guardados.
          </li>
          <li>
            <strong>RD Station CRM, Z-API e Apify</strong>, por chave de API fornecida pelo cliente: negociações do
            funil, mensagens de WhatsApp e coleta de dados públicos, respectivamente.
          </li>
        </ul>

        <h3>Leads dos clientes</h3>
        <p>
          Quando um cliente contrata a automação de leads, os dados que a pessoa preencheu no formulário do anúncio
          (nome, telefone, e-mail e o produto de interesse) são enviados ao CRM do cliente. A orla guarda só os
          identificadores do lead e da negociação, para não duplicar envios, e nunca o conteúdo do formulário.
        </p>
      </section>

      <section>
        <h2>3. Para que usamos e com qual base legal</h2>
        <ul>
          <li>
            Relatórios e painéis de desempenho para a agência e para o cliente dono da conta: execução do contrato com
            o cliente (LGPD, art. 7º, V).
          </li>
          <li>
            Tarefas pedidas pelo cliente, como vincular contas à agência ou enviar leads ao CRM dele: execução do
            contrato, sob as instruções do cliente.
          </li>
          <li>Login, segurança e trilha de auditoria: legítimo interesse e obrigação legal (art. 7º, II e IX).</li>
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
          , incluindo os requisitos de Uso Limitado. Os dados do Google só servem para oferecer os recursos da orla
          visíveis a você; pessoas só os leem com seu consentimento, para segurança, por obrigação legal ou quando
          agregados para a operação. Eles não são transferidos a terceiros, exceto quando necessário para esses
          recursos ou por obrigação legal.
        </p>
      </section>

      <section>
        <h2>5. Onde os dados ficam e como os protegemos</h2>
        <ul>
          <li>A plataforma roda na infraestrutura da Agência 24/7 no Google Cloud, nos Estados Unidos.</li>
          <li>
            Os tokens de acesso ficam cifrados num cofre de credenciais e nunca são mostrados nas telas nem enviados a
            terceiros.
          </li>
          <li>As métricas ficam no banco de dados da plataforma e no data warehouse da agência (BigQuery).</li>
          <li>
            O tráfego é sempre cifrado (HTTPS). Cada organização só enxerga os próprios dados, cada pessoa só enxerga os
            clientes a que tem acesso, e as ações ficam registradas numa trilha de auditoria.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Com quem compartilhamos</h2>
        <p>Só com quem é necessário para operar o serviço:</p>
        <ul>
          <li>Google Cloud: hospedagem da plataforma, do banco de dados, do data warehouse e dos backups.</li>
          <li>Google e Meta: recebem as chamadas autorizadas para coletar métricas e executar tarefas.</li>
          <li>RD Station: recebe os leads, quando o cliente contrata a automação de leads para o CRM dele.</li>
          <li>Z-API e Apify: quando o cliente conecta esses serviços com a própria chave.</li>
          <li>Google Workspace (Gmail): envio dos alertas de falha para a equipe da agência, sem dados de leads.</li>
        </ul>
        <p>
          Os relatórios de um cliente só são vistos pela equipe da agência e pelas pessoas que esse cliente indicar.
        </p>
      </section>

      <section>
        <h2>7. Transferência internacional</h2>
        <p>
          Os dados são processados nos Estados Unidos pelos fornecedores acima. Essas transferências se apoiam nas
          cláusulas contratuais de proteção de dados dos fornecedores, incluindo as cláusulas-padrão aprovadas pela
          ANPD quando disponíveis, e são necessárias para executar o serviço contratado (LGPD, art. 33).
        </p>
      </section>

      <section>
        <h2>8. Por quanto tempo guardamos</h2>
        <ul>
          <li>
            Tokens de acesso: enquanto a conexão existir. Ao remover a conexão, pedimos ao Google ou à Meta que revogue
            o acesso e apagamos o token.
          </li>
          <li>
            Dados da API do YouTube: títulos e detalhes de vídeos e playlists, e o nome do canal, são renovados ou
            apagados a cada 30 dias. Quando a conexão de um canal é removida, os dados do YouTube desse canal são
            apagados em até 7 dias; quando o acesso é revogado direto no Google, em até 30 dias.
          </li>
          <li>Métricas: enquanto o cliente usar a orla; apagadas em até 30 dias depois de um pedido de exclusão.</li>
          <li>Registros de execução das automações: 14 dias. Os fluxos de leads não guardam o conteúdo dos leads.</li>
          <li>Avisos de mensagens do WhatsApp: 90 dias.</li>
          <li>Convites de equipe vencidos ou cancelados: o e-mail é apagado depois de 90 dias.</li>
          <li>Convites de equipe já aceitos: o e-mail do convite é apagado depois de 30 dias do aceite.</li>
          <li>Contas Google que entraram sem ter acesso liberado: apagadas depois de 30 dias.</li>
          <li>
            Pessoas que deixaram a equipe: o nome e o e-mail são anonimizados 90 dias depois do último acesso revogado,
            e a trilha de auditoria continua sem identificá-las.
          </li>
          <li>Alertas de falha da plataforma: 90 dias.</li>
          <li>
            Trilha de auditoria: o endereço IP é apagado depois de 6 meses e o registro, depois de 2 anos.
          </li>
          <li>
            Backups: 30 dias. Um dado excluído some dos backups quando o backup mais antigo que o contém expira.
          </li>
        </ul>
      </section>

      <section>
        <h2>9. Seus direitos e como controlar o acesso</h2>
        <ul>
          <li>A equipe da agência remove uma conexão a qualquer momento na tela de conectores da orla.</li>
          <li>
            Você pode revogar o acesso direto no Google, em{' '}
            <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">
              myaccount.google.com/permissions
            </a>
            , ou na Meta, em Configurações → Integrações comerciais. Ao remover o app na Meta, ela nos avisa
            automaticamente e você recebe um código para acompanhar o pedido de exclusão.
          </li>
          <li>
            Você pode pedir confirmação do tratamento, acesso, correção, portabilidade, anonimização ou exclusão dos
            seus dados (passo a passo em <Link href="/exclusao-de-dados">Exclusão de dados</Link>), e informações
            sobre compartilhamento, conforme o art. 18 da LGPD, por{' '}
            <a href="mailto:contato@agencia24por7.com">contato@agencia24por7.com</a>. Respondemos em até 15 dias.
          </li>
          <li>
            Se um pedido envolver dados de um cliente da agência, como um lead, encaminhamos ao cliente, que é o
            controlador, e apoiamos o atendimento.
          </li>
          <li>
            Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD), em{' '}
            <a href="https://www.gov.br/anpd" rel="noopener noreferrer">
              gov.br/anpd
            </a>
            .
          </li>
        </ul>
      </section>

      <section>
        <h2>10. Menores de idade</h2>
        <p>
          A orla é uma ferramenta profissional e não se destina a menores de 18 anos. Não tratamos
          intencionalmente dados de crianças ou adolescentes.
        </p>
      </section>

      <section>
        <h2>11. Cookies</h2>
        <p>
          Usamos só cookies essenciais: o da sessão de login, os temporários da autorização com Google e Meta e o que
          lembra a organização escolhida. Não usamos cookies de publicidade nem de rastreamento. A preferência de tema
          claro ou escuro fica guardada no seu navegador.
        </p>
      </section>

      <section>
        <h2>12. Incidentes de segurança</h2>
        <p>
          Se um incidente puder trazer risco ou dano relevante, comunicamos a ANPD e as pessoas afetadas no prazo da
          regulamentação, com o que aconteceu, quais dados foram envolvidos e o que fizemos.
        </p>
      </section>

      <section>
        <h2>13. Mudanças nesta política</h2>
        <p>
          Quando a política mudar, atualizamos a data no topo e avisamos quem usa a orla. Veja também os{' '}
          <Link href="/termos">Termos de Serviço</Link>.
        </p>
      </section>
    </DocumentoPublico>
  );
}
