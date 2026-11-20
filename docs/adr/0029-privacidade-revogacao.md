# 0029 — Revogação no provedor, prazos do YouTube, exclusão pela Meta e posse desconhecida

- Status: aceito
- Data: 2026-11-20
- Revê: ADR 0011 e 0024 (remover conexão), ADR 0022 e 0023 (expurgo e dono por nome)
- Migração: `0080_privacidade_revogacao.sql`

## Contexto

A revisão de privacidade deixou seis pontos abertos:

1. Remover a conexão apagava o token do cofre do n8n, mas o refresh token do Google e a permissão do app na
   Meta continuavam válidos no provedor (Política de Dados de Usuário das APIs do Google; Termos da Plataforma
   Meta). Os ADRs 0011 e 0024 só previam isso no desenho.
2. As Políticas do YouTube API Services (III.E.4.b/c, III.D.2.3.a) exigem renovar ou apagar a cada 30 dias o
   dado da API guardado (títulos e detalhes de vídeos e playlists), e apagar o dado de um canal em até 7 dias
   depois de a autorização ser removida (30 se ela foi revogada no Google).
3. Os Termos da Plataforma Meta (3.d, 4.b) exigem um callback de exclusão de dados.
4. O expurgo não apagava a staging `stg_*` (adiado no ADR 0023).
5. Linhas antigas da trilha só guardavam o nome do dono anterior. Nome ambíguo deixava o dono desconhecido, e
   `reconstruirPosse` empurrava esse período para o próximo dono conhecido, inclusive no expurgo dele.
6. Faltavam testes de exclusão vista por usuário com recorte de clientes e de que o expurgo não toca o homônimo.

## Decisão

### 1. Revogar no provedor ao remover a conexão

**Por que um workflow temporário por conexão.** A API pública do n8n não devolve credencial guardada, e o app
não guarda token. Só o próprio n8n consegue usar a credencial. No n8n, a credencial de um nó é fixa: um id no
JSON, sem expressão. Por isso um único workflow da plataforma não consegue usar "a credencial da conexão X". A
solução usa o mesmo caminho dos coletores. O orquestrador já chama, pelo id, um workflow criado por conexão com
a credencial dela.

- **Modelos por conexão.** Há um modelo para cada provedor: `n8n/workflows/plataforma/revogacao/revogar-google.json`
  e `revogar-meta.json`, registrados em `MODELO_DE_REVOGACAO` (`src/shared/n8n/modelos.ts`). A pasta está em
  `PASTAS_DE_MODELO`, então a sincronização não os implanta como workflows soltos. Ao remover a conexão, o app
  cria o workflow a partir do modelo, já com a credencial da conexão (`montarWorkflow`, o mesmo do executor). Em
  seguida chama o workflow da plataforma e, num `finally`, apaga o temporário.
- **Workflow da plataforma.** `n8n/workflows/plataforma/revogar-acesso.json`, com a tag `platform`. O webhook
  `orla-revogar-acesso` é autenticado com o token do worker (`headerAuth`, credencial "ORLA · worker token"),
  como o backfill. Ele valida o `workflowId`, executa o temporário pelo id (Execute Workflow) e responde
  `{revogado, status}`. Não salva execução (`saveData* = none`, sem `errorWorkflow`).
- **Meta.** O modelo faz `DELETE https://graph.facebook.com/v26.0/me/permissions` com a credencial
  `facebookGraphApi`. O token vai na query `access_token`, como define a credencial
  (`FacebookGraphApi.credentials.ts`, `authenticate.qs`). Sucesso é `200` com `success: true`.
- **Google: o token precisa ir no corpo.** O endpoint `https://oauth2.googleapis.com/revoke` só lê o token no
  corpo ou na query. Conferimos com um token falso: só com `Authorization: Bearer` ele responde
  `invalid_request`; com `token=` no corpo, `invalid_token`. Também não há expressão do n8n que leia o access
  token de uma credencial no nó HTTP. A saída é o **portador**: o modelo do Google chama, com a credencial
  `googleOAuth2Api`, um segundo webhook do mesmo workflow da plataforma
  (`http://localhost:5678/webhook/orla-revogar-google-portador`). O n8n anexa `Authorization: Bearer <access
  token>` a qualquer URL (`token.sign` em `request-helpers/oauth.ts`, sem restrição de domínio quando a
  credencial não declara `allowedHttpRequestDomains`). O portador repassa esse token ao `revoke` no corpo.
  Revogar o access token revoga também o refresh token da concessão.
