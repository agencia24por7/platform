---
status: accepted
date: 2026-11-22
issue: 24K-112
---
# ADR-0048: Merge em `dev` autorizado pelo humano passa pelo hook, em escopo estreito e verificável

## Contexto

O ADR 0046 deixou `gh pr merge` como `ask` e, em modo de permissão sem confirmação (`auto`, `bypassPermissions`), como `deny`. Quando o dono pede explicitamente o merge de um PR em `dev`, essa trava de modo impedia a operação autorizada: não havia prompt para confirmar e o hook negava.

O hook não consegue provar uma autorização dada na conversa. Afrouxar `gh pr merge` em geral abriria merge em `main`, `--admin` e merge com CI vermelho. A saída é uma exceção que o hook consiga verificar sozinho.

## Decisão

`politicas.mjs` ganha `avaliarMergeEmDev`, chamada no início de `avaliarComando`. Ela só atua quando o comando começa com `AUTORIZO_MERGE_EM_DEV=`; sem o marcador nada muda. O corpo do guarda mora em `.claude/hooks/lib/guarda.mjs` (`executarGuarda`); o CLI `guarda-pre-uso.mjs` é só a casca e não injeta nada, de modo que nenhuma variável de ambiente altera a política.

1. **Forma exata.** A única aceita é `AUTORIZO_MERGE_EM_DEV=<n> gh pr merge <n> --repo github.com/agencia24por7/platform --merge --match-head-commit <sha40>` (ou `--squash`, `--rebase`), nessa ordem, regex ancorada no início e no fim, uma linha, mesmo número nos dois lugares (1 a 7 dígitos, sem zero à esquerda) e sha de 40 hex minúsculos. O `--repo` fixa o repositório do merge real, que sem ele herdaria `GH_REPO`, `GH_HOST` e o diretório do shell. Qualquer outra coisa depois do marcador (`--admin`, `--auto`, `--delete-branch`, `--body`, outro repositório, encadeamento, substituição, redirecionamento, `\r`, quebra de linha, variável extra, outro comando) é `deny`, nunca `ask`.
2. **Verificação no GitHub.** O hook roda `gh pr view <n> --repo github.com/agencia24por7/platform --json baseRefName,state,isDraft,statusCheckRollup,headRefOid,url,isCrossRepository,reviewDecision,mergeable,files,changedFiles` sem shell, com `cwd` do projeto, `maxBuffer` de 1 MiB e timeout de 5 s (no máximo a metade do timeout do hook em `.claude/settings.json`, que o teste confere: hook morto por timeout deixaria o comando passar sem verificação). O `gh` é procurado por caminho absoluto (`/opt/homebrew/bin/gh`, `/usr/local/bin/gh`, `/usr/bin/gh`, nessa ordem); isso reduz a dependência do PATH do usuário, mas não a elimina (o diretório do Homebrew é gravável pelo usuário). O que fecha o resto é o `--repo` fixo e o ambiente mínimo: o processo do `gh` recebe só `HOME`, `PATH=/usr/bin:/bin`, `LANG` e `GH_TOKEN`/`GITHUB_TOKEN` se existirem (sem `GH_REPO`, `GH_HOST`, `GH_CONFIG_DIR`, `SSL_CERT_FILE`, proxies, `NODE_OPTIONS`). Só segue se: base `dev`; `OPEN`; não rascunho; `isCrossRepository` falso; `url` igual a `https://github.com/agencia24por7/platform/pull/<n>`; `headRefOid` igual ao sha do comando; `reviewDecision` diferente de `CHANGES_REQUESTED`; `mergeable` diferente de `CONFLICTING`; nenhum arquivo do PR sob `.github/` e lista de arquivos completa (`files.length === changedFiles`); e CI verde.
3. **CI verde** significa: os checks `qualidade` e `integracao` do workflow `ci` presentes, `SUCCESS` e da MESMA execução (id extraído de `detailsUrl`; `CHECKS_OBRIGATORIOS`; se renomeados o merge é negado e o motivo diz qual falta), mais todos os demais itens `SUCCESS`, `SKIPPED` ou `NEUTRAL`, e `StatusContext` com `state` `SUCCESS`. Conta só a execução mais recente de cada par (workflow, nome). Rollup vazio, pendente ou com falha nega. **O CI verde só vale se o PR não toca workflows:** em `pull_request` o GitHub roda o workflow do próprio PR, então um PR que altere `ci.yml` (ou crie outro workflow chamado `ci`) poderia produzir checks triviais verdes. Por isso PR que mexe em `.github/` é do humano.
4. **Janela de verificação.** O `--match-head-commit <sha>` faz o próprio `gh` recusar o merge se o HEAD mudou depois da consulta. Isso fecha só a troca do head: a troca da BASE entre a consulta e o merge não é fechada (a regra `ask` para `gh pr edit --base` cobre só o caso reconhecido pelo regex, em melhor esforço). Não existe proteção de branch no GitHub hoje (404 em `dev` e `main`).
5. **Modo.** Só em `auto` e `bypassPermissions` a verificação verde vira `allow`. Nos demais modos vira `ask` (o humano ainda confirma, com o resultado da verificação no motivo). Verificação que falha (gh ausente, timeout, JSON inválido, campo ausente, exceção, base `main` ou outra) é `deny` em qualquer modo; uma exceção inesperada no guarda para comando com o marcador também vira `deny`, e para os demais comandos Bash o guarda sai com código 2 (bloqueia) em vez de deixar passar.
6. **Base trocada depois.** `gh pr edit ... --base` (ou `-B`, inclusive `-Bmain`) é `ask` com `producao: true` (vira `deny` sem confirmação). `gh pr ready` não entrou: só tira o PR de rascunho e o merge ainda exige CI verde, a forma exata e o sha; bloqueá-lo atrapalharia o fluxo normal.
7. **Só para `gh pr merge`.** O marcador não afrouxa nenhum outro comando: com ele, `gh workflow run`, `gh api .../merge`, `git push` em `main`, `terraform` e o resto são `deny`.

