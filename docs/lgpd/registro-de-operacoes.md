# Registro das operações de tratamento (LGPD, art. 37)

- Controlador dos dados da equipe e operador dos dados dos clientes: Agência 24/7
- Encarregado: Filipe Jones, contato@agencia24por7.com
- Última revisão: 2026-11-20

A política pública está em `/privacidade` (`app/privacidade/page.tsx`). Toda mudança aqui
que altere o que é tratado, por quê, com quem ou por quanto tempo exige atualizar a política.

## Operações

| Operação | Titulares | Dados | Onde fica | Finalidade | Base legal | Papel da agência |
|---|---|---|---|---|---|---|
| Login com Google | Equipe da agência e pessoas indicadas pelos clientes | nome, e-mail, foto, ID Google, último acesso | `core.users` | identificar e autorizar | execução de contrato (art. 7º, V) | controladora |
| Equipe e convites | Equipe e convidados | e-mail do convidado, papel, recorte por cliente | `core.members`, `core.invitations`, `core.member_clients` | controle de acesso | execução de contrato | controladora |
| Trilha de auditoria | Quem age na plataforma | ID do autor, IP, e-mail no metadata de eventos de equipe | `audit.audit_log` | segurança e prestação de contas | legítimo interesse e obrigação legal (art. 7º, II e IX) | controladora |
| Conexões com plataformas | Quem autoriza a conexão | e-mail da conta que autorizou, token (cifrado no n8n) | `integrations.connections.account_email`, cofre do n8n | coletar métricas e executar tarefas pedidas; ao remover, revogar o acesso no Google ou na Meta (ADR 0029) | execução de contrato | operadora |
| Dados da API do YouTube | Em regra nenhum (canal da marca) | métricas do canal, títulos e detalhes de vídeos e playlists, nome do canal | BigQuery `tria_dw.fato_youtube_*`, `dim_youtube_*`, `dim_fonte_scd2`; `integrations.connection_accounts` | relatórios do canal | execução de contrato | operadora; títulos renovados ou apagados a cada 30 dias e tudo apagado em até 7 dias da remoção da conexão (ADR 0029) |
| Pedidos de exclusão da Meta | Quem remove o app da conta do Facebook | pseudônimo do usuário (HMAC, sem o id da Meta), código de confirmação, situação, conexões afetadas, evidência do atendimento | `privacidade.pedidos_de_exclusao`, `privacidade.pedidos_de_exclusao_conexoes` | atender o pedido e provar o atendimento | obrigação legal e exercício de direitos (art. 7º, II e VI; art. 18, VI) | controladora |
| Métricas de marketing | Em regra nenhum (dados agregados de campanha) | métricas e nomes de campanhas, locais, canais | `metrics.*`, BigQuery `tria_dw` | relatórios | execução de contrato | operadora |
| Resultados do CRM (RD Station) | Nenhum gravado: a resposta da API traz contatos, mas eles só passam pela memória do coletor no n8n e são descartados ali | ID da negociação, funil, etapa, situação, valores, datas, nome da fonte e da campanha | BigQuery `tria_dw.fato_rd_negociacoes` | relatórios de funil e vendas por cliente | execução de contrato | operadora |
| Eventos do conjunto de dados (Meta Pixel) | Nenhum: a API devolve só contagens agregadas por hora e nome de evento | ID do conjunto de dados, dia, nome do evento, origem (total, navegador, servidor), quantidade | BigQuery `tria_dw.fato_meta_eventos_dataset` | medir o que o site envia para a Meta, por cliente | execução de contrato | operadora |
| Formulários de cadastro (Meta Lead Ads) | Nenhum gravado: nenhum lead nem resposta é lido; o token da Página só passa pela memória do coletor no n8n | ID da Página e do formulário, nome, status, total de leads e de leads expirados, data de criação | BigQuery `tria_dw.fato_meta_formularios` | volume de cadastros por formulário e por cliente | execução de contrato | operadora |
| Leads (Meta Lead Ads → RD Station) | Pessoas que preenchem formulários de anúncio | nome, telefone, e-mail, produto de interesse | só em trânsito no n8n; n8n Data Tables guardam IDs | entregar o lead ao CRM do cliente | instrução do cliente (controlador) | operadora |
| Avisos do WhatsApp | Contatos que escrevem ao cliente | resumo: id e horário da mensagem, origem do anúncio, HMAC do telefone (sem texto nem nome) | `integrations.whatsapp_inbound_events` | atribuir conversa ao anúncio | instrução do cliente | operadora |
| Alertas de falha | Equipe da agência | mensagem de erro do fluxo | Gmail | operação | legítimo interesse | controladora |

## Operadores e suboperadores

| Fornecedor | O que recebe | País |
|---|---|---|
| Google Cloud | hospedagem, banco, BigQuery, backups, segredos | EUA |
| Google (APIs) e Meta (APIs) | chamadas autorizadas | EUA |
| RD Station | leads, quando o cliente contrata a automação | Brasil/EUA |
| Z-API, Apify | chamadas com a chave do cliente | Brasil/EUA |
| Google Workspace (Gmail) | alertas de falha | EUA |

## Pendências fora do código

- Contrato de operador com cada cliente que usa a automação de leads (art. 39), começando pela Credaz.
- Relatório de impacto (RIPD, art. 38) para o fluxo de leads da Credaz: o público é de crédito consignado e
  benefícios sociais, potencialmente vulnerável.
- Aditivo de proteção de dados do Google Cloud aceito no console (base da transferência internacional, art. 33).