- **Token vencido.** Se o Google responde `invalid_token`, o portador devolve **401**. No n8n 2.x,
  `requestOAuth2` trata 401 renovando o token pelo refresh token, gravando-o na credencial e repetindo a mesma
  requisição (`shouldRefreshToken` e `retryWithNewToken`; vale também com `neverError` e `fullResponse`). A
  segunda tentativa leva um access token válido. O portador não tem autenticação, por desenho. Ele só revoga o
  token que recebe, então quem o chama só consegue revogar o próprio acesso. O caminho não está entre os
  webhooks públicos do Caddy (ADR 0007).
- **Quando não revogar.** Existe um só cliente OAuth do Google e um só app da Meta para todas as plataformas.
  Revogar derruba então todas as conexões que a mesma pessoa autorizou na família, em qualquer organização.
  `integrations.acesso_compartilhado(conexão)` (SECURITY DEFINER) responde só com um booleano. Ele diz se outra
  conexão não revogada da mesma família tem o mesmo `external_id`, e só para conexão da organização do contexto.
  Se tem, o app não revoga. Também não revogamos chave de API, autorização que não é de usuário (`system_user`,
  `bm_partner`, `mcc`) nem referência sem credencial no cofre.
- **Ordem e falhas.** A revogação vem antes de `vault.discard`, porque sem a credencial não há como revogar. Os
  casos de falha:
  - Falha ao revogar: a remoção segue, como antes.
  - Falha no cofre: continua não alterando nada (ADR 0011). Se a revogação já tinha dado certo, a mensagem diz
    que o acesso já caiu no provedor, e fica `connection.provider_revoked` na trilha.

  `connection.removed` passa a levar `revogadoNoProvedor` (`true`, `false` ou `nao_suportado`) e
  `motivoDaRevogacao`. Com `false` num provedor conhecido, a tela mostra ao admin onde revogar à mão:
  Google em `myaccount.google.com/permissions`, Meta em `facebook.com/settings?tab=business_tools`.
- O executor tem 20 s de prazo. Um workflow temporário que não sai gera `revogacao.workflow_temporario_orfao`
  no log. Como a credencial é apagada logo depois, ele fica inútil.

### 2. Prazos do YouTube

- **"Renovado em".** `carregado_em` das SCD2 só era gravado ao inserir uma versão. As dimensões do YouTube
  (`renovaCarregadoEm: true` no registro) ganham no `sqlScd2` um terceiro passo na mesma transação. Ele grava
  `carregado_em = @agora` na versão aberta cujo hash não mudou, filtrado pela organização. Com isso,
  `carregado_em` passa a ser a última vez que a coleta trouxe a entidade.
- **Job diário** `ORLA · privacidade · YouTube 30 dias`
  (`n8n/workflows/plataforma/youtube-conformidade-diaria.json`, 03:45, antes das dimensões às 04:00) chama
  `POST /api/v0/manutencao/youtube` (`workerRoute`), que faz quatro coisas:
  1. `privacidade.preparar_conformidade_youtube()` troca pelo id do canal o nome de `connection_accounts` do
     YouTube sem nova descoberta há 30 dias. O título do canal é dado da API, e a descoberta renova
     `discovered_at`. A sincronização de dimensões leva o nome novo a `dim_fonte_scd2`.
  2. A mesma função cancela o expurgo de um canal que voltou a ter conexão ativa. Ela também enfileira, com 7
     dias de carência, o canal que ficou sem conexão `active`/`expiring` (revogado no Google, reautorização
     pendente) e que não foi expurgado desde a última descoberta.
  3. Refaz os expurgos vencidos da fila, no máximo 50 por rodada.
  4. No BigQuery (`planoDeConformidadeDoYoutube`), apaga das `dim_youtube_*` do manifesto toda versão com
     `carregado_em` de mais de 30 dias e anula `nome` nas versões encerradas de `dim_fonte_scd2` do YouTube
     com `valido_de` de mais de 30 dias.

  A auditoria registra `privacidade.youtube_conformidade` só com contagens.
- **Expurgo da fonte** `planoDoExpurgoDaFonte` (`scripts/bq/expurgo.mjs`, compartilhado com
  `titular.mjs expurgar-fonte`) recebe `organization_id`, plataforma e `external_id`. Ele apaga todas as
  tabelas do manifesto daquela plataforma e as stagings delas, com a chave exata, sem `LIKE` e com literais
  escapados. Nas plataformas com nome restrito (YouTube), também anula `nome` em `dim_fonte_scd2`. Apaga todos
  os clientes da organização, porque a autorização da fonte acabou para todos.
