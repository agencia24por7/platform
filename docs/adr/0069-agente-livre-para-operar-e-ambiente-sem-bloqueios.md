---
status: accepted
date: 2026-11-26
---
# ADR-0069: O agente opera livremente, inclusive em produção, e o ambiente perde os bloqueios que travavam o desenvolvimento

## Contexto

Os ADRs 0046, 0047 e 0048 e os hooks do ADR 0039 fizeram o agente pedir confirmação a cada operação de produção, negar essas operações em modo sem confirmação e bloquear a edição da própria guarda. Na prática o desenvolvimento ficou lento: merges, workflows, `terraform apply`, SSH na VM e releases voltavam ao humano; a varredura de segredo, o typecheck no Stop e os hooks do git rodavam em todo commit e push. A task 24K-129 e a decisão do dono do projeto pedem o oposto: o agente faz o trabalho.

## Decisão

1. **O agente pode, sem pedir confirmação por operação:** commit, push (menos direto em `main`), abrir e mergear PR em `dev` e em `main`, disparar workflows, criar release, liberar e aplicar release em produção, `terraform plan|apply|destroy|import|state` (incluindo o bootstrap, quando houver credencial), DDL do BigQuery, mudar segredo e usar a versão de um segredo por script do projeto que a leia sem eco, SSH e túnel para a VM, ligar, desligar e reiniciar a VM, e atuar na UI do app pelo navegador, inclusive mudar e ajustar planos.
2. **Seguem as regras que protegem o dado e o contexto:** nunca imprimir valor de segredo; nunca ler `.env`, chave privada nem `gcloud secrets versions access` direto para o contexto; editar a guarda e os settings do Claude Code pede confirmação (`ask`); nunca apagar backup nem instância do Postgres; nunca `git push` direto em `main` (o caminho é PR e `gh pr merge`); sem hooks do git, não há `--no-verify` a proteger; desativar versão de chave KMS continua pedindo confirmação.
3. **A VM é desligada ao fim do uso** (`scripts/vm-desligar.sh`), como antes.
4. **Sai do ambiente:** os hooks do git (`.githooks/`), a varredura de segredo e de padrão inseguro (`scripts/seguranca-verificar.mjs`, `seguranca-padroes.mjs`, allowlist), o passo de `npm audit` e de segurança no `ci.yml`, o hook Stop (typecheck e testes, 240 s), o hook de orientação por prompt, a exceção de merge em dev do ADR 0048 e o `deny` da proteção da guarda contra edição (virou `ask`). A guarda `guarda-pre-uso.mjs` fica reduzida ao item 2.
5. **Segue:** o CI `ci.yml` com typecheck, testes de unidade, build e integração (`qualidade` e `integracao`), e a rotina de verificação em escada do agente. A integração roda em 6 fatias paralelas (`testes`) mais um job `smoke`, e `integracao` é o agregador que mantém o nome do check (de ~20 min para ~5 min).
6. **Autorização** não é mais ato por operação. A ação que o dono do projeto já delegou aqui vale para qualquer sessão, subagente ou HANDOFF.

## Consequências

- Supera os ADRs 0046, 0047 e 0048 por inteiro e o ADR 0039 (hooks do git e varredura). Supera do ADR 0038 as partes de orientação por prompt, aviso de contexto e varredura no Stop; a escolha de modelo e esforço do `start.sh` continua.
- Supera, em `CLAUDE.md`, nas rules e em `.claude/agents/arquiteto.md`, as frases sobre autorização por operação, merge em dev com marcador e `terraform apply` local negado. Mantém o ADR 0034 (roteiro de release), o ADR 0042 (precondição da chave KMS) e o ADR 0028 (ler o alvo impresso antes de aplicar).
- Risco aceito e registrado: sem hooks nem varredura, um segredo ou padrão inseguro só é pego em revisão humana ou no `security-reviewer`, e um comando de produção errado não passa por confirmação. O dono do projeto aceitou o risco para ganhar velocidade.
- Aceites legais e logins em contas de terceiros continuam fora do alcance técnico do agente: ele diz o que falta.
