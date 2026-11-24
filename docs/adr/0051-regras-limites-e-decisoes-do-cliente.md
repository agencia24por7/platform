---
status: accepted
date: 2026-11-24
---
# ADR-0051: Regras, limites e decisões do cliente são registros imutáveis, numa fonte só

Supera o trecho "Adiado: Metas e limites" do ADR 0036. Complementa os ADRs 0001, 0026, 0030, 0033, 0041, 0044, 0045, 0049 e 0050. O número 0050 está reservado para a página do cliente (24K-113), ainda fora de `dev`.

## Contexto
O Contexto do cliente guarda o que é descritivo e, misturado a ele, o que é normativo (orçamento, o que não pode ser dito, quem aprova). Nada impõe esses valores e nada guarda quem decidiu, quando e por quê. Antes de existir agente, falta a camada que diz o que pode, o que não pode, até quanto e o que já foi decidido.

## Decisão

### 1. Fonte única
Regra, limite e restrição vivem só em Regras (terceira aba da página do cliente, depois de Conexões e Contexto). Os campos normativos saem das seções J e K do Contexto; o que já estava preenchido migra para decisões. O Contexto fica só com o descritivo.

### 2. Limite é dado
`core.limit_definitions` guarda os tipos de limite. Criar um tipo novo é inserir uma linha, sem deploy. O código não conhece chave de limite pelo nome. A única parte fixa é o vocabulário de **medidas** que o sistema sabe calcular (`gasto`, `custo_por_aquisicao`, `custo_por_lead`, `retorno`): medida nova exige código.
Definição não se edita: mudar unidade ou faixa cria **versão nova** (`version` sobe, mesma `key`); a decisão guarda a versão vigente quando foi registrada. Desativar (`active = false`) não apaga.

### 3. Quatro eixos independentes
- **Categoria:** `investimento`, `eficiencia`, `publico`, `etica_marca`, `segmento`, `governanca`, `processo`.
- **Natureza:** `limite` (valor tipado), `regra` (texto normativo), `decisao` (fato pontual do processo).
- **Origem:** `cliente`, `agencia`, `agente`.
- **Força:** `dura` (bloqueia), `orientacao` (pesa, não bloqueia).
As seis primeiras categorias são declaradas por pessoas; `processo` recebe pessoas e agentes. `limite` só existe nas categorias `investimento` e `eficiencia`.

### 4. Ciclo de vida e autoridade
`proposta` → `vigente` → `superada` | `revogada`; `proposta` → `rejeitada`.
- Pessoa com permissão registra direto como `vigente`.
- Agente registra `decisao` de `processo` como `vigente` e qualquer `limite` ou `regra` só como `proposta`. A origem `agente` é definida pelo servidor, nunca pelo corpo.
- Agente nunca torna vigente, aumenta nem revoga limite ou regra.
- Uma vigente por cliente, chave e escopo (índice único parcial). `decisao` de processo não ocupa o índice: não tem chave exclusiva.
- Superar: a nova nasce vigente na mesma transação em que a anterior (vigente, mesma chave e escopo) vira `superada`. Na v1 a alteração vale a partir de hoje: início futuro com `supersedes_id` é recusado no serviço e no banco (gatilho de inserção e efetivação de proposta), porque a anterior deixaria de valer antes da nova e o cliente ficaria sem limite até a data. Registro novo, sem supersessão, aceita início futuro.
- **O que o banco garante sobre autoridade.** O banco não prova que o chamador é agente: `origin` vem do serviço. Por isso, para os papéis do app e do worker, limite ou regra que nasce vigente com origem diferente de `agente` exige `decided_by` (uma pessoa); `decided_by`, quando presente (qualquer natureza e status), tem de ser o `app.user_id` da transação e membro vivo da organização (`core.is_member`), para o app **e** para o worker; eventos `efetivada`, `revogada` e `rejeitada` exigem `actor_kind = usuario` com `actor_user_id` igual ao `app.user_id` e membro vivo; `actor_kind = agente` nunca efetiva, revoga nem rejeita limite ou regra; origem `cliente` nunca nasce vigente em limite ou regra; `created_at` é sempre `now()` para o app e o worker (o teto diário do agente não se burla por data retroativa), exceto no script de migração do Contexto (papel do worker, origem diferente de `agente`, GUC local `orla.migracao_contexto`), que preserva a data original. Essas checagens ficam em gatilhos sem `SECURITY DEFINER` (enxergam o papel real). **Limite da garantia:** `app.user_id` é autodeclarado pelo chamador (o app o define a partir da sessão; o worker, quando age por uma pessoa, também o declara). A checagem defende contra bug de código (gravar em nome de outra pessoa, de quem não é membro, ou sem pessoa), não contra quem tem a credencial do worker. A porta HTTP do agente só cria proposta ou decisão de processo com origem `agente` e sem `decided_by`.
- Uma decisão nunca se edita nem se apaga. Só há "Alterar" (supera) e "Revogar" (motivo obrigatório).

