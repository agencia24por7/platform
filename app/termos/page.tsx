import type { Metadata } from 'next';
import Link from 'next/link';
import { DocumentoPublico } from '@/../app/_components/DocumentoPublico';

export const metadata: Metadata = {
  title: 'Termos de Serviço',
  description: 'Regras de uso da orla, a plataforma de dados de marketing da Agência 24/7.',
};

export default function Termos() {
  return (
    <DocumentoPublico
      titulo="Termos de Serviço"
      resumo="As regras para usar a orla, a plataforma de dados de marketing da Agência 24/7."
      atualizadoEm="20 de novembro de 2026"
    >
      <section>
        <h2>1. O serviço</h2>
        <p>
          A orla conecta contas de anúncios e de análise, coleta métricas e monta relatórios para a Agência 24/7 e
          seus clientes. Ela é oferecida pela Agência 24/7, representada por Bruno Abreu (
          <a href="mailto:contato@agencia24por7.com">contato@agencia24por7.com</a>).
        </p>
      </section>

      <section>
        <h2>2. Acesso</h2>
        <ul>
          <li>O acesso é por convite. Cada pessoa entra com a própria conta Google e responde pelo que faz.</li>
          <li>Não compartilhe sua conta nem tente acessar dados de clientes a que você não foi convidado.</li>
          <li>Podemos suspender o acesso de quem violar estes termos ou colocar a plataforma em risco.</li>
        </ul>
      </section>

      <section>
        <h2>3. Contas conectadas</h2>
        <ul>
          <li>
            Ao conectar uma conta, você declara que tem autorização para isso e permite que a orla acesse os dados
            descritos na <Link href="/privacidade">Política de Privacidade</Link>.
          </li>
          <li>Você pode remover a conexão ou revogar o acesso a qualquer momento.</li>
          <li>
            O uso das plataformas conectadas (Google, Meta e outras) continua sujeito aos termos de cada uma delas.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Dados e relatórios</h2>
        <p>
          Os dados de cada cliente pertencem a ele. A orla os trata só para prestar o serviço, conforme a Política de
          Privacidade. As métricas vêm das plataformas conectadas e podem ter atrasos ou correções feitas por elas.
        </p>
      </section>

      <section>
        <h2>5. Confidencialidade e propriedade</h2>
        <ul>
          <li>
            Os dados e relatórios de um cliente são confidenciais: só a equipe da agência e as pessoas indicadas por
            esse cliente os acessam.
          </li>
          <li>
            A orla, seu código, marca e layout pertencem à Agência 24/7. O uso é permitido só para os fins destes
            termos, sem copiar, revender ou fazer engenharia reversa.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. Disponibilidade e responsabilidade</h2>
        <p>
          Trabalhamos para manter a orla disponível e correta, mas ela pode ter interrupções para manutenção ou por
          falhas de terceiros. Na medida permitida por lei, não respondemos por decisões tomadas só com base nos
          relatórios nem por indisponibilidade das plataformas conectadas.
        </p>
      </section>

      <section>
        <h2>7. Mudanças e encerramento</h2>
        <p>
          Podemos atualizar estes termos; a data no topo indica a versão em vigor. Mudanças relevantes são avisadas a
          quem usa a orla com pelo menos 15 dias de antecedência. Você pode deixar de usar a orla a qualquer momento e
          pedir a exclusão dos seus dados; ao fim do contrato com um cliente, os dados dele são excluídos conforme a{' '}
          <Link href="/privacidade">Política de Privacidade</Link>.
        </p>
      </section>

      <section>
        <h2>8. Lei aplicável</h2>
        <p>Estes termos seguem as leis do Brasil. Fica eleito o foro da comarca do Recife, Pernambuco.</p>
      </section>
    </DocumentoPublico>
  );
}
