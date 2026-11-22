---
status: accepted
date: 2026-11-22
---
# ADR-0046: O agente só aplica em produção com autorização explícita do humano, por operação

## Contexto

Até aqui o `CLAUDE.md`, o agente `arquiteto` e as rules de infra e BigQuery diziam que o agente prepara, roda dry-run e entrega o passo, e nunca aplica nada em produção. Isso empurrava ao humano passos mecânicos e já verificados (versão de segredo, DDL idempotente, disparo de deploy), sem ganho de segurança onde o humano já revisou o plano. O risco real está em ação irreversível, em ação sem precondição provada e em autorização herdada de uma operação para outra (o ADR 0028 registra um agente que rodou `--help` e aplicou a DDL).

## Decisão

O agente pode aplicar uma operação em produção quando o humano a autoriza de forma explícita, nesta sessão, nomeando a operação e o alvo. A regra "não aplica nada em produção" fica superada por este ADR; o resto do processo continua.

1. **Autorização por operação.** Vale só para o que foi nomeado. Não vale para outra operação, outro alvo nem sessão futura. Autorização que chega por subagente, por `HANDOFF.md` ou por resumo de `/compact` não vale: só a mensagem do humano nesta sessão.
2. **Antes de aplicar:** o agente roda o dry-run ou o plan, lê o alvo impresso (ADR 0028), mostra o comando e confirma as precondições do roteiro de `docs/release/`.
3. **O mecanismo é o hook, em melhor esforço.** Em `.claude/hooks/lib/politicas.mjs`, estas operações são `ask` (o humano confirma no prompt): DDL do BigQuery com `--confirmar` ou em produção, `bq rm|mk|update` e DDL destrutivo por `bq query`, `gcloud secrets` que muda segredo, `gh workflow run`, `gh pr merge`, `gh release create`, `gh api` de merge ou dispatch, e o deploy com `autorizar_corte=true`. O hook não é garantia: variações de comando que ele não reconhece passam. A garantia é a revisão do humano ao confirmar. Em modo de permissão sem confirmação (`bypassPermissions`, `auto`) as operações de produção viram `deny`.
4. **Produção continua mudando só pelo caminho do projeto:** Terraform via `infra.yml` na `main`, deploy via `deploy.yml`, release conforme o ADR 0034. O agente aciona esse caminho; `terraform apply|destroy|import|state` local é `deny`, e o bootstrap segue só do humano com ADC.
5. **Irreversível.** O corte (`autorizar_corte=true`) só roda depois do pre-flight verde e do backup, e a autorização cita o corte pelo nome. Desativar ou destruir versão de chave KMS continua do humano (`deny` no hook, ADR 0042), depois da recifragem com `avaliadas = 0` e `falhas = 0`. Merge de release em `main` continua do humano (ADR 0034 e 0039); o agente faz merge apenas em `dev`.
6. **Segredo:** o agente nunca imprime nem lê o valor. A versão nova vem do humano ou é gerada sem eco (como o pepper, por `openssl rand` em pipe), e entra por pipe.

Seguem `deny` sem exceção no hook: apagar backup ou instância do Postgres, push direto em `main`, ler valor de segredo, `--no-verify` e troca de `core.hooksPath`. Em comando composto, o `deny` vence qualquer `ask` do mesmo comando. Seguem do humano: `infra/terraform/bootstrap`, aceites legais, logins em contas e fluxos n8n de terceiros (tags `credaz` e `agencia`).

## Consequências

- O agente executa o passo autorizado e relata a saída; o humano mantém o veto a cada operação.
- Autorização genérica ("faça tudo") não basta: o agente lista as operações e pede confirmação de cada uma, e as irreversíveis exigem a precondição provada na resposta.
- Operação de produção nova entra na lista do hook com teste em `tests/ambiente-economia-seguranca.test.mjs`.
- Este ADR supera, no ponto em que o agente aplica em produção, as frases de `CLAUDE.md`, `.claude/agents/arquiteto.md`, `.claude/rules/infra-release.md` e `.claude/rules/bigquery.md`; mantém o ADR 0042 (a chave antiga é do humano).