### 5. Respostas às seis perguntas (padrões assumidos do pedido, aceitos pelo dono do produto)
1. Aumento de limite pela agência registra "em nome de" e marca `sem_confirmacao_do_anunciante` quando não há evidência; não exige confirmação prévia. **Efetivar proposta de limite revalida**: a definição (key, versão) precisa estar ativa, o valor dentro da faixa, a vigência não pode ter vencido, e o serviço recalcula se a proposta afrouxa o limite vigente; se afrouxa e não tem evidência, a efetivação exige motivo (3 ou mais caracteres). **A confirmação fica no evento**: a decisão é imutável e mantém o `without_advertiser_confirmation` com que nasceu; o evento `efetivada` leva o motivo e a auditoria `client.rule.proposal_accepted` registra `flexibilizaSemEvidencia`.
2. O cliente não escreve direto pelo link público: no máximo propõe, e uma pessoa da agência efetiva. A Fase 7 (link público) **fica fora desta entrega** e não existe rota pública; o modelo já tem `via_link_id` e origem `cliente` para a fase futura.
3. Papéis: `viewer` lê; `operator` registra e altera `regra` e `decisao`, efetiva e rejeita proposta delas, e revoga regra e decisão; `admin` faz tudo isso e também registra, altera e revoga `limite`. Escopo de clientes (ADR 0044) vale para todos.
4. Limite vale para o cliente inteiro e por plataforma (`escopo` = `cliente` ou `plataforma:<chave>`). Por conta fica fora da v1.
5. Só BRL na v1; moeda é enum fechado de um valor.
6. Filial não herda regra da rede.

### 6. Modelo de dados (migração 0141)
- `core.limit_definitions (key, version)` PK composta: chave estável, nome, descrição, categoria, medida, unidade (`brl_centavos`, `razao`, `percentual`), período (`mes`, `dia`, `total`), sentido (`teto`, `piso`), faixa mínima e máxima (texto decimal), escopos aceitos, essencial, ativo. Global da plataforma; `organization_id` nulo e já previsto. Papel do app só `SELECT`. `organization_id` não tem FK para `core.organizations` de propósito: um `TRUNCATE ... core.organizations CASCADE` (testes, restauração) levaria o catálogo global e a carga inicial. Enquanto não existe catálogo por agência, um gatilho `BEFORE INSERT` recusa organização inexistente, e a decisão só usa definição global ou da própria organização; a FK com `ON DELETE CASCADE` entra junto com a fase do catálogo por agência.
- `core.client_decisions`: id, organização, cliente, número sequencial por cliente (sem buraco, trava por cliente), categoria, natureza, origem, força, chave, escopo, título, contexto (por quê), texto, valor (jsonb validado por gatilho contra a definição), vigência início e fim, status, `supersedes_id`, `decided_by` (usuário), `on_behalf_of`, `evidence` (link ou texto curto), `without_advertiser_confirmation`, `via_link_id`, `agent_id`, `agent_run_id`, `agent_set_hash`, `idempotency_key`, `definition_key`/`definition_version`, `review_flag` (`revisar_e_converter_em_limite`), `redacted_at`, `created_at`.
- `core.client_decision_events`: só acréscimo; tipos `proposta`, `efetivada`, `rejeitada`, `superada`, `revogada`, `redigida`; quem, quando, motivo, `request_id`.
- RLS ligada e forçada nas duas tabelas (molde 0060): `app.organization_id` e `app.client_ids`. `GRANT` só `SELECT` e `INSERT`; gatilhos negam `UPDATE` e `DELETE` no conteúdo; o `status` muda só por gatilho disparado pelo evento (`core.decisao_apos_evento`, mesmo padrão de `core.contexto_apos_mudanca`).
- `ON DELETE CASCADE` a partir de `core.clients`: o expurgo leva tudo.
- Idempotência: índice único `(client_id, agent_id, idempotency_key)` onde a chave existe.
- Teto do agente atômico: o gatilho de inserção conta as decisões de origem `agente` do cliente (na mesma execução e nas últimas 24 h) sob a mesma `pg_advisory_xact_lock(hashtext('orla:decisoes'), hashtext(client_id))` que numera, e recusa acima do teto (SQLSTATE `ORT01` por execução, `ORT02` por dia; o serviço devolve 429). Padrão 50 e 200; o serviço repassa os seus valores por `set_config` local (`orla.teto_agente_por_execucao`, `orla.teto_agente_por_dia`), que só reduzem o padrão.
- `via_link_id` tem FK composta `(via_link_id, organization_id, client_id)` para `core.client_context_links` (UNIQUE `client_context_links_id_inquilino` criado nesta migração). Definição de limite usada por uma decisão tem `organization_id` nulo ou igual ao da decisão.
- `core.regras_migracao_contexto (client_id, field_key, decision_id, migrated_at)`: livro imutável da migração das seções J e K, com RLS forçada; o app só lê e só o worker insere (o grant de `INSERT` fica no papel do app, que o worker herda sem grant próprio, como manda o ADR 0043; a única política de `INSERT` é do papel do worker, então o app é barrado pela RLS); ninguém edita nem apaga; cascata do cliente.
- `via_link_id` fica `ON DELETE NO ACTION`: apagar um link referenciado por decisão é recusado. Hoje nenhum código apaga link (só a cascata do cliente, que leva as decisões junto); `SET NULL (via_link_id)` geraria um `UPDATE` em `core.client_decisions` que a imutabilidade nega. **Limitação para a Fase 7:** antes de permitir apagar link, decidir entre exceção estreita na imutabilidade (como o `SET NULL` de `decided_by`) ou nunca apagar link referenciado (só revogar).
- Funções `SECURITY DEFINER` desta entrega estão na allowlist do ADR 0045 apenas se o app as executa (nenhuma é exigida: redação é só do worker).

