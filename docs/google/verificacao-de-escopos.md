# Verificação dos escopos OAuth do Google (app "Orla - Ads Platform")

Estado em 2026-11-20: app **publicado**, marca **verificada**, Google Ads API no nível **Básico**. Os escopos
sensíveis ainda não estão declarados em **Google Auth Platform → Acesso a dados**. Enquanto não forem
verificados, quem é de fora da agência vê a tela "O Google não verificou este app" e há um teto de 100 usuários.

## 1. Escopos a declarar

Fonte da verdade: `src/modules/connections/domain/oauth.ts`. Declarar exatamente estes, nem mais:

| Escopo | Conector | Classificação esperada |
|---|---|---|
| `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` | login e identidade | não sensível |
| `https://www.googleapis.com/auth/adwords` | Google Ads | sensível |
| `https://www.googleapis.com/auth/analytics.readonly` | GA4 | sensível |
| `https://www.googleapis.com/auth/webmasters.readonly` | Search Console | sensível |
| `https://www.googleapis.com/auth/tagmanager.readonly` | Tag Manager | sensível |
| `https://www.googleapis.com/auth/youtube.readonly` | YouTube | sensível |
| `https://www.googleapis.com/auth/yt-analytics.readonly` | YouTube | sensível |
| `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` | YouTube | sensível |
| `https://www.googleapis.com/auth/business.manage` | Perfil da Empresa | sensível |

Nenhum é **restrito** (Gmail, Drive amplo), então não há avaliação de segurança CASA; a verificação é a de
escopos sensíveis: justificativa por escopo + vídeo.

> Antes de enviar, vale reavaliar se `youtube.readonly` e `yt-analytics-monetary.readonly` são indispensáveis.
> Cada escopo a menos é uma justificativa a menos e um motivo a menos de recusa.

## 2. Justificativas (colar no formulário, em inglês)

**App purpose (descrição geral):**
> Orla is a marketing analytics platform operated by Agência 24/7, a digital marketing agency in Brazil. The
> agency's clients connect their own Google accounts so that Orla can collect performance data from their Google
> Ads, Analytics, Search Console, Tag Manager, YouTube and Business Profile accounts and show consolidated
> reports to the client and to the agency team. Access is invitation-only. Data is used only to provide these
> reports and is never sold, used for advertising, or used to train AI models. Privacy policy:
> https://platform.agencia24por7.com/privacidade

**adwords:**
> Used to list the Google Ads accounts the user manages and to read campaign, ad group and ad performance
> metrics (impressions, clicks, cost, conversions) for the client's reports. When the client requests it in the
> app, it is also used to send and accept the link invitation between the client's account and the agency's
> manager account (CustomerClientLink), so the agency can manage the campaigns. There is no read-only Google Ads
> scope, so adwords is the narrowest scope available.

**analytics.readonly:**
> Read-only. Used to list the GA4 properties the user can access and to run reports on sessions, traffic
> sources and conversions for the client's website reports. Orla never changes Analytics configuration.

**webmasters.readonly:**
> Read-only. Used to list the user's verified Search Console properties and read search performance (queries,
> clicks, impressions, position) for the organic search section of the client's reports.

**tagmanager.readonly:**
> Read-only. Used to list containers, tags and triggers so the agency can audit which measurement tags fire on
> the client's website. Orla never publishes or edits containers.

**youtube.readonly / yt-analytics.readonly / yt-analytics-monetary.readonly:**
> Read-only. youtube.readonly lists the channels the user owns so the client can choose which one to connect.
> yt-analytics.readonly reads views, watch time and audience metrics for the video section of the reports.
> yt-analytics-monetary.readonly reads estimated revenue for channels that are monetized, shown only to the
> channel owner's organization.

**business.manage:**
> Used to list the business locations the user manages and to read Business Profile performance metrics
> (impressions on Search and Maps, website clicks, call clicks, direction requests). Orla does not publish,
> edit or reply to anything on the profile; business.manage is the only scope offered by the Business Profile
> Performance API.

## 3. Roteiro do vídeo (3 a 5 minutos, sem cortes, publicado como "não listado" no YouTube)

O Google exige ver o **nome do app e o client ID na tela de consentimento** e cada escopo sendo usado.

1. **Abertura (15 s):** abrir https://platform.agencia24por7.com/sobre e mostrar o link da Política de
   Privacidade.
2. **Login (20 s):** clicar em Entrar → mostrar a tela do Google com "Orla - Ads Platform". Na barra de
   endereço, destacar o `client_id` (o mesmo da tela de credenciais do console).
3. **Conectar Google Ads (45 s):** Integrações → Google Ads → Autorizar. Mostrar a tela de consentimento com o
   escopo do Google Ads. Voltar ao app e mostrar a lista de contas descobertas; vincular uma a um cliente.
   Abrir o relatório do cliente com métricas de campanha.
4. **Vínculo à MCC (30 s):** na conta, pedir "vincular à agência" e mostrar a tarefa concluída.
5. **GA4, Search Console, Tag Manager (60 s):** para cada um: autorizar (mostrar o consentimento com o escopo
   somente leitura), escolher a propriedade/site/contêiner e mostrar os dados no relatório.
6. **YouTube (30 s):** autorizar, escolher o canal, mostrar visualizações e, se houver, receita estimada.
7. **Perfil da Empresa (30 s):** autorizar, mostrar os locais descobertos e as métricas de impressões e cliques.
8. **Revogação (20 s):** remover uma conexão na tela de conectores e mostrar
   https://platform.agencia24por7.com/exclusao-de-dados.

Gravar em inglês ou com legendas em inglês. Usar a conta da agência e contas de teste/da própria agência.

## 4. Envio

1. Google Auth Platform → **Acesso a dados** → Adicionar ou remover escopos → marcar os da seção 1 → Salvar.
2. Preencher as justificativas da seção 2 e o link do vídeo.
3. **Central de verificação** → Preparar para verificação → enviar.
4. Prazo típico: algumas semanas, com troca de e-mails com o time de verificação (responder em
   bruno.abreu@agencia24por7.com).
