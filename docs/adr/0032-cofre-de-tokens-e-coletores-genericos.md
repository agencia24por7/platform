# 0032 — Cofre de tokens no app e coletores genéricos por plataforma

- Status: aceito (fase 1 implementada; fase 2 = corte único, ainda não aplicado)
- Data: 2026-11-20
- Relaciona: ADR 0005 (executor por conexão), ADR 0006 (executor de pedido de parceiro Meta), ADR 0009
  (sincronização versionada do n8n), ADR 0010 (endurecimento LGPD), ADR 0011 (conta da chave de API),
  ADR 0024 (revisão app/conexões e coletores n8n)
- Substitui, quando a fase 2 for aplicada: o modelo "uma credencial n8n + um coletor + um executor por
  conexão" de ADR 0005/0024 e o `n8nCredentialVault`

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

- No processo: um mapa de promessas em voo por `connectionId` (chamadas paralelas compartilham a mesma
  resolução).
- Entre processos/réplicas: `SELECT … FOR UPDATE OF t` na linha de `connection_tokens` dentro de uma transação
  do tenant; depois de obter a trava, o cofre **reconfere** o access token cifrado (outro processo pode ter
  renovado) antes de chamar o provedor. Toda gravação exige `versao` lida e a incrementa.
- Escolhido o row lock em vez de advisory lock: a linha já existe, o lock some com a transação e não há
  espaço de chaves para colidir. O custo é segurar uma transação durante a chamada ao provedor (timeout de
  10 s), aceitável no volume atual.

### 5. Revogação ao remover

