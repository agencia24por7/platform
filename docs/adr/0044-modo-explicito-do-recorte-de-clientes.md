---
status: accepted
date: 2026-11-22
---
# ADR-0044: O recorte de clientes tem modo explícito e recorte vazio nega

Complementa os ADRs 0017 e 0040. Corrige o achado A2 da revisão de tenant.

## Contexto
O recorte de um membro era "a lista de linhas em `core.member_clients`", e lista vazia significava organização inteira, tanto em `core.client_scope_of` quanto em `escopoDoUsuario` e `core.current_clients()`. Três caminhos esvaziavam a lista sem intenção: `core.expurgar_cliente` (apaga o vínculo do cliente expurgado), `replaceScope` com lista vazia e convite cujo recorte resolve a zero clientes. O membro recortado passava a ver a organização inteira. O banco também tratava `app.client_ids` ausente ou vazio como organização inteira.

## Decisão
1. `core.members.escopo` é `'organizacao'` ou `'clientes'` (NOT NULL, CHECK, padrão `'organizacao'`). A migração preenche `'clientes'` (fail-closed) para quem tem vínculo vivo em `member_clients`. Sem vínculo vivo, decide o evento mais recente entre (i) convite aceito do par usuário e organização (com `client_ids` não vazio é restrito; sem recorte é aberto) e (ii) o último `team.scope_changed` da auditoria para o membro (`organizacaoInteira = false` é restrito, `true` é aberto). Isso cobre o membro recortado pela tela de equipe cujos clientes foram expurgados (vínculos apagados) e o membro recortado que foi aberto depois. Sem nenhum sinal, fica `'organizacao'`. `expurgar_cliente` só restringe quem tinha vínculo vivo com o cliente expurgado. Um gatilho em `member_clients` grava `'clientes'` ao inserir ou reativar vínculo, para que o app antigo nunca amplie acesso.
2. `core.client_scope_of(user, org)` devolve NULL (organização inteira) só quando `escopo = 'organizacao'` e o membro não tem nenhum vínculo vivo em `member_clients` (`revoked_at IS NULL`). Se `escopo = 'clientes'` ou existe vínculo vivo, devolve a lista, que pode ser vazia. Vínculos vivos com `escopo = 'organizacao'` restringem em vez de abrir: durante um deploy escalonado a versão antiga do app nunca amplia acesso. Quem não é membro vivo recebe lista vazia, exceto o criador de uma organização ainda sem membros dentro da janela de 15 minutos do cadastro (ADR 0045).
3. Lista vazia é "nenhum cliente": o app envia `nenhum` em `app.client_ids` e o banco devolve `ARRAY[]`.
4. `core.current_clients()` só devolve NULL para `'*'` explícito. Valor ausente ou vazio vira "nenhum". O app, o worker e as entradas públicas sempre enviam `'*'` explícito (`ORGANIZACAO_INTEIRA`).
5. Definir o recorte é uma operação com modo: `{ modo: 'organizacao' }` remove as linhas e grava `'organizacao'`; `{ modo: 'clientes', clientIds }` exige lista não vazia, todos os ids existentes, vivos e da organização, ou falha sem alterar nada. O convite carrega o modo e vale a mesma validação na criação e na aceitação; se na aceitação o recorte resolver a zero clientes, o membro entra com `'clientes'` e acesso nenhum.
6. `core.expurgar_cliente` continua apagando o vínculo; o membro que fica sem clientes passa a ter acesso nenhum, sem ampliar. A tela de equipe sinaliza esse estado.

## Consequências
- Nenhum caminho transforma "sem clientes" em "tudo".
- A função de escopo e a política de convite (0135) usam a mesma regra, testada no banco e no app.
- O sinal `'*'` virou obrigatório em qualquer script ou teste que consulte como `orla_app` sem passar por `withTenant`.
