# Retenção de dados

Fonte da verdade dos prazos publicados em `/privacidade` (seção 8). Mudou um prazo aqui, muda lá e no código.

| Dado | Prazo | Como é aplicado |
|---|---|---|
| IP na trilha de auditoria | 6 meses | `core.aplicar_retencao()` (diária) |
| Registro da trilha de auditoria | 2 anos | `core.aplicar_retencao()` |
| Eventos de login de quem não tem organização | 30 dias | `core.aplicar_retencao()` |
| E-mail de convite vencido ou cancelado | 90 dias após vencer/cancelar | `core.aplicar_retencao()` (vira `removido+<id>@invalid`) |
| Conta Google que entrou sem acesso liberado | 30 dias sem login | `core.aplicar_retencao()` (só se não tiver vínculo, convite aberto nem referência) |
| Avisos do WhatsApp (`whatsapp_inbound_events`) | 90 dias | `core.aplicar_retencao()` |
| Token de conexão | enquanto a conexão existir | remover a conexão revoga o acesso no Google ou na Meta (salvo conta que sustenta outra conexão; aí a tela mostra o caminho manual) e apaga a credencial do cofre (`removerConexao`, ADR 0029) |
| Dados da API do YouTube nas dimensões (`dim_youtube_video_scd2`, `dim_youtube_playlist_scd2`: títulos e detalhes) | 30 dias sem renovação | a coleta renova `carregado_em`; o job `ORLA · privacidade · YouTube 30 dias` (03:45) apaga versão com `carregado_em` de mais de 30 dias (ADR 0029) |
| Nome do canal do YouTube (`connection_accounts.name`, `dim_fonte_scd2.nome`) | 30 dias sem nova descoberta | o mesmo job troca o nome pelo id do canal no Postgres e anula o nome nas versões encerradas há mais de 30 dias no BigQuery |
| Todos os dados do YouTube de um canal (fatos, dimensões, staging) depois que a autorização acaba | 7 dias da remoção da conexão; 30 se revogada no Google | `removerConexao` enfileira e expurga na hora (`privacidade.expurgos_de_fonte`); o job diário refaz falhas e enfileira, com 7 dias de carência, canal sem conexão ativa (ADR 0029) |
| Pedido de exclusão recebido da Meta (`privacidade.pedidos_de_exclusao`: pseudônimo do usuário, código, situação, evidência) | enquanto houver base legal (prova do atendimento) | sem id da Meta; atendido em até 15 dias com `titular.mjs pedidos-de-exclusao` |
| Métricas e dados de um cliente excluído | enquanto houver base legal (contrato, obrigação, exercício de direitos); a exclusão é lógica | `scripts/titular.mjs excluir-cliente` esconde do app e das views `vw_*` sem apagar (ADR 0022); `expurgar-cliente` elimina em até 30 dias do pedido quando a eliminação for obrigatória |
| Histórico de dono das fontes e dos clientes no BigQuery (`dim_fonte_scd2`, `dim_cliente_scd2`; nomes de cliente e de fonte, dado de negócio) | enquanto houver base legal; cliente excluído ganha versão com `status = 'excluido'` | `expurgar-cliente`: apaga de toda tabela-base com `client_id` (ADR 0013, ADR 0022) |
| Execuções das automações (n8n) | 14 dias | `EXECUTIONS_DATA_MAX_AGE=336`; fluxos de leads não salvam execução |
| Staging do BigQuery (`stg_*`: linhas de uma chamada de gravação, sem `client_id`) | 7 dias | `partition_expiration_days = 7` no DDL; o expurgo de cliente e o de fonte também apagam a staging, por organização + chave da fonte (ADR 0029) |
| Linhas apagadas ou alteradas no BigQuery (time travel do dataset) | 7 dias + 7 de fail-safe do Google | padrão do dataset (`max_time_travel_hours` 168, `infra/terraform/bigquery.tf`); um expurgo só some de vez do BigQuery depois desse prazo (ADR 0023) |
| Backups lógicos | 30 dias | ciclo de vida do bucket (`infra/terraform/backup.tf`) |
| Snapshots do disco | 7 dias | política de snapshot (`infra/terraform`) |

## Agendamento

O workflow `ORLA · privacidade · YouTube 30 dias` (`n8n/workflows/plataforma/youtube-conformidade-diaria.json`)
chama `POST /api/v0/manutencao/youtube` às 03:45, antes da sincronização de dimensões das 04:00, e grava
`privacidade.youtube_conformidade` na auditoria só com contagens.

O workflow `ORLA · privacidade · retenção diária` (`n8n/workflows/plataforma/retencao-diaria.json`) chama
`POST /api/v0/manutencao/retencao` às 03:30 (America/Sao_Paulo). A rota executa `core.aplicar_retencao()` com
o papel do app (única função de privacidade que ele pode executar) e grava `privacidade.retencao_aplicada` na
auditoria com as contagens, sem dado pessoal. Falha dispara o alerta por e-mail.