`revogarEApagar`: decifra, chama o provedor (Google `POST https://oauth2.googleapis.com/revoke token=<refresh>`;
Meta `DELETE /{versão}/me/permissions` com o token no cabeçalho `Authorization`, nunca na URL), registra o
desfecho (`revogado` | `sem_suporte` | `falhou` | `sem_token`) e **sempre** apaga o ciphertext, mesmo se a
revogação falhar ou a decifragem falhar. Token já inválido conta como revogado. A revogação é melhor esforço:
a remoção da conexão nunca fica presa no provedor.

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
reautorizar, falhas }`; auditado em `tokens.renovacao_proativa`. Para um cron diário do n8n.

**Costura de teste:** fora de produção, `comProvedorDeTeste` envolve os provedores reais e responde só a
segredos com prefixo `orla-teste:` (`orla-teste:invalid_grant` simula revogação). Em produção a costura não é
composta (`criarModuloDeTokens` passa `NODE_ENV`) e o próprio provedor ainda confere `process.env.NODE_ENV`;
um segredo com o prefixo iria ao Google e voltaria `invalid_grant`. Não há variável de ambiente que a ligue.

### 7. Banco

Migração `db/migrations/0120_cofre_de_tokens.sql` (fase 1, aditiva, reaplicável):
- `integrations.connection_tokens` (PK `connection_id`, FK composta `(connection_id, organization_id)` para
  `connections(id, organization_id)` `ON DELETE CASCADE`; `tipo`, `ciphertext`, `kms_key_version`,
  `algoritmo`, `segredo_expira_em`, `access_token_ciphertext`/`access_kms_key_version`/`access_expires_at`,
  `refreshed_at`, `ultima_falha_em/codigo`, `versao`, `created_at`, `updated_at`), RLS ENABLE+FORCE com a mesma
  política de `connections` (organização da sessão, sem recorte de cliente).
- Funções SECURITY DEFINER `integrations.resolver_conexao_do_token` e `integrations.tokens_a_renovar`.
- Concessões num bloco único no fim do arquivo, só para o papel do app (`orla_app`). O papel de worker do
  banco (`orla_worker`, em introdução por outro trabalho) **não** recebe a tabela: quem decifra é o app. Se for
  preciso, ajuste só esse bloco.

Migração de corte `db/corte/0121_corte_para_cofre.sql` — **fora de `db/migrations/` de propósito**: nem
`scripts/migrate.mjs` nem `infra/compose/migrar.sh` a aplicam. A fase 2 a move para `db/migrations/` no PR do
corte. Ela:
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
conexão existente e as fontes voltam a coletar sem revincular. `credential_ref`: decidido manter nula no corte
e **remover a coluna** na migração de limpeza final (junto com `coletor_ref`, `executor_ref` e
`corte_para_cofre_refs`), depois da verificação — remover já no corte quebraria o rollback por versão do app.

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

## Plano de migração: corte único

Ordem (cada passo só começa com o anterior verificado):

1. **Terraform do KMS** (PR em `main` → `infra.yml`): anel, chave, IAM e audit config. Verificar o output
   `tokens_kms_key` e que a SA da VM tem o papel só na chave.
2. **Antes do deploy**: exportar o estado (`SELECT id, platform, credential_ref, coletor_ref, executor_ref FROM
   integrations.connections`) para o arquivo de estado do script de limpeza — redundante com
   `corte_para_cofre_refs`, mas sobrevive a um restore.
3. **Deploy do app da fase 2 com a migração de corte** (0121 movida para `db/migrations/`). A partir daqui o
   app não cria mais credencial/workflow no n8n; toda conexão está `reauth_pending`.
4. **Sincronizar os workflows genéricos** (`ORLA · {Plataforma} · coletor`, `ORLA · {Plataforma} · executor`)
   com `npm run n8n:sincronizar`.
5. **Script de limpeza do n8n** (`--aplicar` só depois do dry-run revisado).
6. **Usuário reconecta** cada conexão (checklist abaixo).
7. **Verificação** por conexão e, então, migração de limpeza final.

Janela de indisponibilidade da coleta: do passo 3 até cada reconexão, as coletas daquela conexão não abrem
(a fonte sai de `fontes_de_coleta` porque a conexão não está ativa) e o painel mostra `reauth_pending`. Nada
é perdido: ao reconectar, o modo incremental (ADR 0025) preenche até 28 dias por rodada a partir da última
janela com sucesso. Reconectar em até 28 dias recupera tudo numa rodada; além disso, em rodadas sucessivas.

Checklist de reconexão (por conexão): entrar com a **mesma conta** que concedeu antes (`account_email`
aparece na tela); conceder os mesmos escopos; confirmar que a conexão voltou a `active` com o mesmo nome e as
mesmas contas vinculadas; disparar uma coleta de amostra; para Meta, conferir `expires_at` ≈ 60 dias. Chaves
de API (RD, Apify, Z-API) são coladas de novo.

**Rollback honesto.** Não há volta ao n8n: as credenciais antigas são apagadas no passo 5 e as conexões já
foram reautorizadas no novo modelo. Rollback = restaurar o backup do Postgres anterior ao passo 3 **e** voltar
a imagem do app anterior. Implica: perder tudo que aconteceu no banco depois do backup (reconexões, novas
coletas registradas, edições de contexto) e, se o passo 5 já rodou, as conexões restauradas apontam para
credenciais/workflows que não existem mais — elas ficam quebradas até nova autorização no modelo antigo. Por
isso o passo 5 só roda depois de pelo menos uma reconexão de cada família verificada com sucesso; até lá, o
rollback é limpo (backup + imagem). Dados do BigQuery não são afetados em nenhum caso.

## Especificação do script de limpeza do n8n (fase 2, não implementado)

`scripts/n8n-limpar-pos-corte.mjs`:
- Fonte da lista: `integrations.corte_para_cofre_refs` (ou o arquivo de estado do passo 2, `--estado
  <arquivo>`). Remove **todos** os workflows por conexão referenciados por `coletor_ref`/`executor_ref` e
  **todas** as credenciais referenciadas por `credential_ref` (`n8n:credential:{id}`) antes do corte.
- Rede de segurança: também remove workflows cujo nome case `Coletor · ORLA · coletor · …` ou `Executor · ORLA
  · tarefas · …` **e** que tenham a tag `platform`.
- Nunca toca workflows/credenciais de credaz/agência nem qualquer recurso sem a tag/nota/identificação da
  plataforma; os genéricos `ORLA · {Plataforma} · …` são excluídos por nome exato da lista do sincronizador.
- Dry-run por padrão (lista o que removeria); `--aplicar` explícito. Antes de remover cada workflow, desativa;
  remove a credencial só depois de nenhum workflow restante a referenciar.
- Portão de verificação por conexão: só limpa a conexão cuja linha em `corte_para_cofre_refs` ainda não tem
  `limpo_em`; marca `limpo_em` ao terminar. Idempotente (404 do n8n conta como removido).
- Relatório final (JSON + resumo): removidos, já ausentes, ignorados (com motivo), erros. Sem segredo.

## Contrato da fase 2 (o que muda)

- `src/modules/connections/application/authorizationService.ts`: depois de trocar o código, gravar conexão e
  `CofreDeTokens.guardar` na mesma transação (refresh token para Google; token de longa duração + `expiraEm`
  para Meta); renovar a conexão existente quando `(organização, plataforma, external_id)` já existir; parar
  de chamar `vault.store`, `coletorProvisioner` e `executorProvisioner`.
- `src/modules/connections/application/connectionService.ts`: `guardarChave` ⇒ `guardar(…, 'api_key', …)`;
  `removerConexao` ⇒ `revogarEApagar` + status `revoked` na mesma transação; testar credencial com o segredo
  em claro antes de guardar (como hoje).
- `src/modules/connections/infrastructure/connectionRepository.ts`: `renew`/`revogar` trocam a trava otimista
  por `credential_ref` pela `versao` do cofre; parar de ler `credential_ref`.
- Remover: `n8nCredentialVault.ts`, `credentialVault.ts` (porta), `executorProvisioner.ts`,
  `src/modules/coleta/infrastructure/coletorProvisioner.ts`, `src/shared/n8n/workflowComCredencial.ts`, a
  fiação do vault em `src/composition.ts`, `coletor_ref`/`executor_ref`/`credential_ref` de
  `automation.fontes_de_coleta`/`task_queue` (nova migração).
- n8n: coletores genéricos `n8n/workflows/coletores/` (um por plataforma, `ORLA · {Plataforma} · coletor`)
  que, para cada fonte, chamam `POST /api/v0/coleta/token {coletaId}` logo depois de `abrir` e montam o
  cabeçalho pela `tipo`; executores genéricos `ORLA · {Plataforma} · executor` com `{tarefaId}`; o
  orquestrador deixa de rotear por `coletor_ref` e chama o genérico da plataforma. Cron diário para
  `/api/v0/tokens/renovar-proativo`. Sincronizador (`scripts/n8n-sincronizar.mjs`) passa a publicar só os
  genéricos.
- `db/corte/0121_corte_para_cofre.sql` ⇒ `db/migrations/`; depois da verificação, migração de limpeza final
  (drop de `credential_ref`, `coletor_ref`, `executor_ref`, `corte_para_cofre_refs`).
- Docs LGPD (`docs/lgpd/registro-de-operacoes.md`, `aditivo-google-cloud.md`): Cloud KMS como suboperador
  técnico de chave (não recebe dado pessoal; só chaves de dados).
- Job de recifragem após rotação (lê `kms_key_version` ≠ primária e recifra) antes de desativar versões.

## Consequências

- Um coletor por plataforma em vez de um por conexão; adicionar conexão não cria nada no n8n.
- O app passa a depender do KMS para emitir token: indisponibilidade do KMS só afeta renovações e
  decifragens fora do cache (access tokens cacheados continuam servindo até a margem).
- Rotas novas ficam publicamente roteáveis como as demais `/api/v0`, protegidas pelo Bearer do worker; a
  superfície nova é o access token de curta duração de execuções em andamento.
- Riscos conhecidos: transação aberta durante a chamada ao provedor (pool de 10 conexões; muitas renovações
  simultâneas de conexões diferentes podem disputar o pool); o cache em memória é por processo (perde-se ao
  reiniciar, o cifrado no banco cobre); a costura de teste depende de `NODE_ENV` correto no build de produção
  (garantido por `next build`, e o Dockerfile/compose fixam `NODE_ENV=production`).
