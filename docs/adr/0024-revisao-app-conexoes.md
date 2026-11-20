# 0024 — Revisão do app de conexões: concorrência, referências degradadas e papel do worker

- Status: aceito (itens 1 a 5 implementados; item 6 é desenho, implementação adiada)
- Data: 2026-11-20
- Complementa: ADR 0011 (conta da chave de API: falha do cofre não altera nada)

## Contexto

A revisão do app de conexões apontou seis problemas, todos verificados no código:

1. Conexão criada sem cofre guarda `credential_ref = 'pendente:cofre-indisponivel'`.
   Com o cofre habilitado depois, `removerConexao` chamava `vault.discard`,
   `credentialIdOf` devolvia `null` e o descarte virava `falhou`: a conexão
   degradada nunca podia ser removida.
2. `renew` era incondicional. Duas renovações simultâneas liam a mesma
   referência X, ambas guardavam uma credencial nova (A e B), ambas gravavam e
   ambas descartavam X. A referência A era sobrescrita por B e A ficava viva no
   n8n, com refresh token válido. A mesma corrida existia entre remover e a
   volta do OAuth.
3. `removerConexao` ignorava a falha de `workflows.remover`: coletor órfão sem
   rastro.
4. O aviso de retorno era montado com `${destino}?aviso=`, quebrando quando
   `voltarPara` já tinha query (`isSafeReturnPath` permite).
5. `BotaoDeEnvio` só desabilita no cliente.
6. O papel `orla_app` executa funções `SECURITY DEFINER` que devolvem todos os
   inquilinos (`dimensao_clientes`, `dimensao_fontes`,
   `dimensao_mudancas_de_posse`, migrações 0041 e 0043), e web e worker usam o
   mesmo papel.

## Decisão

### Referências sem credencial no cofre (item 1)

`semCredencialNoCofre(ref)` é verdadeiro para `pendente:*` e `descartada`.
`descartarCredencial(vault, ref)` devolve `descartada` sem chamar o cofre nesses
casos, e o `discard` do n8n faz a mesma checagem (antes até de `available`).
Uma referência vazia ou malformada de verdade continua `falhou`: só os dois
marcadores que o próprio sistema grava são tratados como "nada a apagar".

### Renovação otimista e ordem de remover (item 2)

- `renew(input, credentialRefEsperada)` vira
  `UPDATE ... WHERE id = $1 AND credential_ref = $esperada RETURNING *` e
  devolve `null` quando nenhuma linha casa. Quem perde descarta a credencial
  **nova** que acabou de guardar e devolve `conflict` com mensagem amigável
  (`MENSAGEM_DE_CONEXAO_ALTERADA`). Vale para `guardarChave`,
  `createConnection` e o callback OAuth (`authorizationService`). A velha só é
  descartada por quem venceu, então cada referência tem exatamente um dono que
  a apaga: não sobra credencial viva sem linha apontando para ela.
- Primeira gravação simultânea (nenhuma conexão ainda): o `INSERT` do perdedor
  viola a unicidade (SQLSTATE 23505). O perdedor descarta a credencial nova
  (a compensação já existente) e devolve o mesmo `conflict`.
- `revogar(org, id, credentialRefEsperada)` ganha a mesma guarda.

Ordem de `removerConexao`, avaliada contra a sugestão de revogar primeiro:

- **Revogar primeiro e descartar depois** (a referência vem de `revogar`)
  quebra o ADR 0011. Se o cofre falha depois da revogação, a linha já está
  `revoked` com `credential_ref = 'descartada'`: a credencial viva fica sem
  nenhuma referência, a tela não oferece mais "remover" e ninguém consegue
  repetir. É o órfão que queremos evitar.
- **Mantida a ordem descartar, depois revogar com guarda de referência.**
  Intercalações possíveis, com X a referência lida por quem remove:
  - renovação confirma X→B antes da leitura: quem remove lê B, tudo normal;
  - renovação confirma X→B depois da leitura e antes de `revogar`: `revogar`
    não casa (ref é B), devolve conflito, a conexão segue `active` com B viva
    e a renovação já descartou X (404 conta como descartada). Nada órfão; o
    usuário tenta de novo;
  - `revogar` confirma antes da renovação: a renovação não casa (ref agora é
    `descartada`), descarta a credencial nova e devolve conflito;
  - cofre falha: nada foi alterado (ADR 0011 preservado).
  O único resíduo é descartar X e depois perder a corrida em `revogar`: X já
  era a credencial que a renovação concorrente iria apagar de qualquer modo, e
  a linha passa a apontar para a vencedora.

### Falha ao remover workflow (item 3)

A remoção continua não falhando por causa do n8n. Cada workflow que não saiu
(retorno `false` ou exceção) gera `logger.warn('conexao.remover.workflow_orfao')`
com `connectionId`, `platform` e `workflowId`, e o evento `connection.removed`
leva `coletorRemovido: false` e `workflowsOrfaos: [ids]` (`true` quando tudo saiu).

### Aviso de retorno (item 4)

`destinoComAviso(destino, aviso)` monta o destino com `URL`/`searchParams`
sobre uma origem interna fixa: respeita query existente, substitui `aviso`
antigo, mantém o fragmento depois da query e codifica o texto. Um destino que
não passa em `isSafeReturnPath` cai em `/integracoes`. Todos os redirects com
aviso em `app/integracoes/**` usam o helper.