### 7. LGPD: imutável não é intocável
Não apagar colide com expurgo e com dado pessoal digitado por engano. O caminho é `core.redigir_decisao(p_decisao, p_motivo)`: `SECURITY DEFINER`, `GRANT EXECUTE` só a `orla_worker`, troca título, contexto, texto, evidência e "em nome de" (`on_behalf_of`) por `[redigido]`, troca também o motivo livre dos eventos da decisão (revogação, rejeição, efetivação) por `[redigido]`, mantém a linha, o valor e o motivo do próprio evento `redigida`, e grava esse evento. A redação percorre a **cadeia de supersessão nos dois sentidos** (antecessoras e sucessoras ligadas por `supersedes_id`, mesma natureza, chave e escopo, que costumam copiar título e texto) e redige todas, com um evento `redigida` por decisão afetada. A exceção à imutabilidade dos eventos é estreita: só a coluna `reason`, só para `[redigido]`, só dentro de `redigir_decisao` (marca local à transação que o app não alcança: não tem `UPDATE` e o gatilho recusa o papel dele). A tela e o Brain exibem `[redigido]` como texto comum. O expurgo do cliente apaga tudo por cascata. Não existe edição para o app.

**O que a função não alcança (roteiro manual, em `docs/lgpd/retencao.md`):** (1) a linha de origem das decisões migradas em `core.client_context_entries` e suas revisões em `core.client_context_revisions` (os campos que saíram do catálogo não aparecem na tela, então a limpeza é por operação manual do operador da plataforma); (2) as versões antigas do Brain publicadas no bucket (`regras.md`, `decisoes.jsonl`): o Brain é republicado sem o texto na próxima publicação, e as gerações anteriores expiram pelo ciclo de vida do bucket em 90 dias ou são apagadas à mão antes disso.

### 8. Avaliação em código
`avaliarAcao` (função pura, em `src/modules/clients/domain/regras/`) decide: recebe definições, conjunto vigente e ação proposta; compara pela medida, sentido e período da definição; devolve `permitida`, `bloqueada` (com a decisão que bloqueia) ou `sem_regra`. Sem `if` por chave. Texto de regra é dado, nunca instrução: limite duro se impõe em código.

### 8.1 Falha fechada
Limite vigente cuja definição (chave, versão) não está no conjunto passado a `avaliarAcao` bloqueia (`motivo: definicao_ausente`), nunca é ignorado.

### 9. Precedência sobre as seções J e K
Inventário do catálogo (`catalogo.ts`):

| Campo | Seção | Destino |
| -- | -- | -- |
| `orcamento_mensal_total` | J | **sai**: vira limite `investimento.teto_mensal` (valor tipado, conversão automática) |
| `regras_regulatorias` | K | **sai**: regra, categoria `segmento` |
| `o_que_nao_pode_ser_dito` | K | **sai**: regra, categoria `etica_marca` |
| `quem_aprova` | K | **sai**: regra, categoria `governanca` |
| `prazo_de_aprovacao` | K | **sai**: regra, categoria `governanca` |
| demais campos de J e K | J, K | **ficam** (descritivos: objetivos, metas, divisão do orçamento, datas-chave, recursos internos, mídia, notas) |

