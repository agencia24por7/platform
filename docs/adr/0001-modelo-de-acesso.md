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

## Adendo: as fronteiras entre inquilinos (migração 0021)

A revisão do modelo encontrou cinco lugares em que a fronteira era mais larga do
que precisava ser. Todos vinham de antes do recorte por cliente.

**A identidade era da plataforma inteira.** `core.users` tinha política
`USING (true) WITH CHECK (true)`: qualquer sessão lia o cadastro de qualquer
pessoa da plataforma e podia reescrevê-lo. Reescrever um e-mail é grave de um
jeito específico, porque `core.accept_invitation` casa convite com e-mail
verificado. Agora cada sessão enxerga a si mesma e quem divide a organização com
ela, e o `INSERT` saiu das mãos do app: o login escreve por
`core.upsert_identity`, porque a identidade é gravada antes de existir sessão.

**Qualquer sessão lia todas as organizações.** `organizations_read` liberava a
tabela inteira quando não havia contexto, e `organizations.list()` usava isso
para responder "já existe alguma?". A leitura passou a exigir contexto e vínculo
vivo, e as três perguntas que precisavam atravessar inquilino viraram funções
`SECURITY DEFINER`: `core.any_organization_exists`, `core.slug_taken`,
`core.organizations_of`. Criar organização também: `core.create_organization`,
já que o `INSERT` acontece antes de existir a quem pertencer.

**Pertencer não podia ser uma consulta sob RLS.** A primeira versão da política
nova perguntava o vínculo lendo `core.members` dentro do `USING`. Como a própria
`core.members` é escondida de quem entra com recorte, o cliente final deixava de
enxergar a própria organização. Pertencer é fato da organização, não do recorte:
virou `core.is_member`, `SECURITY DEFINER`.

**A trilha aceitava evento forjado.** `audit_insert` tinha `WITH CHECK (true)`.
Agora só aceita evento da organização do contexto.

**A faxina de passagens apagava passagem viva.** `core.handoff_consumed` tinha
`DELETE` com `USING (true)`. Apagar um jti ainda vivo devolveria à passagem o
direito de ser usada de novo, dentro da janela de 60 segundos. O `DELETE` passou
a alcançar só `expires_at < now()`.

Para isso a transação de inquilino ganhou um terceiro ajuste: além de
`app.organization_id` e `app.client_ids`, agora carrega `app.user_id`, resolvido
do cookie assinado antes de a transação abrir. Sem ele a política sabia de qual
organização se tratava, nunca de quem estava pedindo.

**O que ficou assumido e virou teste.** Nenhuma dessas funções fixa `search_path`
por linha, porque fixá-lo impede a inlinização e `core.cliente_no_escopo` roda
uma vez por linha. A segurança vem de `tria_app` não poder criar objeto em lugar
nenhum — sem `CREATE` em schema nem no banco, não há onde pôr uma função que
sombreie as usadas nas políticas. Isso era uma suposição; agora é
`tests/fronteiras.test.mjs`, junto com: toda tabela de negócio com RLS ligada e
forçada, toda tabela com RLS tendo ao menos uma política, toda função
`SECURITY DEFINER` com `search_path` fixo e nenhuma delas executável por
`PUBLIC`.
