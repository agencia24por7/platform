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
| Token de conexão | enquanto a conexão existir | remover a conexão apaga a credencial do cofre (`removerConexao`) |
| Métricas | enquanto o cliente usar a orla | `scripts/titular.mjs excluir-cliente` em até 30 dias do pedido |
| Execuções das automações (n8n) | 14 dias | `EXECUTIONS_DATA_MAX_AGE=336`; fluxos de leads não salvam execução |
| Backups lógicos | 30 dias | ciclo de vida do bucket (`infra/terraform/backup.tf`) |
| Snapshots do disco | 7 dias | política de snapshot (`infra/terraform`) |

## Agendamento

O workflow `ORLA · privacidade · retenção diária` (`n8n/workflows/plataforma/retencao-diaria.json`) chama
`POST /api/v0/manutencao/retencao` às 03:30 (America/Sao_Paulo). A rota executa `core.aplicar_retencao()` com
o papel do app (única função de privacidade que ele pode executar) e grava `privacidade.retencao_aplicada` na
auditoria com as contagens, sem dado pessoal. Falha dispara o alerta por e-mail.
