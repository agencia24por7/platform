# Release: camada de IA, MCP, Strategy Plan e Brain de conhecimento (ADR 0063 a 0069)

Acompanha, no mesmo merge `dev` → `main`, os roteiros `2026-11-identidades-e-metadados.md` (infra: environment `plano`, bootstrap, Terraform, segredo de borda, metadados da VM) e `2026-11-release-cofre-e-contexto.md`. Este roteiro cobre só o que a camada de IA e a Estratégia acrescentam. A ordem das camadas de infra desses roteiros não muda.

## O que entra

- Camada de IA (ADR 0063, 0064, 0066): chave de fornecedor cifrada pela cifra do cofre, modelo por tarefa, teto diário, servidor MCP, credenciais de agente. Telas `/config/ia` e `/config/agentes`.
- Strategy Plan fase 1 (ADR 0056, 0065, 0067, 0068, 0069): página única de planos na página do cliente (o 0069 substitui as abas do 0065), motor por grupos, Comitê, Gates, ferramentas `brain_consultar_catalogo` e `brain_consultar_item`.
- Brain: provedores `conhecimento` e `desempenho` (consultas BigQuery só de leitura).
- Fluxo n8n `n8n/workflows/plataforma/strategy-avancar-execucoes.json`.

## Migrações (todas aditivas)

`0142_autoria_imutavel_do_item_de_contexto`, `0142_credenciais_de_agente`, `0143_ia_chaves_modelos_e_uso`, `0143_strategy_plan_nucleo`, `0144_ia_uso_concluido_nao_muda`, `0145_strategy_plan_fase_1`, `0146_brain_conhecimento_e_desempenho`, `0147_strategy_plan_execucoes`.

- Nenhuma entra em `db/corte-gate.txt`: não há DROP de tabela ou coluna, e o portão do corte não se aplica a elas.
- Há dois arquivos com o prefixo 0142 e dois com 0143; o livro-razão usa o nome do arquivo inteiro, e a ordem entre eles é a alfabética.
- A 0146 carrega 30 entradas de conhecimento, entre elas regras legais marcadas como não verificadas (sem revisão jurídica).
- Banco novo ou existente: `migrar.sh` aplica na transação com a linha do livro-razão; o pre-flight lista as pendentes e tira o `pg_dumpall` antes (ADR 0034).

## O que não muda

- Sem DDL novo no BigQuery: `infra/compose/preflight-bq.txt` não mudou. As consultas de desempenho leem `tria_dw` existente.
- Sem segredo novo e sem variável de ambiente obrigatória. `IA_MCP_HABILITADO` tem padrão `false` e o compose de produção não a repassa: o endpoint `/api/mcp` fica desligado até alguém ligá-lo por PR de infra.
- Nenhum plano é gerado em produção até um admin cadastrar uma chave de fornecedor e escolher o modelo em `/config/ia`.

## Depois do deploy (humano)

1. Smoke do `deploy.yml` verde. Conferir à mão: `/api/health` 200; a página de um cliente mostra a aba Estratégia para owner, admin e operator e não a mostra para o leitor; `/config/ia` abre só para quem responde pela organização.
2. Fluxo n8n, só agora (antes disso ele chamaria uma rota inexistente a cada minuto): `npm run n8n:sincronizar -- --criar --aplicar`, duas vezes (ADR 0009); confirmar a credencial "ORLA · worker token"; ativar `ORLA · strategy · avançar execuções`.
3. Escolher o modelo em `/config/ia` para `strategy_plan`, `comite` e `gate` só depois de a qualidade do plano ser aceita na prova com modelo real. A visão enviada ao fornecedor é a da equipe (ADR 0067): quem cadastra a chave está aceitando esse envio.
4. Primeiro plano: pedir em um cliente de teste e conferir que a execução termina `concluida` ou falha com `motivo` na auditoria (`strategy.run.step`).

## Reversão

Migrações aditivas: a imagem anterior roda no esquema novo, sem usar as tabelas novas. Voltar a imagem não desfaz as migrações; desfazê-las exige restaurar o backup do pre-flight (decisão humana, ADR 0034 §6). Para parar só a Estratégia: desativar o fluxo n8n e remover o modelo de `strategy_plan` em `/config/ia`.

## Não verificado antes deste release

- Qualidade do plano com modelo real: nenhuma rodada da prova com o Gemini terminou com plano aprovado.
- Integração em CI de parte dos PRs mergeados em sequência (o CI de `dev` é cancelado a cada merge).
- Valores reais do BigQuery para o desempenho e a unidade de `investimento` do Meta.
- Revisão jurídica das regras legais da carga de conhecimento.