- **Na remoção.** `removerConexao` de uma conexão do YouTube chama `privacidade.enfileirar_expurgo_da_conexao`.
  Essa função recusa conexão de outra organização e enfileira os canais que nenhuma outra conexão ativa da
  organização alcança. Ela também troca o título pelo id, e o app tenta o expurgo na hora. Se falha, o pedido
  fica na fila (`privacidade.expurgos_de_fonte`, com tentativas e último erro) e o job diário refaz,
  dentro dos 7 dias.

### 3. Callback de exclusão da Meta

- `POST /api/meta/exclusao` é público (`proxy.ts`). Ele tem limite de 30 chamadas por minuto por IP e de 8 KB
  de corpo, e aceita form ou JSON com `signed_request`.
- `lerSignedRequest` faz quatro verificações:
  - formato `assinatura.carga` em base64url;
  - HMAC-SHA256 da carga com `META_APP_SECRET`, comparado em tempo constante e com tamanho conferido antes;
  - `algorithm` igual a `HMAC-SHA256`;
  - `user_id` numérico e `issued_at` entre 24 h atrás e 5 min no futuro. Essa é a janela contra
    reapresentação: a idempotência cobre o que passar dentro dela.
- O id da Meta vira pseudônimo: HMAC-SHA256 com o segredo de sessão como pimenta, como o telefone do WhatsApp
  (ADR 0010). Não há variável nova de infra.
- `privacidade.registrar_pedido_de_exclusao_meta` é idempotente por pseudônimo: com um pedido aberto, devolve
  o mesmo código. Ela liga o pedido às conexões não revogadas da família Meta com aquele `external_id`, em
  qualquer organização (`pedidos_de_exclusao_conexoes`), e grava `privacidade.pedido_de_exclusao_recebido` na
  trilha de cada organização. O id bruto só serve para achar essas conexões e não é gravado.
- A resposta é `{url, confirmation_code}`. A `url` aponta para `/exclusao-de-dados/status/[codigo]`, que mostra
  só a situação e as datas, com `noindex`.
- **Admin.** A tela do conector das plataformas da Meta mostra os pedidos abertos ligados às conexões da
  organização. A RLS é por organização e exige escopo inteiro, como `connections`. O atendimento usa
  `titular.mjs pedidos-de-exclusao listar|andamento|concluir` (concluir exige `--evidencia`) e segue o roteiro
  em `docs/lgpd/atendimento-ao-titular.md`.

### 4. Expurgo da staging

Cada entrada do manifesto declara a `staging` que o registro grava. `registro.test.ts` confere a staging de
cada entrada contra o registro e confere que a staging do DDL tem `organization_id`, a chave da fonte e a
coluna de plataforma.

`expurgar-cliente` apaga a staging pelas fontes do cliente (organização + chave). Faz isso sempre, mesmo se a
fonte mudou de dono: a staging é só o buffer de uma chamada. `expurgarFonte` também apaga a staging.

O DML na staging funciona porque ela é gravada por `INSERT ... SELECT FROM UNNEST(@linhas)`, um job de
consulta, e não por streaming. Não há buffer de streaming bloqueando `DELETE`.

### 5. Posse por nome nas linhas antigas

- **Backfill.** `automation.preencher_ids_de_posse_legados()` roda na migração e pode ser repetida. Ela
  preenche `deId`, `paraId` e `clientId` nas linhas de posse (mover, desvincular, vincular) só com nome. Isso
  só acontece quando o nome aponta para **exatamente um** cliente em toda a história da organização.

  A evidência combina duas fontes. A primeira é o nome atual de cada cliente, excluído ou não. A segunda são
  os pares nome+id que linhas novas da trilha gravaram, o que cobre o nome antigo de cliente renomeado. Não há
  evento `client.renamed`, e `client.create` não grava nome. As linhas preenchidas levam
  `idsPreenchidosPela: '0080'`.
- **Dono desconhecido fica desconhecido.** `reconstruirPosse` grava o período de dono desconhecido como
  `client_id NULL` e `status = 'desconhecido'` (`STATUS_DE_DONO_DESCONHECIDO`), em vez de descartar o histórico
  e estender o próximo dono até 1970. Só o período inicial sem cliente por escolha (descoberta, desvínculo)
  continua absorvido pelo primeiro dono, para o backfill de métricas não ficar órfão.
