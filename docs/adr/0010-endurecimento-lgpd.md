# 0010 — Endurecimento de privacidade (logs, sessão, WhatsApp e tokens de capacidade)

- Status: aceito
- Data: 2026-11-20
- Issue: 24K-111

## Contexto

A auditoria de LGPD de 2026-11-20 deixou quatro itens de menor prioridade depois da política, da remoção de
conexão e da retenção (`docs/lgpd/`).

## Decisões

### Logs

O logger aplica `redactText` a todo valor string do contexto, além da redação por nome de chave. `redactText`
passou a cobrir `Bearer …`, JWT (`eyJ….….…`) e e-mail (vira `a***@dominio`, mantendo o domínio para depuração).
Telefone fica de fora de propósito: o padrão confundiria IDs numéricos de contas de anúncio, que aparecem nos
logs o tempo todo.

### Sessão revogável

A sessão continua um HMAC sem estado, mas `core.users.sessoes_validas_desde` (migração 0039) recusa toda
sessão emitida antes dele. O logout chama `core.encerrar_sessoes` e a anonimização do titular também encerra as
sessões (`core.anonimizar_titular_e_encerrar`). `currentUser` e a portaria do n8n conferem o corte.
Custo: uma leitura de `core.users` por requisição autenticada, que já acontecia para resolver os vínculos.

### WhatsApp minimizado

Os webhooks (Cloud API e Z-API) gravam um resumo em vez do payload: id, horário e tipo da mensagem, origem do
anúncio (`ctwa_clid`, `source_id`, `source_type`, `source_url`) e um pseudônimo do telefone (HMAC-SHA256 com o
segredo de sessão). Texto, nome e número não são gravados. O pseudônimo é estável para cruzar conversas; trocar
o segredo de sessão quebra a ligação com os avisos anteriores, o que é aceitável. Eventos antigos com payload
completo saem pela retenção de 90 dias.

### Tokens de capacidade continuam em texto claro (risco aceito)

`connections.webhook_token` (URL do webhook da Z-API) e `connection_invites.token` (link de convite de
conexão) não viraram hash. As duas telas os mostram de novo por desenho: a URL é colada na configuração da Z-API
e o link do convite tem botão de copiar na página do cliente. Com hash, elas só poderiam ser exibidas uma vez.
Mitigações: os tokens só dão acesso estreito (receber aviso; iniciar uma autorização), as tabelas ficam sob RLS,
o convite expira, remover a conexão zera o token e o banco não é exposto. Reavaliar se surgir acesso de terceiros
ao banco ou se os tokens passarem a dar acesso a dados.

### E-mail no metadata da auditoria

Mantido: a trilha precisa dizer quem foi convidado ou removido. A base é segurança e prestação de contas; o
e-mail sai com a anonimização do titular e o registro expira em 2 anos.
