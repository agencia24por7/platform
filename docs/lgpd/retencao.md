# Retenção de dados

Fonte da verdade dos prazos publicados em `/privacidade` (seção 8). Mudou um prazo aqui, muda lá e no código.

| Dado | Prazo | Como é aplicado |
|---|---|---|
| IP na trilha de auditoria | 6 meses | `core.aplicar_retencao()` (diária) |
| Registro da trilha de auditoria | 2 anos | `core.aplicar_retencao()` |
| Logs da aplicação no Cloud Logging (linhas de erro e eventos, com `userId` pseudônimo em `client.erro`) | 3 dias por padrão, ajustável de 1 a 30 (`logs_na_nuvem_retencao_dias`); não consta em `/privacidade` | retenção do bucket `<prefixo>-aplicacao` no Terraform (ADR 0054); a trilha de auditoria do Postgres não é afetada |
| Eventos de login de quem não tem organização | 30 dias | `core.aplicar_retencao()` |
| E-mail de convite vencido ou cancelado | 90 dias após vencer/cancelar | `core.aplicar_retencao()` (vira `removido+<id>@invalid`) |
| E-mail de convite aceito | 30 dias após o aceite | `core.aplicar_retencao()` (vira `removido+<id>@invalid`) |
| Conta Google que entrou sem acesso liberado | 30 dias sem login | `core.aplicar_retencao()` (só se não tiver vínculo, convite aberto nem referência) |
| Ex-membro (`core.users` com todos os vínculos revogados) | 90 dias após o último vínculo revogado | `core.aplicar_retencao()` anonimiza nome, e-mail e foto e limpa e-mail e IP da trilha (e-mail da conta conectada fica com a conexão da organização); a linha fica para preservar a trilha de auditoria |
| Avisos do WhatsApp (`whatsapp_inbound_events`) | 90 dias; o `payload` que contém o e-mail do titular é limpo no pedido de exclusão (telefone e nome de perfil saem pelos 90 dias) | `core.aplicar_retencao()` e `core.anonimizar_titular()` |
| Alertas de falha da plataforma (`automation.alertas`) | 90 dias | `core.aplicar_retencao()` (a rotina diária apaga; entrar alerta novo não apaga mais) |
| Estado do corte para o cofre (`integrations.corte_para_cofre_refs`: ids de workflows e credenciais do n8n do modelo antigo, sem segredo) | até a migração 0123 (aplicada em 2026-11-21; a tabela deixou de existir) | A limpeza do n8n removeu as credenciais e marcou `limpo_em`; com todas as linhas marcadas, `db/migrations/0123_remover_legado_do_cofre.sql` apagou a tabela e as colunas legadas (ADR 0032, ADR 0035). Só o superusuário lê a tabela (RLS sem política para o app) |
| Token de conexão (ciphertext em `integrations.connection_tokens`) | enquanto a conexão existir | remover a conexão revoga o acesso no Google ou na Meta antes de apagar (salvo conta que sustenta outra conexão; aí a tela mostra o caminho manual) e apaga o ciphertext na mesma transação que marca a conexão como revogada (`removerConexao` → `CofreDeTokens.revogarEApagar`, ADR 0029, ADR 0032). O backup lógico diário leva o ciphertext, inútil sem a chave do KMS |
| Dados da API do YouTube nas dimensões (`dim_youtube_video_scd2`, `dim_youtube_playlist_scd2`: títulos e detalhes) | 30 dias sem renovação | a coleta renova `carregado_em`; o job `ORLA · privacidade · YouTube 30 dias` (03:45) apaga versão com `carregado_em` de mais de 30 dias (ADR 0029) |
| Nome do canal do YouTube (`connection_accounts.name`, `dim_fonte_scd2.nome`) | 30 dias sem nova descoberta | o mesmo job troca o nome pelo id do canal no Postgres e anula o nome nas versões encerradas há mais de 30 dias no BigQuery |
| Todos os dados do YouTube de um canal (fatos, dimensões, staging) depois que a autorização acaba | 7 dias da remoção da conexão; 30 se revogada no Google | `removerConexao` enfileira e expurga na hora (`privacidade.expurgos_de_fonte`); o job diário refaz falhas e enfileira, com 7 dias de carência, canal sem conexão ativa (ADR 0029) |
| Pedido de exclusão recebido da Meta (`privacidade.pedidos_de_exclusao`: pseudônimo do usuário, código, situação, evidência) | enquanto houver base legal (prova do atendimento) | sem id da Meta; atendido em até 15 dias com `titular.mjs pedidos-de-exclusao` |
| Métricas e dados de um cliente excluído | enquanto houver base legal (contrato, obrigação, exercício de direitos); a exclusão é lógica | `scripts/titular.mjs excluir-cliente` esconde do app e das views `vw_*` sem apagar (ADR 0022); `expurgar-cliente` elimina em até 30 dias do pedido quando a eliminação for obrigatória |
| Histórico de dono das fontes e dos clientes no BigQuery (`dim_fonte_scd2`, `dim_cliente_scd2`; nomes de cliente e de fonte, dado de negócio) | enquanto houver base legal; cliente excluído ganha versão com `status = 'excluido'` | `expurgar-cliente`: apaga de toda tabela-base com `client_id` (ADR 0013, ADR 0022) |
| Contexto do cliente (`core.client_context_*`, revisões incluídas, e o prefixo do cliente no bucket) | enquanto o cliente existir; exclusão lógica esconde do app e revoga os links | expurgo: `core.expurgar_cliente` apaga as linhas por `ON DELETE CASCADE`; `expurgarArmazenamento` apaga o prefixo `orgs/{org}/clientes/{cliente}/` no bucket, versões incluídas (ADR 0026) |
| Regras, limites e decisões do cliente (`core.client_decisions` e `core.client_decision_events`) | enquanto o cliente existir; decisão nunca se edita nem se apaga pelo app | expurgo: `ON DELETE CASCADE` a partir de `core.clients`. Dado pessoal digitado por engano: `core.redigir_decisao` (só `orla_worker`) troca título, contexto, texto, evidência e "em nome de" (`on_behalf_of`) por `[redigido]`, troca o motivo livre dos eventos da decisão (`reason` de revogação, rejeição e efetivação) por `[redigido]`, percorre a cadeia de supersessão nos dois sentidos, mantém as linhas e grava um evento `redigida` com motivo por decisão afetada (ADR 0051 §7). Roteiro manual que a função não cobre: ver "Redação de regras e decisões" abaixo |
| Link público do mapa de contexto | até vencer (padrão 30 dias, máx. 90) ou ser revogado; o registro fica com o cliente | só o hash do token é guardado |
| Execuções das automações (n8n) | 14 dias | `EXECUTIONS_DATA_MAX_AGE=336`; fluxos de leads não salvam execução |
| Staging do BigQuery (`stg_*`: linhas de uma chamada de gravação, sem `client_id`) | 7 dias | `partition_expiration_days = 7` no DDL; o expurgo de cliente e o de fonte também apagam a staging, por organização + chave da fonte (ADR 0029) |
| Linhas apagadas ou alteradas no BigQuery (time travel do dataset) | 7 dias + 7 de fail-safe do Google | padrão do dataset (`max_time_travel_hours` 168, `infra/terraform/bigquery.tf`); um expurgo só some de vez do BigQuery depois desse prazo (ADR 0023) |
| Arquivos do contexto do cliente (bucket `-contexto`: logos, manual de marca, CSV, imagens; exportação derivada) | enquanto o cliente existir; exclusão lógica despublica os derivados (`contexto/brain/`, `brain/`) e deixa `arquivos/` sem rota de leitura; `expurgar-cliente` apaga todas as gerações do prefixo `orgs/{org}/clientes/{cliente}/` antes do Postgres | rota `POST /api/v0/manutencao/expurgar-armazenamento` chamada pelo `scripts/titular.mjs` (ADR 0027, 0033) |
| Objetos órfãos do envio de arquivo (envio que falhou depois de gravar no bucket) | até a próxima varredura, no mínimo 1 hora | varredura em `publicar-pendentes` / `POST /api/v0/contexto/varrer-arquivos`: reserva não consumida e objeto de `arquivos/` sem registro (ADR 0033) |
| Prazo efetivo do apagamento físico no bucket depois do expurgo | 7 dias | o `soft_delete_policy` do bucket mantém o objeto apagado recuperável por 7 dias; só então some de vez. É o atraso efetivo do expurgo no armazenamento (ADR 0033) |
| Arquivos apagados do contexto (soft delete) | 7 dias | `soft_delete_policy` do bucket (`infra/terraform/contexto.tf`); depois disso somem de vez (ADR 0027) |
| Versões antigas dos arquivos do contexto | 90 dias, até 5 por arquivo | ciclo de vida do bucket de contexto (`infra/terraform/contexto.tf`) |
| Backups lógicos | 30 dias | ciclo de vida do bucket (`infra/terraform/backup.tf`) |
| Snapshots do disco | 7 dias | política de snapshot (`infra/terraform`) |

