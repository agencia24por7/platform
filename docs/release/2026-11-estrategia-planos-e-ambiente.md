# Release: Estratégia com planos independentes, destino e Google Ads; ambiente de agentes (ADR 0069)

Segue o release `2026-11-ia-e-estrategia.md` (main em `e7c5a9a`, migrações até a 0147). Este roteiro cobre só o que a `dev` acrescenta. A ordem das camadas de infra dos roteiros anteriores não muda.

## O que entra

- Estratégia (24K-132, ADR 0069 da Estratégia): página única de planos, vários planos do mesmo tipo, plano em dois blocos (resumo executivo e plano de mídia por plataforma, sem criativos), judge do Comitê, correção do Gate com IA, lacunas com sugestão que o owner ou admin aprova em Regras. Cadastro de landing pages e do WhatsApp do cliente em Contexto > Destino. UTM único por código. Catálogos de campos comprovados pela API: Meta (v27.0) e Google Ads Search (v26).
- Limite do motivo da resposta ao Comitê em 160 caracteres (24K-116, PR 187).
- Ambiente de agentes (24K-129, ADR 0069 do acesso amplo): hooks, regras e CI da integração em fatias. Não muda o app em produção.

## Migrações (todas aditivas, nenhuma no portão do corte)

`0148_strategy_plano_destino_e_landing_pages`, `0149_strategy_plan_juiz_e_correcao_do_gate`, `0150_strategy_plano_idempotencia_redacao_e_whatsapp`.

- Só recriam restrições, políticas e gatilhos (`DROP ... IF EXISTS` seguido de criação) e acrescentam colunas nulas e a tabela `core.client_landing_pages` (RLS e FORCE). Nenhum `DROP TABLE` nem `DROP COLUMN`; `db/corte-gate.txt` não muda e o deploy automático não é bloqueado pelo portão.
- A 0148 remove a unicidade de plano por tipo (`strategy_plans_tipo_unico`) de propósito: planos passam a ser independentes. Plano anterior fica só para leitura e recusa mudança com `plano_sem_destino`.
- Banco novo ou existente: `migrar.sh` aplica na transação com a linha do livro-razão; o pre-flight lista as pendentes e tira o `pg_dumpall` antes (ADR 0034).

## O que não muda

- Sem mudança em `infra/terraform`, sem DDL novo no BigQuery (`infra/compose/preflight-bq.txt` e `db/corte-gate.txt` iguais), sem segredo novo e sem variável de ambiente obrigatória.
- Os catálogos são código versionado: nenhuma chamada nova à API da Meta ou do Google acontece em produção.

## Antes de mergear (agente)

1. `qualidade` e `integracao` verdes no head do PR `dev` -> `main`.
2. Snapshot `READY` do disco de dados com menos de 24 h e VM `RUNNING`: o pre-flight confere antes de qualquer migração e, se falhar, sai antes de tocar no Postgres (ADR 0034).
3. A aprovação do ambiente `producao` vale para dois jobs (apply do Terraform e publicar); o Terraform não muda neste release.

## Depois do deploy

1. Smoke do `deploy.yml` verde. Conferir à mão: `/api/health` 200; a página de um cliente mostra a Estratégia para owner, admin e operator e não a mostra para o leitor.
2. Cliente de teste: cadastrar WhatsApp e uma landing page em Contexto > Destino; criar dois planos do mesmo tipo com plataformas Meta e Google; conferir que o plano de mídia traz justificativa em cada campo e que a execução termina `concluida` ou falha com `motivo` na auditoria (`strategy.run.step`).
3. O botão "Corrigir falha do Gate com IA" reconvoca o Comitê (custo no ADR, teto de 2 por raiz). Só tem efeito com modelo escolhido em `/config/ia`.

## Reversão

Migrações aditivas: a imagem anterior roda no esquema novo, ignorando as tabelas e colunas novas, mas a unicidade por tipo removida não volta sozinha. Voltar a imagem não desfaz as migrações; desfazê-las exige restaurar o backup do pre-flight (decisão humana, ADR 0034 §6). Para parar só a Estratégia nova: remover o modelo de `strategy_plan` em `/config/ia`.