Este ADR supera, nesse ponto, o `deny` por modo de permissão do ADR 0046 para `gh pr merge`.

## O que não muda

Merge em `main` (ADR 0034 e 0039), `gh workflow run`, `gh release create`, `gh api` que escreve, `terraform`, `bq`, `gcloud secrets` e KMS, leitura de segredo e `--no-verify`. O processo de release continua em `docs/release/`.

## Risco aceito

O hook é melhor esforço contra ERRO do agente, não contra agente adversário (ADR 0046, item 3). O marcador é digitado pelo próprio agente: o hook garante o escopo da forma exata (dev, repositório fixo, PR nomeado, head fixado, CI verde sem mudança de workflow), não prova que o humano autorizou. A autorização é regra de conduta: o agente só usa o marcador quando o humano autorizou aquele PR, nesta sessão. Um agente que queira burlar tem caminhos que nenhum hook de comando fecha: escrever um script com Write e rodá-lo com `bash x.sh`, trocar a base do PR por um comando que o regex não reconheça, ou mudar o PR por outro caminho. Por isso a revisão do humano ao confirmar e o rastro no GitHub continuam sendo a garantia real.

Recomendação ao humano (fora do escopo do hook, dependem do plano do GitHub, não verificado): criar rulesets em `dev` e `main` com os checks `qualidade` e `integracao` do workflow `ci` obrigatórios, bloqueio de push direto e de `--admin`. Hoje não há proteção alguma.

Resíduos aceitos: o `gh` usa as credenciais do usuário; o `statusCheckRollup` do `gh pr view` pode não paginar acima de 100 checks (não verificado; o repositório tem 3 workflows, bem abaixo disso); a troca da base entre a consulta e o merge (item 4).

## Consequências

- O dono pede o merge do PR N em `dev`, o agente usa o marcador com o repositório e o sha do head, e o hook verifica o escopo, mesmo em `auto`.
- Mudança nesta exceção exige novo ADR e teste em `tests/ambiente-merge-em-dev.test.mjs`.