- **Expurgo só do que é do cliente.** O período de posse já exige `client_id = @id`. As "sobras" e as
  dimensões `todoPeriodo` passam a exigir que a fonte nunca tenha sido de outro cliente **nem** tenha período
  desconhecido. Um teste confere que o texto de `'desconhecido'` é o mesmo nos dois lados.
- **Views.** Linha de fato num período desconhecido aparece sem cliente na época
  (`cliente_na_epoca_* NULL`). Ela não é escondida pelo filtro de excluído, porque não se sabe de quem é.
- **Fontes já carregadas.** A reconstrução só vale na primeira carga de cada fonte. Para refazer uma fonte que
  já tinha sido carregada com o histórico empurrado, siga os três passos de "Implantação". Esse refazer é
  manual porque apaga histórico SCD2.

### 6. Testes

- Unitários com fakes:
  - assinatura válida, inválida, adulterada e truncada; algoritmo; janela de emissão; idempotência por usuário;
  - revogador: compartilhado, não suportado, falhas;
  - executor do n8n: credencial do temporário, token, remoção no `finally`;
  - ordem revogar, cofre, expurgo no `removerConexao`;
  - fila e job do YouTube;
  - SQL do expurgo de fonte, da staging e do prazo de 30 dias;
  - homônimo e dono desconhecido no expurgo;
  - estrutura dos workflows.
- Integração (`tests/privacidade.test.mjs`, banco real no CI):
  - acesso compartilhado entre organizações;
  - fila do YouTube e job;
  - pedido da Meta: RLS por organização e recorte, função só do dono para concluir;
  - backfill de ids, inclusive renomeado e ambíguo;
  - **exclusão vista por quem tem recorte de clientes**;
  - **expurgo que não toca o homônimo**;
  - rota pública do callback e 404 da página de situação.

## Consequências

- Remover uma conexão do Google ou da Meta passa a revogar no provedor. Isso não acontece quando a mesma conta
  sustenta outra conexão; nesse caso a tela explica o motivo e o caminho manual.
- Depois de 30 dias sem renovação, o nome de um canal do YouTube passa a aparecer como o id do canal no app e no
  BI. Reautorizar ou descobrir de novo traz o título de volta. É o preço de cumprir a política sem guardar token
  no app.
- Período de dono desconhecido deixa de ir para o próximo dono, e por isso o expurgo de cliente pode deixar
  para trás linhas desse período, de dono incerto. Escolhemos não apagar dado que pode ser de um homônimo.
- O portador depende de o n8n alcançar a si mesmo em `localhost:5678`. Se a porta interna mudar, o modelo do
  Google precisa mudar junto, e a revogação do Google cai em `false` com o aviso ao admin.
- Riscos aceitos:
  - Um workflow temporário órfão pode sobrar, sem credencial.
  - Corrida entre remover e reautorizar a mesma conta pode revogar o grant novo. A conexão fica com token
    inválido e pede nova autorização, sem dado exposto.

## Implantação

1. Migração 0080. O app atual não usa nada dela.
2. Deploy do app. Inclui `/api/v0/manutencao/youtube`, `/api/meta/exclusao` e a tela de situação.
3. `npm run n8n:sincronizar -- --criar --aplicar`. Ele cria `ORLA · privacidade · revogar acesso no provedor` e
   `ORLA · privacidade · YouTube 30 dias`, ligando a credencial "ORLA · worker token" pelo nome. Sem `--criar`,
   importe os dois JSON à mão (ADR 0009). Os modelos de `plataforma/revogacao/` não são implantados: o app os
   usa a cada remoção.
4. No painel do app na Meta (Configurações do app → Básico → Exclusão de dados do usuário), escolha "URL de
   retorno de chamada para exclusão de dados" com `https://platform.agencia24por7.com/api/meta/exclusao`.
5. Opcional, revisado à mão. Fontes cuja primeira carga em `dim_fonte_scd2` empurrou histórico por dono
   desconhecido podem ser recarregadas em três passos:
   1. listar as fontes com mudança de posse sem dono em `automation.dimensao_mudancas_de_posse()`;
   2. apagar essas chaves de `dim_fonte_scd2`;
   3. chamar `POST /api/v0/manutencao/dimensoes`.

   Esse caminho não é automático porque refaz histórico SCD2.
