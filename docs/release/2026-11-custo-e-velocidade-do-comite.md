# Release: custo e velocidade do Comitê do Strategy Plan (24K-136)

Segue `2026-11-comites-cultura-e-producao.md`. A main está em `fd63108` (merge da `dev` em `ee2416a`), sem diferença de conteúdo para a `dev` antes do PR #220, com migrações até a 0154. Este roteiro cobre o que os PRs #220 e seguinte acrescentam (ADR 0076).

## O que entra

- **Cache do fornecedor nos membros do Comitê:** instrução de sistema comum, parte da persona depois dos dados e pacote com começo comum a todos os membros.
- **Agendamento do Comitê:** 3 comitês em andamento e até 6 chamadas simultâneas (3 depois de falha da etapa), com parada pela duração observada.
- **Medição:** campo `uso` nas linhas `strategy.run.step`.
- **Cache do fornecedor nas mesas, na redação e no Production Director:** as duas rodadas da mesa, os três grupos de pacote completo da redação e do ajuste, e as campanhas do plano de produção (ADR 0076 §5).
- **Migração 0155:** coluna `cached_input_tokens` em `core.ai_usage` (aditiva, padrão 0, com `UPDATE` só dessa coluna para o papel do app).

## O que não muda

Sem migração destrutiva, sem mudança em `infra/terraform`, sem DDL no BigQuery, sem fluxo n8n novo, sem segredo e sem variável de ambiente. `db/corte-gate.txt` não muda. Nenhum comitê, membro, mesa, modelo, raciocínio ou teto de saída muda.

## Antes de mergear (agente)

1. `qualidade` e `integracao` verdes no head do PR `dev` -> `main`.
2. A única migração pendente é a 0155, aditiva. O deploy a aplica antes de subir a imagem nova.
3. Snapshot `READY` do disco de dados com menos de 24 h e VM `RUNNING` (pre-flight, ADR 0034).
4. **Execuções em andamento:** não precisam ser canceladas. A deliberação gravada tem o mesmo esquema e a retomada só chama o que falta; membros já gravados não são refeitos. Redação parada no meio recomeça o grupo que faltava com a instrução nova.

## Depois do deploy

1. **Smoke:** o `deploy.yml` passou e `/api/health` responde 200.
2. **Migração:** `core.ai_usage` tem a coluna `cached_input_tokens` e a primeira chamada de IA depois do deploy conclui a reserva (linha com `result` diferente de `reservada`).
3. **Primeiro plano real:** na linha `strategy.run.step` da etapa `comite`, conferir `uso.tokensDeEntradaEmCache` maior que zero a partir da segunda chamada de membro e quantos passos a etapa levou. Zero em cache com pacote grande indica que o fornecedor não acertou o prefixo: registrar o fornecedor e o modelo. O mesmo vale para a etapa `redigir` a partir do segundo grupo.
4. **Limite de taxa:** se a etapa `comite` for adiada com `ia_falha` logo no primeiro passo, a repetição já roda com 3 chamadas simultâneas. Repetindo, baixar `PARALELISMO_DO_COMITE` por PR.

## Reversão

Voltar a imagem anterior. A coluna `cached_input_tokens` fica no banco: a imagem anterior não a escreve e ela vale 0. Não há dado em formato novo; execução parada no meio do Comitê retoma na imagem anterior.

## Não verificado antes deste release

- Acerto de cache e ganho em reais com fornecedor real (sem chave no ambiente de desenvolvimento).
- Qualidade dos pareceres, das mesas e da redação com a nova ordem dos dados, em plano real.
- Limite de taxa do fornecedor com 6 chamadas simultâneas.