### Envio duplo (item 5)

A guarda é o `renew` otimista mais o `23505` do insert: a segunda submissão
recebe a mensagem de conexão alterada em vez de criar outra credencial ou outro
coletor (o conflito acontece antes de `provisionarColetor`). `provisionarColetor`
já é idempotente para saves em série ou simultâneos: `trocarColetorRef` lê o
anterior com `FOR UPDATE`, então cada save apaga exatamente o coletor que
substituiu, e o último vence. Resíduo conhecido: se uma remoção confirmar entre
`provisionar` e `trocarColetorRef`, o coletor novo fica sem dono. Fechar isso
exige `AND status <> 'revoked'` em `trocarColetorRef` e mudar o retorno para
distinguir "não aplicou"; fica como melhoria separada.

### Papel separado para o worker (item 6) — implementado no ADR 0028

Hoje web e worker conectam como `orla_app` e as rotas `/api/v0` (autenticadas
por `TRIA_WORKER_TOKEN`) herdam o EXECUTE das funções `SECURITY DEFINER` que
atravessam inquilinos. Uma falha de injeção ou de autorização numa rota web
alcançaria os dados de todos.

Proposta:

- Novo papel `orla_worker` (`LOGIN`, sem `BYPASSRLS`, sem `SUPERUSER`) com
  `EXECUTE` apenas nas funções do schema `automation` (`fontes_de_coleta`,
  `dimensao_*`, `contexto_de_gravacao`, etc.) e nas tabelas que o worker grava.
  `REVOKE EXECUTE` dessas funções de `orla_app` (e de `PUBLIC`).
- `orla_app` mantém só o que a web usa sob RLS por inquilino (`withTenant`).
- Aplicação: segunda conexão. `DATABASE_URL_WORKER` lida em `src/shared/db`
  por um `withWorker()`/`sqlDoWorker` usado somente pelas rotas `/api/v0/**`;
  se ausente em desenvolvimento, cai em `DATABASE_URL`. As rotas web não
  importam o cliente do worker (regra de lint/teste de fronteira em
  `tests/fronteiras.test.mjs`).
- Compose: `infra/compose/docker-compose.prod.yml` recebe `DATABASE_URL_WORKER`
  ao lado de `DATABASE_URL`. Terraform: novo segredo `database-url-worker` em
  `secrets.tf`, lido em `startup.sh.tftpl` como `read_secret database-url-worker`;
  senha gerada no `bootstrap` (`APP_DB_PASSWORD` ganha irmã
  `WORKER_DB_PASSWORD`).
- Migração: criação do papel e dos `GRANT`/`REVOKE`, numerada pelo dono das
  migrações. Nada de infra muda neste ADR.
- Rollout em três passos compatíveis: (1) migração cria `orla_worker` e dá
  GRANT sem revogar nada; (2) deploy com o segredo e o código usando o novo
  cliente; (3) migração seguinte revoga o EXECUTE de `orla_app`. Rollback:
  reconceder o EXECUTE e apontar `DATABASE_URL_WORKER` para `DATABASE_URL`.
  O teste de integração passa a afirmar que `orla_app` leva `permission denied`
  em `dimensao_clientes()`.

## Consequências

- Uma conexão degradada passa a poder ser removida.
- Nenhuma credencial viva fica sem linha apontando para ela nas corridas
  analisadas; o custo é uma mensagem de "tente de novo" ao perdedor.
- Coletores que o n8n não removeu ficam visíveis na auditoria e no log.
- Interface `ConnectionRepository`: `renew` e `revogar` recebem a referência
  esperada, e `renew` pode devolver `null`.
- Os testes de integração de exclusão de cliente vista por usuário com recorte
  de cliente e da migração do papel do worker dependem do banco real e ficam
  para a mudança que implementar o item 6.

## Adendo (ADR 0029)

- O item "revogar no provedor" saiu do desenho: `removerConexao` revoga antes de `vault.discard` e registra
  `revogadoNoProvedor` em `connection.removed` (ADR 0029, seção 1).
- Os testes de integração de exclusão vista por usuário com recorte de clientes estão em
  `tests/privacidade.test.mjs`; os do papel do worker continuam com o item 6.

## Adendo (ADR 0032, 2026-11-20): cofre no app, trava pela versão do token

- `credential_ref` deixou de existir (migração 0122). Os casos `pendente:cofre-indisponivel` e `descartada` sumiram
  junto: conexão ativa sem token é estado inválido (gatilho adiado `conexao_ativa_exige_token`) e o cofre
  indisponível recusa a autorização em vez de criar conexão `degraded`.
- A trava otimista de `credential_ref` do PR #107 foi substituída pela `versao` de `connection_tokens`: `renew` e
  `revogar` travam a linha da conexão e a do token e só gravam se a versão do token ainda for a lida (ou se
  continuar sem token, quando foi lida sem). Quem leu a versão velha recebe conflito e nada é sobrescrito.
- Não há mais provisionamento de coletor/executor no app nem descarte de credencial no n8n: conexão e token são
  gravados e apagados juntos, numa transação.
