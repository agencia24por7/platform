# Release: comitês com mesas, sinais de cultura no Brain, Production Director e Memória do plano (24K-134)

Segue `2026-11-estrategia-planos-e-ambiente.md` e seus adendos. A main está em `2b63740`, com migrações até a 0151. Este roteiro cobre só o que a `dev` acrescenta no PR #210. A ordem das camadas de infra dos roteiros anteriores não muda.

## O que entra

- **Comitês (ADR 0072):** 17 comitês com 35 membros e duas mesas por comitê. Cada comitê tem modelo e liga/desliga na Config da IA, e o juiz recebe os pontos por cota.
- **Sinais de cultura no Brain (ADR 0075):** provedor `culture`, bloco "Sinais de cultura" no Contexto e `POST /api/v0/brain/clientes/{clienteId}/sinais` (token do worker).
- **Memória do plano (ADR 0073):** bloco na página do plano e download em Markdown.
- **Production Director (ADR 0074):** subpágina de produção do plano, rota de worker `/api/v0/strategy/producao/avancar` e fluxo n8n `ORLA · strategy · avançar planos de produção`.

## Migrações

`0152_brain_sinais_de_cultura`, `0153_strategy_comites_deliberacao` e `0154_strategy_plano_de_producao`. As três são aditivas e nenhuma está no portão do corte.

- Criam tabelas novas com RLS e FORCE: `core.client_culture_signals`, `core.strategy_plan_deliberations`, `core.strategy_committee_settings` e a tabela do plano de produção.
- Recriam funções e gatilhos com `CREATE OR REPLACE`; `core.redigir_plano` passa a redigir também a deliberação e a produção.
- Não há `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` nem `DELETE`. `db/corte-gate.txt` não muda e o deploy automático não é bloqueado.

## O que não muda

Sem mudança em `infra/terraform` e sem DDL no BigQuery. Sem segredo novo e sem variável de ambiente obrigatória. As rotas de worker usam o mesmo token das outras.

## Antes de mergear (agente)

1. `qualidade` e `integracao` verdes no head do PR `dev` -> `main`.
2. `migrar.sh` em modo `listar` mostra só 0152, 0153 e 0154 pendentes, nenhuma do corte.
3. Snapshot `READY` do disco de dados com menos de 24 h e VM `RUNNING`. O pre-flight confere isso antes de qualquer migração (ADR 0034).
4. **Execuções em andamento:** listar as execuções da Estratégia não finalizadas. Uma execução que já passou do Comitê aceitaria o parecer antigo da persona como parecer do comitê inteiro (ADR 0072). Se houver alguma, cancelar pela tela e pedir de novo depois do deploy.

## Depois do deploy

1. **Smoke:** o `deploy.yml` passou. Conferir também:
   - `/api/health` responde 200;
   - as três migrações estão no livro-razão (`public.schema_migrations`);
   - a Config da IA mostra a seção "Comitês do planejador", com `risco_legal` travado ligado.
2. **Fluxo n8n, só agora:**
   - rodar `npm run n8n:sincronizar -- --criar --aplicar` duas vezes, pelo túnel (ADR 0009);
   - confirmar que o fluxo novo ganhou a tag `platform` e a credencial "ORLA · worker token";
   - ativar `ORLA · strategy · avançar planos de produção`.
3. **Custo:** com os 17 comitês ligados, cada rodada do Comitê faz 69 chamadas. O teto padrão de 200 chamadas por dia comporta cerca de 2 planos. Antes de pedir plano, decidir na Config da IA quais comitês ficam ligados ou subir o teto.
4. **Cliente de teste:**
   - cadastrar um sinal de cultura no Contexto e conferir que ele aparece no Brain como `culture_*`;
   - pedir um plano e conferir que a execução termina `concluida` ou falha com `motivo` em `strategy.run.step`;
   - abrir a Memória do plano e baixar o Markdown;
   - com o plano `vigente`, gerar o plano de produção na subpágina.

## Reversão

- **Imagem:** as migrações são aditivas, então a imagem anterior roda no esquema novo e ignora as tabelas novas. Voltar a imagem não desfaz as migrações; desfazê-las exige restaurar o backup do pre-flight (decisão humana, ADR 0034 §6).
- **Parar só os comitês novos:** desligá-los na Config da IA.
- **Parar o Production Director:** desativar o fluxo n8n dele.
- **Execuções da imagem anterior:** com a imagem anterior, uma execução criada depois do deploy e parada no meio do Comitê não retoma a deliberação. Cancelar e pedir de novo.

## Não verificado antes deste release

- Qualidade do plano com 17 comitês e modelo real.
- Custo real em tokens por plano, medido só com a IA falsa.
- Acessibilidade das telas novas por axe, porque o repositório não tem harness.
- Coletor n8n de sinais de cultura: a rota existe, mas nenhum fluxo de coleta foi criado. As fontes e as credenciais ainda não estão definidas.