## Agendamento

O workflow `ORLA · privacidade · YouTube 30 dias` (`n8n/workflows/plataforma/youtube-conformidade-diaria.json`)
chama `POST /api/v0/manutencao/youtube` às 03:45, antes da sincronização de dimensões das 04:00, e grava
`privacidade.youtube_conformidade` na auditoria só com contagens.

O workflow `ORLA · privacidade · retenção diária` (`n8n/workflows/plataforma/retencao-diaria.json`) chama
`POST /api/v0/manutencao/retencao` às 03:30 (America/Sao_Paulo). A rota executa `core.aplicar_retencao()` com
o papel `orla_worker` (a migração 0070 tirou a permissão do papel do app; só o worker executa) e grava `privacidade.retencao_aplicada` na
auditoria com as contagens, sem dado pessoal. Falha dispara o alerta por e-mail.

## Redação de regras e decisões: roteiro manual restante

`core.redigir_decisao` cobre as tabelas de Regras. Para um pedido de titular sobre texto que também veio de outro lugar, o operador da plataforma completa à mão:

1. **Decisão migrada do Contexto** (contexto ou evidência dizem "Migrado do Contexto (campo …)"): a linha de origem em `core.client_context_entries` (mesmo `client_id` e `field_key`) e as revisões em `core.client_context_revisions` ainda guardam o texto. Esses campos saíram do catálogo e não aparecem na tela: a limpeza é por SQL do operador, com autorização nomeada em produção (ADR 0046). O livro `core.regras_migracao_contexto` não guarda texto e garante que a migração não recrie a decisão.
2. **Brain publicado no bucket** (`regras.md`, `decisoes.jsonl`): a redação marca o Brain do cliente como pendente e a próxima publicação sai sem o texto. As gerações anteriores no bucket expiram pelo ciclo de vida em 90 dias; para remover antes, o operador apaga as gerações do prefixo `brain/` do cliente.
3. A evidência nunca é exportada ao Brain nem ao agente, então não há cópia dela fora do Postgres.

