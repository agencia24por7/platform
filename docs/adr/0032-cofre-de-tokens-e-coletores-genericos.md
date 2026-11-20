# 0032 — Cofre de tokens no app e coletores genéricos por plataforma

- Status: aceito (fase 1 e fase 2 implementadas; o corte em produção segue o runbook abaixo)
- Data: 2026-11-20
- Relaciona: ADR 0005 (executor por conexão), ADR 0006 (executor de pedido de parceiro Meta), ADR 0009
  (sincronização versionada do n8n), ADR 0010 (endurecimento LGPD), ADR 0011 (conta da chave de API),
  ADR 0024 (revisão app/conexões e coletores n8n)
- Substitui: o modelo "uma credencial n8n + um coletor + um executor por conexão" de ADR 0005/0024, o
  `n8nCredentialVault` e os workflows temporários de revogação de ADR 0029

## Contexto

Hoje cada conexão (autorização OAuth ou chave de API) vira **uma credencial no n8n** e **um workflow coletor**
(e, para Google Ads/Meta, um executor) só dela, porque o nó HTTP do n8n prende a credencial ao nó e não a
escolhe por item. Consequências medidas:

- N conexões ⇒ N credenciais + até 2N workflows clonados; cada mudança de coletor exige re-sincronizar todos
  (ADR 0009) e o provisionamento por conexão é a parte mais frágil do fluxo de autorização (PR #107 precisou
  de trava otimista em `credential_ref` para não perder corrida entre renovar e revogar).
- O app **nunca consegue ler o segredo de volta** do n8n: não renova, não revoga no provedor ao remover a
  conexão (só apaga a credencial do n8n, o grant continua vivo no Google/Meta) e não detecta token perto do
  fim (Meta, ~60 dias) antes de a coleta falhar.
- O segredo fica fora de qualquer controle do app: sem AAD, sem auditoria de quem decifrou, e o
  `N8N_ENCRYPTION_KEY` único protege todas as credenciais de todos os clientes.

Decisão do usuário (2026-11-20): **modo único**. O app assume a custódia dos tokens; tudo que existe hoje no
n8n por conexão (credenciais, coletores, executores, vault, provisionamento) é removido; as conexões atuais
são **reautorizadas do zero** (o segredo delas está no n8n e é ilegível). Não existe coluna `token_custody`
nem coexistência com o caminho n8n.

## Decisão

### 1. Onde guardar o segredo de longa duração

Avaliadas:

