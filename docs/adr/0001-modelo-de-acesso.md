# 1. Modelo de acesso: organização, papel e recorte por cliente

Data: 2026-11-09
Situação: aceita

## Contexto

O app precisava cobrir nove situações que a vida de agências, empresas e freelancers
produz todo dia e que o modelo anterior não resolvia: a segunda pessoa entrando na
equipe, alguém saindo e perdendo o acesso, a pessoa que atende duas agências, o
cliente querendo ver os próprios dados, a conta vinculada ao cliente errado, a coleta
de um cliente que precisa parar, o contrato que termina, o freelancer que vira
agência e a mesma conta de anúncio servindo a dois clientes.

Três restrições pesaram em todas as decisões: o app nasce sem credencial e sem
usuário embutido, guarda só o estritamente necessário, e tudo o que muda acesso ou
dado precisa ficar auditável.

## Decisão

**O vínculo não se apaga, se revoga.** `core.members` ganhou `revoked_at` e
`revoked_by`. `core.memberships_of` passou a filtrar vínculos vivos, então revogar
tira o acesso no próximo pedido sem apagar o passado. O mesmo vale para convites e
para o recorte por cliente. O papel `tria_app` continua sem `DELETE` nessas tabelas,
e há teste que falha se isso mudar.

**O convite é por e-mail e não carrega segredo.** `core.invitations` guarda o
destinatário, o papel, quem convidou, a validade e o recorte. Quem entra com aquele
e-mail no Google recebe o vínculo. Não existe link com token: o aceite só vale
quando o e-mail do convite e o e-mail verificado pelo provedor são o mesmo, checado
dentro de `core.accept_invitation`. Convite não cria dono — há `CHECK` no banco e
validação no domínio.

**O recorte nasce com o convite.** `core.invitations.client_ids` entra junto com o
vínculo no momento do aceite. Sem isso existiria uma janela entre aceitar e
restringir em que a pessoa convidada enxergaria a organização inteira — exatamente o
risco que o cenário do cliente final introduz.

**O recorte é aplicado pelo banco, não pela tela.** `core.member_clients` guarda
quais clientes a pessoa enxerga; nenhuma linha significa organização inteira.
A sessão abre a transação com `app.client_ids` resolvido por `core.client_scope_of`,
e as políticas de `core.clients`, `integrations.ad_accounts`, `metrics.metrics_daily`,
`metrics.metrics_restatements` e `automation.sync_runs` passaram a exigir
`core.cliente_no_escopo`. Equipe, conexões, tarefas, convites e trilha ficam fora de
alcance de quem entra com recorte: são dados da organização, não do cliente.

O escopo é resolvido em `withTenant`, não passado de mão em mão pelos repositórios.
Um repositório novo herda a restrição sem precisar lembrar dela.

**A organização ativa é uma escolha validada.** Antes, `memberships[0]` decidia
sozinho. Agora um cookie guarda a escolha e ela só vale se corresponder a um vínculo
real — é assim que a mesma pessoa atende duas agências sem misturar as duas.

**Pausar e arquivar valem onde o trabalho é escolhido.** `automation.sync_queue`
passou a exigir cliente e organização ativos, e `resolve_account_organization`
devolve a situação do cliente para que uma coleta em curso seja recusada. A decisão
de negócio para a coleta de fato, não só a listagem.

## O cenário que continua recusado

Uma conta de anúncio pertence a um cliente por vez. A restrição
`ad_accounts_unique_external (organization_id, platform, external_id)` segue de pé,
por decisão e não por esquecimento: se a mesma conta respondesse a dois clientes, a
métrica diária deixaria de ter dono único e todo relatório passaria a depender de uma
regra de rateio que ninguém pediu. O caso real — a conta está no cliente errado, ou o
contrato mudou de mãos — é atendido movendo a conta, que leva o histórico junto e
grava `ad_account.reassigned` na trilha. A mensagem de erro diz isso e aponta o
caminho.

## Consequências

A trilha ganhou `team.invited`, `team.invitation_revoked`, `team.joined`,
`team.role_changed`, `team.member_revoked`, `team.scope_changed`,
`client.status_changed`, `ad_account.reassigned`, `ad_account.sync_paused`,
`ad_account.sync_resumed`, `organization.type_changed` e
`identity.organization_switched`.

`organizations.list()` saiu: devolvia todas as organizações para qualquer visitante
quando a pergunta era só "já existe alguma?". No lugar entraram `exists()` e
`byIds()`.

Resolver o recorte custa uma consulta por transação de inquilino, memoizada por
pedido. É o preço de não poder esquecer a restrição.
