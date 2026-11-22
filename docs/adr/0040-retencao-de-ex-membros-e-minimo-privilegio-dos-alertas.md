---
status: accepted
date: 2026-11-21
---
# ADR-0040: Retenção de ex-membros e menor privilégio nos alertas

## Contexto
A auditoria de 2026-11-21 achou quatro lacunas de retenção e três de privilégio no banco: `core.users` de ex-membros ficava para sempre; o e-mail de convite aceito nunca era anonimizado; o `payload` do WhatsApp não entrava no pedido de exclusão; alertas só eram apagados quando entrava alerta novo. A política de `integrations.connection_invite_items` filtrava só por organização (0028), de modo que um membro recortado enxergava itens de convites de clientes fora do recorte. O papel do app podia dar UPDATE e DELETE em `automation.alertas` pela tela de automações.

## Decisão
1. Ex-membro: `core.aplicar_retencao()` anonimiza `core.users` (nome, e-mail, foto) 90 dias depois do último vínculo revogado e limpa e-mail e IP da trilha. A linha permanece para preservar a trilha de auditoria.
2. Convite aceito: e-mail anonimizado 30 dias após o aceite.
3. `whatsapp_inbound_events.payload` continua com 90 dias e entra em `core.anonimizar_titular()` (limpa o payload que cita o e-mail do titular).
4. Alertas: 90 dias, apagados pela rotina diária. `registrar` não apaga mais.
5. Itens de convite e convites passam a respeitar `core.cliente_no_escopo` na política de RLS (0135). Itens verificam o convite pai.
6. `automation.alertas`: o papel do app só lê. INSERT e UPDATE ficam com `orla_worker` (0136); DELETE só dentro de `core.aplicar_retencao`. Não há papel novo de operador. A ação de "marcar como resolvidos" da tela de automações foi removida; o alerta sai da contagem em 7 dias.

## Substitui
- O trecho do adendo de alertas da ADR 0025 que fala em "política só para o papel do app" e em "um botão para resolvê-los": o app só lê e o botão deixou de existir.

## Consequências
- O prazo de 90 dias dos alertas vive só na SQL de `core.aplicar_retencao`; não há constante no código.
- O e-mail da conta que o ex-membro conectou (`integrations.connections.account_email`) pertence à conexão da organização e não é anonimizado junto com o usuário; sai com a conexão ou no pedido de exclusão (`anonimizar_titular`).
- No payload do WhatsApp só se limpa valor igual ao e-mail do titular; telefone e nome de perfil não são ligados ao e-mail e saem pelos 90 dias.
- Quem precisar resolver alerta antes dos 7 dias faz pelo banco como dono, ou por rota de worker (decisão futura).
- Mudança de prazo continua em `docs/lgpd/retencao.md` e `/privacidade` (seção 8).
- Migrações novas: 0135, 0136, 0137. Nada destrutivo; nada aplicado em produção (o humano aplica pelo `migrar.sh`).