**(A) Envelope com Cloud KMS, ciphertext no Postgres (`integrations.connection_tokens`).**
- Atômico com a conexão: autorizar grava conexão e token na mesma transação; remover apaga os dois; não há
  estado "conexão sem segredo" ou "segredo órfão" entre dois sistemas (a origem dos bugs do PR #107).
- RLS/FORCE por organização, igual às demais tabelas de tenant; o backup lógico diário (ADR 0002/backup.tf)
  leva token e conexão consistentes entre si.
- Uma chave KMS, um binding IAM (`cryptoKeyEncrypterDecrypter` só nessa chave). Nenhuma proliferação de
  recursos ou IAM por conexão.
- Cada Encrypt/Decrypt vira log de Data Access do KMS (quem, quando, versão da chave).
- Rotação automática a cada 90 dias por versão de chave; o envelope grava `kms_key_version` e versões antigas
  continuam decifrando.
- AAD = `orla.tokens.v1|{connectionId}|{plataforma}|{finalidade}`: um ciphertext copiado para outra linha (ou
  do access token para o slot do refresh) não decifra.

**(B) Um secret do Secret Manager por conexão, com IAM condicionado por prefixo.**
- Cada conexão cria/apaga um recurso no GCP pelo app: a VM passaria a precisar de `secretmanager.admin` (ou
  `secretVersionAdder` + criação) no projeto — o oposto do privilégio mínimo atual (`secretAccessor` em
  segredos fixos).
- Não é transacional com o Postgres: volta exatamente o problema de dois sistemas que divergem.
- Cota/custo por segredo ativo e por versão; o backup do banco não leva o segredo; restaurar o banco não
  restaura os tokens coerentes.
- Condição IAM por prefixo de nome não isola tenants (a VM é uma só e lê todos de qualquer forma).

**Escolhido: (A).** Nenhum bloqueio encontrado. Tokens são pequenos (< 4 KiB); o envelope usa uma chave de
dados AES-256-GCM aleatória por cifragem, embrulhada pelo KMS com a mesma AAD. Formato binário versionado
(`src/modules/tokens/infrastructure/envelope.ts`): `0x01 | u16 tamanho | chave embrulhada | iv(12) | tag(16) |
corpo`. A chave de dados é zerada depois do uso.

Regras:
- Texto claro nunca é gravado nem logado. Decifra só dentro do cofre (`CofreDeTokens`), no processo do app.
- Access tokens de curta duração (Google): cache em memória por no máximo `expiraEm − 5 min` (teto de 15 min
  para o que não expira), e cópia **cifrada** em `access_token_ciphertext` para não renovar a cada reinício.
- **Falha fechado em produção**: sem `TOKENS_KMS_KEY` com `NODE_ENV=production`, toda cifragem/decifragem é
  recusada (`createChaveMestraFechada`). A chave local (HKDF de `TRIA_SESSION_SECRET`, `algoritmo =
  aes-256-gcm+local`) só existe fora de produção (dev e CI).

### 2. Modelo de ameaça e raio de impacto

| Ameaça | Hoje (credencial n8n) | Com o cofre |
|---|---|---|
| Vazamento do dump/backup do Postgres | credenciais do n8n estão no banco do n8n, cifradas com `N8N_ENCRYPTION_KEY`, que fica no `.env` da mesma VM | ciphertext inútil sem `cloudkms.decrypt` na chave; o dump sozinho não basta |
| Comprometimento da VM | atacante lê `N8N_ENCRYPTION_KEY` e decifra tudo offline, sem rastro | atacante usa a SA da VM para decifrar **online**: cada decifragem fica no log de Data Access do KMS; revogar o binding IAM corta o acesso na hora; não há chave para levar embora |
| Dados de execução do n8n | execuções podem guardar respostas com token (mitigado por `persistenciaDeExecucoes`) | o coletor genérico recebe só access token de curta duração (≤ 1 h Google); refresh token e chave mestra nunca passam pelo n8n. Os workflows genéricos devem manter `saveDataSuccessExecution: none` e não ecoar o token (fase 2) |
| Vazamento em log | — | `redact` já mascara chaves `token/segredo/...`; o cofre só loga `connectionId`, natureza e código da falha; testes garantem que nenhuma linha de log contém segredo ou access token |
| Worker token (`TRIA_WORKER_TOKEN`) vazado | dá acesso às rotas do worker | dá access token **só** de coleta/tarefa em execução, de conexão ativa e cliente ativo, com limite de 30 pedidos/min por execução; auditado em `tokens.acesso.emitido` |
| Troca de ciphertext entre conexões (SQL injection, operador) | n/a | AAD por conexão+plataforma+finalidade: decifragem falha, registrada como `tokens.cifra.falhou` |

O raio de impacto do KMS é o mesmo dos dados (um projeto, uma VM), mas passa a ser **revogável e auditável**,
o que hoje não é.

### 3. Ciclo de vida por provedor

| Família | `tipo` | Renovação | Erro de reautorização |
|---|---|---|---|
| Google (google, ga4, gtm, searchconsole, youtube, gbp) | `oauth_refresh` | `POST https://oauth2.googleapis.com/token` `grant_type=refresh_token` quando o access token (≈1 h) entra na margem de 5 min; se o Google devolver `refresh_token` novo, ele substitui o antigo | HTTP 400 `invalid_grant` (e 401/403 sem código de configuração) ⇒ `reauth_pending`. `invalid_client`/`unauthorized_client` ⇒ falha de configuração do app, **não** marca a conexão |
| Meta (meta, pixel, leadads, whatsapp) | `oauth_long_lived` | o próprio token de longa duração (≈60 dias) é o bearer; a varredura `renovarProativamente` troca via `fb_exchange_token` quando faltam ≤ 15 dias (≈ dia 45), o que a Meta permite com token ainda válido. Validade em `segredo_expira_em` e espelhada em `connections.expires_at` (a tela já mostra "expirando"). Sem `expires_in` na resposta ⇒ assume 60 dias | código 190/102/463/467 ou `OAuthException` não transitória ⇒ `reauth_pending`; códigos 1/2/4/17/32/341/613 e 5xx ⇒ transitória. Token vencido ⇒ `reauth_pending` sem chamar a Meta |
| Chave de API (rdstation, apify, zapi) | `api_key` | nenhuma: cifrada como veio, devolvida como está. Forma: apify `bearer`, rdstation `query` (`?token=`), zapi `chave` (instância:token, o coletor separa) | n/a (401 da plataforma chega pela coleta, `coleta_falhou_por_auth`) |

Versão da Graph: `META_GRAPH_VERSION` de `src/modules/connections/domain/metaGraphVersion.ts` (v26.0).

**Google Ads e developer token.** A memória do projeto registra que o modelo de developer token foi
descontinuado (2026-09-09) e o app já opera no nível Básico com OAuth. O código confirma: a descoberta
(`src/modules/connections/infrastructure/platformDiscovery.ts`) e o coletor atual
(`n8n/workflows/coletores/coletor-google-ads.json`) chamam a Google Ads API **só** com `Authorization: Bearer`
e `login-customer-id`; não há `developer-token` em lugar nenhum do repositório. O coletor genérico de Google
Ads precisa portanto de: `Authorization: Bearer <token da rota>` + `login-customer-id: <managerExternalId da
fonte>` (vem de `/api/v0/coleta/fontes`, não da rota de token). Se a Google voltar a exigir o cabeçalho, ele
entra em `cabecalhosExtras` da resposta da rota, sem mudar o contrato.

### 4. Concorrência: renovação única por conexão

Fase 1 usava `SELECT … FOR UPDATE` e segurava a transação durante a chamada ao provedor (até 10 s). Com o pool
de 10 conexões, renovações simultâneas de conexões diferentes podiam esgotar o pool. Fase 2 troca por uma
**concessão (lease) na própria linha**, sem transação aberta durante a rede:

- No processo: um mapa de promessas em voo por `connectionId` (chamadas paralelas compartilham a resolução).
- Entre processos: `reivindicarRenovacao` é um `UPDATE … SET renovacao_iniciada_em = now() WHERE connection_id =
  $1 AND (renovacao_iniciada_em IS NULL OR renovacao_iniciada_em < now() − 15 s)` numa transação curta, que
  também lê a linha. Quem atualizou é o **dono**: reconfere o access token cifrado (outro processo pode ter
  renovado), decifra, chama o provedor **fora de transação** e grava com `concluirRenovacao`, um compare-and-set
  `WHERE versao = <lida>` que sobe a `versao` e devolve a concessão a nulo. Falha do provedor grava o código e
  libera a concessão (`liberarRenovacao`).
- Quem não é dono espera 250 ms e relê; se o access token novo apareceu, devolve; se a concessão foi liberada
  sem token (dono falhou) ou venceu (dono morreu), reivindica de novo. Depois de 15 s desiste com `indisponivel`
  (o coletor trata como transitória).
- Reautorização durante uma renovação: `guardar`/`renew` gravam segredo novo com `versao + 1` e limpam a
  concessão; o compare-and-set do dono falha, o segredo novo fica e o access token já obtido ainda serve àquela
  execução (registrado como `tokens.gravacao.concorrente`).
- Prazo de 15 s > tempo-limite de 10 s da chamada ao provedor. Testado contra o Postgres real em
  `tests/cofre-banco.test.mjs`: 10 pedidos em 2 processos ⇒ 1 chamada ao provedor, e uma escrita na mesma linha
  durante a renovação termina em milissegundos (sem `idle in transaction`).
- Validade mínima do access token emitido: 30 min para refresh token (Google). O cache (memória e banco) só
  reaproveita token com pelo menos 30 min de folga; uma coleta longa nunca recebe um token que vence no meio e
  vira `reauth_pending` falso.

### 5. Revogação ao remover

`revogarEApagar`: decifra, chama o provedor (Google `POST https://oauth2.googleapis.com/revoke token=<refresh>`;
Meta `DELETE /{versão}/me/permissions` com o token no cabeçalho `Authorization`, nunca na URL), registra o
desfecho (`revogado` | `sem_suporte` | `falhou` | `sem_token`) e **sempre** apaga o ciphertext, mesmo se a
revogação falhar ou a decifragem falhar. Token já inválido conta como revogado. A revogação é melhor esforço:
a remoção da conexão nunca fica presa no provedor. Fase 2: `revogarEApagar(alvo, { revogarNoProvedor, apagar })`
recebe da política se deve tentar (`nao_tentada` quando não) e o apagamento atômico da conexão
(`connectionRepository.revogar(versaoLida)`), que só apaga se a versão do token ainda for a lida.

### 6. Rotas do worker

Ambas no padrão `workerRoute` (Bearer do worker, limite de 120/min por chamador), contratos em
`src/shared/config/contracts.ts`.

`POST /api/v0/coleta/token` — serve coletor **e** executor por entrada discriminada (um único caminho para os
workflows genéricos):

```
pedido:   { "coletaId": uuid }  |  { "tarefaId": uuid }          (exatamente um; corpo ≤ 1 KiB)
200:      { "token": string, "tipo": "bearer" | "query" | "chave", "expiraEm": ISO-8601 | null,
            "cabecalhosExtras"?: { [nome]: valor } }
          Cache-Control: no-store
404       coleta/tarefa inexistente
409       { errors.motivo: "origem_encerrada" | "fonte_inativa" | "reauth_pending" | "conexao_revogada" | "sem_token" }
422       corpo inválido      429  > 30 pedidos/min para a mesma execução      503  provedor/KMS indisponível
```

A travessia de tenant é `integrations.resolver_conexao_do_token(coletaId, tarefaId)` (SECURITY DEFINER,
`search_path` fixo, só ponteiros e estados, no molde de `resolve_coleta_contexto`): coleta `running` de fonte
ainda vinculada, cliente não excluído e ativo, organização ativa; ou tarefa `running`. Conexão precisa estar
`active|expiring|degraded` **e** ter linha no cofre — no modo único, conexão sem token é inválida e a resposta
é `sem_token` (a fase 1 não muda status de ninguém por isso; o corte faz). Auditoria: `tokens.acesso.emitido` /
`tokens.acesso.recusado` com origem, plataforma, forma, validade e motivo — nunca o token.

`POST /api/v0/tokens/renovar-proativo` — `{ "limite"?: 1..200 = 50 }` ⇒ `{ avaliadas, renovadas,
reautorizar, falhas }`; auditado em `tokens.renovacao_proativa`. Chamado a cada 6 h por `ORLA · tokens · renovação`.

**Costura de teste:** fora de produção, `comProvedorDeTeste` envolve os provedores reais e responde só a
segredos com prefixo `orla-teste:` (`orla-teste:invalid_grant` simula revogação). Duas travas independentes
(`costuraDeTestePermitida`): a costura só é composta quando **não** há `NODE_ENV=production`, **não** há
`TOKENS_KMS_KEY` e `TRIA_APP_BASE_URL` é `http://` de host local (`localhost`, `127.0.0.1`, `app`); e cada
chamada reconfere o ambiente do processo na hora. `criarModuloDeTokens` passa o ambiente inteiro (teste de
unidade garante). Um segredo com o prefixo em produção iria ao Google e voltaria `invalid_grant`. Não há
variável de ambiente que a ligue.

### 7. Banco

Migração `db/migrations/0120_cofre_de_tokens.sql` (fase 1, aditiva, reaplicável):
- `integrations.connection_tokens` (PK `connection_id`, FK composta `(connection_id, organization_id)` para
  `connections(id, organization_id)` `ON DELETE CASCADE`; `tipo`, `ciphertext`, `kms_key_version`,
  `algoritmo`, `segredo_expira_em`, `access_token_ciphertext`/`access_kms_key_version`/`access_expires_at`,
  `refreshed_at`, `ultima_falha_em/codigo`, `versao`, `created_at`, `updated_at`), RLS ENABLE+FORCE com a mesma
  política de `connections` (organização da sessão, sem recorte de cliente).
- Funções SECURITY DEFINER `integrations.resolver_conexao_do_token` e `integrations.tokens_a_renovar`.
- Concessões num bloco único no fim do arquivo, seguindo ADR 0028: a tabela é concedida só a `orla_app`
  (o `orla_worker` herda, sob as mesmas políticas RLS, e continua sem privilégio de tabela próprio); as duas
  funções que atravessam inquilinos são revogadas de `orla_app` e executáveis só por `orla_worker` — a web
  nunca resolve token de outra organização. Ajustes de papel ficam só nesse bloco.

Migração de corte `db/migrations/0121_corte_para_cofre.sql` (fase 2; roda no fluxo normal do deploy, atômica
pelo `migrar.sh` de ADR 0028: uma transação com a linha do livro-razão). Ela:
1. copia `credential_ref`, `coletor_ref`, `executor_ref` e o status de cada conexão sem token para
   `integrations.corte_para_cofre_refs` (fonte de verdade do script de limpeza; o arquivo de estado é
   exportado dela);
2. audita `connection.corte_para_cofre` por conexão (status anterior, plataforma, o que tinha no n8n);
3. torna `credential_ref` anulável e a zera; zera `coletor_ref` e `executor_ref`; marca toda conexão não
   revogada como `reauth_pending`; falha tarefas de conta pendentes/rodando;
4. instala o gatilho de restrição adiado `conexao_ativa_exige_token`: conexão `active|expiring|degraded` sem
   linha no cofre aborta a transação.
**Preserva** conexões (mesmo id), `connection_accounts`, `ad_accounts`, vínculos com clientes, histórico de
coletas e todo o BigQuery: reautorizar a **mesma identidade** (mesmo `external_id` na organização) renova a
conexão existente e as fontes voltam a coletar sem revincular. `corte_para_cofre_refs` não tem chave
estrangeira: o ponteiro sobrevive à remoção da conexão para a limpeza do n8n não perdê-lo.

Migração `db/migrations/0122_cofre_modo_unico.sql` (mesmo deploy, logo depois do corte):
1. `connection_tokens.renovacao_iniciada_em` (concessão de renovação, seção 4) e o `CHECK` de
   `ultima_falha_codigo` aceitando dígitos (`http_503`, `meta_190` violavam o padrão da fase 1);
2. `automation.fontes_de_coleta`, `automation.task_queue` e `automation.sync_queue` recriadas **sem**
   `credential_ref`/`coletor_ref`/`executor_ref` e com `tem_token` (e `connection_id` na fila de tarefas),
   executáveis só por `orla_worker` (ADR 0028);
3. **drop** de `credential_ref`, `coletor_ref` e `executor_ref` em `integrations.connections`.

Decisão sobre o drop (revista na fase 2): nada mais lê as colunas depois desta mudança, e o rollback honesto já
era "backup + imagem anterior" (abaixo) — um rollback só de imagem não funcionaria de qualquer forma, porque as
conexões estão `reauth_pending` e as credenciais antigas são apagadas no passo 5. Por isso as colunas saem já,
e os ponteiros ficam só em `corte_para_cofre_refs`. **Pré-condição** de uma migração futura que apague
`corte_para_cofre_refs`: todas as linhas com `limpo_em` preenchido (limpeza do n8n concluída) e a verificação
do runbook feita.

### 8. Infra

`infra/terraform/tokens.tf`: `google_kms_key_ring.tokens` (`{prefix}-tokens`, região da VM),
`google_kms_crypto_key.tokens` (`conexoes`, ENCRYPT_DECRYPT, `GOOGLE_SYMMETRIC_ENCRYPTION`, rotação
`7776000s`, `prevent_destroy`), `google_kms_crypto_key_iam_member.vm_tokens` (SA da VM,
`roles/cloudkms.cryptoKeyEncrypterDecrypter` só na chave), `google_project_iam_audit_config.cloudkms_access`
(DATA_READ, DATA_WRITE, ADMIN_READ), output `tokens_kms_key`; `cloudkms.googleapis.com` em `apis.tf`.
A localização é `var.region` sem variável própria: o startup (`files/startup.sh.tftpl`) deriva
`TOKENS_KMS_KEY` da zona da instância pelo servidor de metadados, para não tocar `vm.tf`; se a derivação
falhar, a variável fica vazia e o cofre falha fechado. `@google-cloud/kms` 6.3.0 (fixado), carregado sob
demanda e externo ao bundle (`serverExternalPackages`).

## Fase 2: o que foi feito

- **Autorização e chave de API.** `authorizationService` (OAuth direto e por convite) e `guardarChave` cifram o
  segredo com `CofreDeTokens.selar` (refresh token para a família Google; token de longa duração da Meta, já
  trocado por `fb_exchange_token`, com `expiraEm` = `expires_in` ou 60 dias; chave de API como veio) e gravam
  conexão + token **na mesma transação** (`connectionRepository.insert/renew` chamam
  `gravarSegredoNaTransacao`). Conexão nova recebe o id antes (UUID do app) porque a AAD inclui o id. Google sem
  refresh token e RD Station por OAuth são recusados (a conexão do RD é por chave). Cofre indisponível recusa a
  autorização: não existe mais conexão `degraded` "sem cofre".
- **Renovar a mesma identidade.** `findByExternalId` devolve `versaoDoToken`; `renew` trava conexão e token e só
  grava se a versão ainda for a lida (ou continuar sem token). Mesma conexão, mesmo id, vínculos e histórico
  preservados; uma conexão `reauth_pending` sem token volta a `active`.
- **Remover.** `removerConexao` → política (`createPoliticaDeRevogacao`) → `CofreDeTokens.revogarEApagar` com
  `apagar = connectionRepository.revogar(versaoLida)` (apaga o token e marca `revoked` numa transação).
  Revogação no provedor é melhor esforço e acontece antes; o apagamento acontece sempre que a conexão não mudou
  no meio. Auditoria `revogadoNoProvedor`, `motivoDaRevogacao`, `cofreApagado` (nomes sem "token"/"segredo", que o `redact` da auditoria mascara); aviso ao admin com o caminho
  manual quando não revogou; expurgo do YouTube depois.
- **Descoberta.** Continua usando o access token recém-concedido, em memória, no próprio fluxo de autorização;
  nenhuma outra descoberta usa token guardado (se surgir, deve usar `obterAcesso`).
- **Tela.** `app/integracoes` mostra **Reautorizar** para conexão `reauth_pending`/sem token (link para o início do
  OAuth da mesma plataforma; para chave de API, "cole a chave de novo") e um aviso explicando que a mesma conta
  renova a mesma conexão. `readinessOf` usa `versaoDoToken`.
- **Removido.** `n8nCredentialVault`, `credentialVault` (porta), `coletorProvisioner`, `executorProvisioner`,
  `src/shared/n8n/workflowComCredencial.ts`, `scripts/provisionar-coletores.mjs`, `--conexoes` do sincronizador,
  `n8n/workflows/plataforma/revogar-acesso.json`, `n8n/workflows/plataforma/revogacao/*`,
  `ExecutorDeRevogacaoN8n` e seus testes. Fica a credencial compartilhada "ORLA · worker token".

### Workflows genéricos

- Coletores: `n8n/workflows/coletores/*.json` (mesmos arquivos) viraram `ORLA · {Plataforma} · coletor`
  (Google Ads, Meta Ads, Google Analytics, Search Console, YouTube, Google Minha Empresa, Google Tag Manager, RD
  Station CRM, Meta Pixel, Meta Lead Ads); executores: `ORLA · Google Ads · executor` (MCC) e
  `ORLA · Meta Ads · executor` (pedido de parceiro). `saveData` none, `callerPolicy: workflowsFromSameOwner`,
  tag `platform` (aplicada pela sincronização).
- Estrutura comum: `Entrada` (ganha `coletaId` ou `tarefaId`) → `Obter token` (`POST
  http://app:3000/api/v0/coleta/token`, credencial "ORLA · worker token", resposta completa, nunca erro) →
  `Token obtido?` → `Retomar entrada` (devolve os itens da `Entrada`, para a lógica receber exatamente o mesmo
  `$json` de antes) → lógica original. Sem token, `Sem token` devolve no formato do coletor: 409
  `reauth_pending`/`sem_token`/`conexao_revogada` ⇒ causa `reauth_pending`; 429 ⇒ `limite_de_uso`
  (`limite_temporario`, 5 min, escopo da fonte); 5xx/sem resposta ⇒ `api_recusou` (transitória); outro ⇒
  `falha_coletor`. Executor sem token ⇒ tarefa falha com `reauth_pending: …`.
- Todo nó HTTP do provedor: `authentication: none` e `Authorization: Bearer {{ $('Obter token').first().json.body.token }}`
  (o Google Ads mantém `login-customer-id`; a Graph aceita Bearer); no RD, `token` vai na query. Nenhum bloco
  `credentials` além do worker token (testes em `src/shared/n8n/workflowsGenericos.test.ts`). A lógica de cada
  coletor (janelas incrementais, lookback, `coleta_incompleta`, `limite_de_uso`, `sem_acesso`, Graph v27.0, limpeza
  de segredo nas mensagens) não mudou; os testes de cada coletor continuam rodando sobre os mesmos nós.
- Orquestrador e janela do backfill: `Tem coletor?` virou `Tem token?` (`fonte.temToken === true` e coleta
  aberta); sem token a coleta fecha `failed` com `reauth_pending` ("reautorize a conexão"). `Chamar coletor`
  escolhe o genérico pela plataforma com `({ ga4: 'origem:n8n/workflows/coletores/coletor-ga4.json', … })[platform]`
  e passa `coletaId`. Tarefas de conta: `Tem token?` e `Executar tarefa` com o mapa dos executores e `tarefaId`.
  As origens são trocadas pelos ids implantados na sincronização (`resolverSubWorkflows`, seção ADR 0009).
- `ORLA · tokens · renovação` (`n8n/workflows/plataforma/tokens-renovacao.json`): a cada 6 h (`15 */6 * * *`),
  `POST /api/v0/tokens/renovar-proativo {limite: 50}` com o worker token, `saveData` none, `errorWorkflow` = alertas
  da plataforma. Registrado em `WORKFLOWS_DA_PLATAFORMA`.

## Runbook do corte em produção

Ordem estrita; cada passo só começa com o anterior verificado. Ninguém roda nada disso a partir de CI.

1. **Terraform do KMS** (PR em `main` → `infra.yml`): anel, chave, IAM e audit config (`infra/terraform/tokens.tf`).
   Verificar o output `tokens_kms_key`, que a SA da VM tem `cryptoKeyEncrypterDecrypter` só nessa chave e que,
   depois do próximo boot/startup, o `.env` da VM tem `TOKENS_KMS_KEY` não vazio (sem ele o cofre falha fechado e
   nenhuma autorização conclui).
2. **Backup e estado** (antes do deploy): conferir que o backup lógico diário de hoje existe; exportar
   `SELECT id, platform, credential_ref, coletor_ref, executor_ref FROM integrations.connections` para um arquivo
   fora do repositório (redundante com `corte_para_cofre_refs`, mas sobrevive a um restore).
3. **Deploy do app** (merge em `dev`/`main` conforme o fluxo normal). O deploy aplica 0121 e 0122 em transação
   (ADR 0028). Verificar no log do deploy `aplicando 0121_corte_para_cofre.sql ... ok` e `0122 ... ok`, e no banco:
   `SELECT status, count(*) FROM integrations.connections GROUP BY 1` (nada `active` sem token),
   `SELECT count(*) FROM integrations.corte_para_cofre_refs` (= conexões antigas). A partir daqui **a coleta
   para** para todas as conexões até cada reconexão (o orquestrador antigo, se rodar antes do passo 4, recebe
   fontes vazias).
4. **Sincronizar os workflows** (pelo túnel IAP, ADR 0009): `npm run n8n:sincronizar` (simulação, revisar) e
   `npm run n8n:sincronizar -- --criar --aplicar`. Ordem automática: `ORLA · plataforma · alertas de falha` →
   10 coletores e 2 executores genéricos → `coleta · backfill · janela` → orquestrador, backfill, tarefas de conta,
   jobs (incluindo `ORLA · tokens · renovação`). Se algum chamador ficar `bloqueado` por genérico ainda não
   implantado, rode `--aplicar` de novo. Conferir que os genéricos têm a tag `platform`, estão publicados e que o
   orquestrador mostra os ids dos genéricos no `Chamar coletor`.
5. **Limpeza do legado no n8n**: `npm run n8n:limpar-legado` (dry-run; lê `corte_para_cofre_refs` pela VM),
   revisar o relatório (removeria/ausente/ignorado com motivo) e só então
   `npm run n8n:limpar-legado -- --aplicar`. Guarda o JSON do relatório (`n8n-limpeza-*.json`). Nunca toca
   credaz/agência, genéricos nem "ORLA · worker token". Rode de novo até `falhas = 0`; é idempotente. Para manter
   o rollback limpo, este passo pode esperar a primeira reconexão bem-sucedida de cada família (Google, Meta,
   chave de API).
6. **Reconectar** cada conexão (tela de conectores → **Reautorizar**): entrar com a **mesma conta** que concedeu
   antes (o e-mail aparece na lista), conceder os mesmos escopos; chaves de API (RD, Apify, Z-API) são coladas de
   novo no formulário do conector.
7. **Verificação por conexão**:
   - `SELECT c.id, c.status, t.tipo, t.versao FROM integrations.connections c LEFT JOIN
     integrations.connection_tokens t ON t.connection_id = c.id WHERE c.id = '<id>'` ⇒ `active` com linha no cofre;
   - o id é o mesmo de antes (`corte_para_cofre_refs`) e `connection_accounts`/`ad_accounts` continuam vinculados
     aos mesmos clientes;
   - disparar o orquestrador (execução manual) e conferir a primeira coleta `success`/`partial` da fonte
     (`automation.coletas`) e linhas novas no BigQuery;
   - Meta: `connections.expires_at` ≈ 60 dias à frente.
8. **Renovação proativa**: executar `ORLA · tokens · renovação` à mão uma vez e conferir a resposta
   `{ avaliadas, renovadas, reautorizar, falhas }` sem falha e o evento `tokens.renovacao_proativa` na auditoria.

**Janela sem coleta**: do passo 3 até a reconexão de cada conexão. Nada se perde: ao reconectar, o modo
incremental (ADR 0025) preenche até 28 dias por rodada a partir da última janela com sucesso; mais de 28 dias de
atraso são recuperados em rodadas sucessivas. Esperado: horas a poucos dias, conforme a disponibilidade de quem
autoriza cada conta.

**Rollback honesto.** Não há volta ao n8n: as colunas de ponteiro saem no deploy (0122) e as credenciais antigas
são apagadas no passo 5. Rollback = restaurar o backup do Postgres anterior ao passo 3 **e** voltar a imagem do
app anterior, e só funciona por inteiro **antes do passo 5** (depois dele, as conexões restauradas apontam para
credenciais/workflows apagados e precisam ser autorizadas de novo no modelo antigo). Restaurar perde tudo que o
banco registrou depois do backup (reconexões, coletas, edições de contexto). BigQuery não é afetado em nenhum caso.

## Script de limpeza do n8n (`scripts/n8n-limpar-legado.mjs`)

- Fonte: `integrations.corte_para_cofre_refs` com `limpo_em IS NULL`, lida por psql na VM (IAP), ou no docker
  local com `--local`. n8n pela API (`N8N_API_URL`/`N8N_API_KEY`, túnel IAP).
- Remove todo workflow cujo id está em `coletor_ref`/`executor_ref` **e** que tenha a tag `platform` ou nome do
  legado; rede de segurança: todo workflow com nome `Coletor · ORLA · coletor · …`, `Executor · ORLA · tarefas · …`
  ou `ORLA · revogação · <uuid>` **e** a tag `platform`. Remove a credencial `n8n:credential:{id}` só depois dos
  workflows e só se nenhum workflow restante a referenciar.
- Nunca remove: workflow com tag credaz/agência (`intocavel`), workflow com nome exato de um workflow da
  plataforma no repositório (`generico_da_plataforma`), recurso sem identificação da plataforma
  (`sem_identificacao_da_plataforma`), credencial usada por quem fica (`credencial_em_uso`) ou com nome de
  credencial compartilhada ("ORLA · worker token": `credencial_compartilhada_da_plataforma`). Na dúvida, ignora e
  relata.
- Dry-run por padrão; `--aplicar` explícito; idempotente (404 conta como ausente); marca `limpo_em` nas conexões
  sem pendência; relatório no terminal (removidos/ausentes/ignorados com motivo/falhas) e JSON (`--log`), sem
  segredo. Lógica em `src/shared/n8n/limpezaDoLegado.ts`, testada com cliente n8n falso.

## Pendências

- Job de recifragem após rotação do KMS (lê `kms_key_version` ≠ primária e recifra) antes de desativar versões
  antigas da chave.
- Migração que apague `corte_para_cofre_refs` depois da pré-condição da seção 7.
- O teste de ponta a ponta do callback OAuth contra o provedor real não existe em CI (não há app OAuth de teste):
  autorização e chave de API são cobertas por testes de unidade com o cofre real (cifra local) e o banco é
  coberto por `tests/cofre-banco.test.mjs`.

## Consequências

- Um coletor por plataforma em vez de um por conexão; adicionar conexão não cria nada no n8n.
- O app passa a depender do KMS para emitir token: indisponibilidade do KMS só afeta renovações e
  decifragens fora do cache (access tokens cacheados continuam servindo até a margem).
- Rotas novas ficam publicamente roteáveis como as demais `/api/v0`, protegidas pelo Bearer do worker; a
  superfície nova é o access token de curta duração de execuções em andamento.
- Riscos conhecidos: o cache em memória é por processo (o cifrado no banco cobre reinícios); revogar no Google um
  refresh token derruba o grant inteiro do usuário naquele app OAuth, por isso a política não revoga quando a
  mesma conta sustenta outra conexão ativa (`acesso_compartilhado`); uma remoção que corre com uma reautorização
  da mesma conta pode revogar no Google o grant recém-concedido (a remoção recebe conflito e a conexão fica, mas
  pode precisar de nova autorização).
