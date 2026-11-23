---
status: accepted
date: 2026-11-22
---
# ADR-0047: O agente executa os passos antes reservados ao humano, com autorização nomeada

## Contexto

O ADR 0046 deixou ao humano o merge em `main`, a desativação de versão de chave KMS e outros passos mecânicos. O dono do projeto decidiu que essa fronteira só atrasa: o agente deve executar esses passos, e o humano mantém o veto pela confirmação de cada operação.

## Decisão

1. Merge de release em `main` (por `gh pr merge`, nunca push direto) e desativação de versão de chave KMS passam de `deny` a `ask` no hook. Exigem autorização nesta sessão nomeando o PR ou a chave, e a precondição provada na resposta: roteiro de `docs/release/` cumprido, ou recifragem com `avaliadas = 0` e `falhas = 0` (ADR 0042).
2. Uma única mensagem do humano pode autorizar várias operações se nomear cada uma. "Faça tudo" sem lista continua insuficiente; o agente então lista as operações e segue após a confirmação.
3. Seguem `deny`: apagar backup ou instância do Postgres, push direto em `main`, ler valor de segredo, `--no-verify`, trocar `core.hooksPath` e o Terraform aplicado localmente (produção só pelo `infra.yml`).
4. Seguem fora do alcance técnico do agente: `infra/terraform/bootstrap` (exige ADC do humano), aceites legais, logins em contas, billing do GitHub e fluxos n8n de terceiros (`credaz`, `agencia`).

## Consequências

- Supera o item 5 e a frase "continua do humano" do ADR 0046 para merge em `main` e KMS; mantém o ADR 0042 nas precondições.
- O hook segue em melhor esforço; a garantia é a confirmação do humano no prompt.