`VERSAO_DO_CATALOGO` sobe para 2. As linhas antigas de `client_context_entries` ficam como histórico, sem leitura pela tela nem pelo Brain. Texto livre com número não vira limite: entra como `regra` com `review_flag`, e a tela mostra a fila "revisar e converter em limite". As linhas migradas nascem com origem `agencia` e `decided_by` = `updated_by` original (o cliente só propõe, §5.2); quando a fonte era o cliente, contexto e evidência registram "informado pelo cliente". Linha sem autor é ignorada e listada (`ignorada_sem_autor`), nunca vira vigente sem pessoa. A idempotência do script não depende de texto que a redação troca: ele pula o campo se há linha em `core.regras_migracao_contexto` ou qualquer decisão do cliente na mesma chave (qualquer status, inclusive redigida), então reexecutar depois de redigir ou revogar nunca recria o texto. A completude essencial do Contexto deixa de cobrar os campos que saíram; Regras cobra teto de investimento (`investimento.teto_mensal`) e CAC máximo (`eficiencia.cac_maximo`) como lacuna, lidos da coluna `essencial` das definições.

### 10. Brain e agentes
- Provedor `regras` na fase primária, tipos `limite`, `regra`, `decisao`. URN: `limite:{chave}:{escopo}`, `regra:{chave}` (vigentes), `decisao:{numero}`. A entrada carrega força, origem, vigência, número, ponteiro de histórico e é marcada como **conteúdo não confiável**. Exportação `regras.md` (vigentes) e `decisoes.jsonl` (uma linha por decisão).
- Leitura: `GET /api/v0/brain/clientes/[clienteId]/regras` (ETag, limites de leitura, `hashDoConjunto`). Título, contexto e texto passam pelo mesmo `textoSeguro` do Brain; a evidência não vai ao agente nem ao Brain (`regras.md` e `decisoes.jsonl` não a exportam). Escrita: `POST /api/v0/regras/clientes/[clienteId]/decisoes` (`workerRoute`), origem `agente` fixada no servidor, chave de idempotência obrigatória, teto por execução e por cliente por dia.
- **Contrato HTTP.** Ambas as rotas exigem `Authorization: Bearer <TRIA_WORKER_TOKEN>` (401 sem ele) e repassam `x-request-id`. Leitura: 200 com `ETag` (derivado de `hashDoConjunto` e das definições de limite referenciadas) e 304 com `If-None-Match`; o corpo traz `hashDoConjunto`, `conteudoNaoConfiavel: true`, `vigentes`, `conflitos` e `definicoesDeLimite`, e cada decisão repete `conteudoNaoConfiavel: true`. Escrita: corpo estrito com `agenteId`, `execucaoId` e `idempotencyKey` obrigatórios; a chave de idempotência vai no corpo, não em cabeçalho, porque o `workerRoute` só entrega o corpo ao handler. `origem`, `status` e qualquer campo fora do contrato dão 422. Resposta 201 na criação e 200 com `repetida: true` na repetição. O cliente vem da URL e é resolvido para a organização no servidor; cliente inexistente ou malformado dá 404 idêntico. Falhas: validação 422, permissão 403, conflito 409, teto por execução ou por dia 429 (sem `Retry-After`: o teto não se libera por espera curta).
- **Identidade do agente.** O app não tem identidade de agente. A porta é autenticada pelo segredo do worker (`callerFingerprint`); o corpo declara `agenteId` e `execucaoId` (strings curtas validadas). São autodeclaração de um chamador já autenticado: servem a rastreio e idempotência, não são prova independente. A autoridade vem da origem fixada no servidor e da recusa de efetivar limite ou regra, não do id.

### 11. Papéis e auditoria
Autorização é conferida no serviço (papel, recorte, origem), não só na tela. Auditoria com `x-request-id` (ADR 0049): `client.rule.registered`, `superseded`, `revoked`, `proposal_accepted`, `proposal_rejected`; falha de auditoria não derruba o fluxo; log nunca leva o conteúdo da regra. A redação não tem caminho no app (é SQL do worker, `core.redigir_decisao`): é auditada pelo evento `redigida` no próprio banco (quem, quando, motivo, `request_id`), um por decisão afetada, e não emite `client.rule.redacted`.

## Fora desta entrega
Herança rede e filial, modelos por segmento, notificação por e-mail ou WhatsApp, cópia no BigQuery, anexo próprio de evidência, edição do cadastro do cliente (ADR 0050) e a Fase 7 (link público do cliente).

## Consequências
- Mudar regra ou limite é sempre registrar nova decisão, com autor, caminho e motivo.
- Tipo de limite novo é um `INSERT` em `core.limit_definitions` (operador da plataforma ou migração).
- A migração dos dados de J e K é script com `--help`, alvo impresso e ensaio (ADR 0028); em produção só com autorização nomeada (ADR 0046).
- Risco residual: valor de texto livre depende de revisão humana para virar limite.