## Não verificado antes deste release

- Qualidade do plano com modelo real, para Meta e Google, em cliente real.
- Google Ads: só Search; Display, Performance Max, Demand Gen, Shopping e app seguem fora até haver anúncio e asset comprovados.
- Meta: anúncio exige mídia (imagem ou vídeo), que o plano não produz; a mídia entra na execução da campanha.
- Rotação do token e do app secret da Meta, que apareceram numa transcrição de sessão.

## Adendo: canais do Google Ads (PR 194)

Release seguinte, só de código de domínio: Display, Performance Max, Demand Gen e app entram no catálogo do Google Ads (131 campos, API v26, levantados com `validate_only`). Sem migração, sem mudança de infra, de BigQuery, de segredo ou de variável de ambiente; o deploy não tem migração pendente a aplicar.

- Depois do deploy: smoke verde e, num cliente de teste, o Google aparece com os canais novos no plano de mídia.
- Reversão: voltar a imagem basta; não há esquema novo.
- Fora: Shopping (sem Merchant Center vinculado), carousel e product ad do Demand Gen, audiência e listing group do Performance Max, app da Apple.

## Adendo: correção da instrução do plano (PR 197)

Em produção, a redação falhou com `ia_saida_invalida` (canal com plataforma `whatsapp` e campos repetidos no plano de mídia). O release leva só a instrução do agente de plano: sem migração e sem mudança de infra. Depois do deploy, gerar um plano no cliente de teste e conferir o `motivo` em `strategy.run.step`. Reversão: voltar a imagem.

## Adendo: tentar de novo, tentativas por etapa e loading do plano (PR da UI)

Depois do teste em produção: botão "Tentar de novo" na execução que falhou, até 2 repetições por etapa (teto de 6 por execução), motivo da falha sem corte e com o caminho do erro de formato, instrução do Google com os valores padrão, seletores do formulário que mantêm o valor e til animado no plano em andamento. Sem migração e sem mudança de infra. Depois do deploy: num plano que falhou, usar "Tentar de novo" e conferir `strategy.run.step` e `strategy.run.retry` na auditoria. Reversão: voltar a imagem.

## Adendo: foco do plano, remoção de plano e edição por campos (24K-132, ADR 0070)

Migração nova, a 0151, aditiva e fora do `db/corte-gate.txt`: colunas `foco`, `removido_em` e `removido_por` em `core.strategy_plans`, função de formato do foco, policy e grant de UPDATE só das duas colunas de remoção, gatilho de imutabilidade que passa a aceitar apenas a remoção por owner ou admin, `core.strategy_runs_pendentes` sem plano removido e limite do `pedido` das execuções em 16 KB. Sem mudança de infra, de BigQuery, de segredo ou de variável.

- Antes de mergear: `migrar.sh` em modo `listar` mostra só a 0151 pendente e nenhuma do corte.
- Depois do deploy, conferir: a 0151 no livro-razão (`public.schema_migrations`); `SELECT count(*) FROM core.strategy_plans WHERE foco IS NULL` igual ao número de planos antigos; o formulário de novo plano com os produtos do Contexto e a campanha de marca; criar um plano de teste, apagá-lo como owner ou admin e conferir que `removido_em` ficou preenchido, que versões e execuções continuam na tabela e que `strategy.plan.removed` entrou na auditoria; "Editar seção" sem caixa de JSON.
- Plano antigo continua legível, sem foco e sem gate novo. Mudança em produto depois da criação do plano não o marca como desatualizado.
- Reversão: voltar a imagem basta para o código; as colunas ficam ignoradas. A imagem anterior não tem o gatilho novo, então ela volta a negar a remoção, e os planos já removidos continuam removidos (nenhum caminho antigo os esconde: voltar a imagem os mostraria de novo, pois o filtro é do repositório novo). Desfazer a migração exige o backup do pre-flight (ADR 0034 §6).

