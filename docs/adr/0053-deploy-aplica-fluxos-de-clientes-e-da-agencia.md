---
status: accepted
date: 2026-11-24
---
# ADR-0053: O deploy aplica os fluxos de clientes e da agência do repositório

## Contexto

O adendo de 2026-11-24 ao ADR 0009 passou a aplicar no deploy os fluxos de `n8n/workflows/clientes/` e `n8n/workflows/agencia/`, por `scripts/n8n-aplicar-clientes.mjs`. As regras permanentes diziam o contrário: o `CLAUDE.md` e `.claude/rules/n8n.md` mandam nunca usar, editar nem listar conteúdo dos fluxos com tag `credaz` ou `agencia`; o ADR 0012 diz que os fluxos da Credaz "não podem ser usados nem alterados pela plataforma"; os ADRs 0046 e 0047 deixam "fluxos n8n de terceiros" com o humano. A revisão de segurança do release dev→main (PR #152) apontou o conflito e o bloqueou, porque ADR aceito não se contradiz, só se supera com ADR novo.

O dono do projeto decidiu em 2026-11-24 que o deploy aplica esses fluxos.

## Decisão

1. **Supera, só neste ponto:** o trecho do ADR 0012 sobre os fluxos da Credaz "não poderem ser alterados pela plataforma" e o item "fluxos n8n de terceiros" dos ADRs 0046 e 0047. O arquivo em `n8n/workflows/clientes/` e `n8n/workflows/agencia/` é a fonte, e o merge em `main` o aplica no n8n pelo deploy, só por `scripts/n8n-aplicar-clientes.mjs`.
2. **Continua valendo:** o código da plataforma nunca chama esses fluxos em tempo de execução nem lê o conteúdo deles para regra de negócio; ninguém os edita pelo editor do n8n; o script não cria nem apaga fluxo; a sincronização da plataforma continua sem ler essas pastas. O agente não usa, não edita no n8n e não lista conteúdo de fluxo `credaz` ou `agencia`.
3. **Quem muda:** qualquer alteração em `n8n/workflows/clientes/`, `n8n/workflows/agencia/` e `scripts/n8n-aplicar-clientes.mjs` é PR do humano (toca fora de `src/`, `app/`, `db/migrations/`, `docs/`, `tests/` e `public/`, ADR 0048) e passa por `security-reviewer`.
4. **Condições, apontadas na revisão e a cumprir:**
   - vincular o alvo pelo id do workflow, num manifesto versionado, e recusar alvo com a tag `platform` ou nome começando por `ORLA ·`;
   - guardar o JSON anterior antes do `PUT` e restaurar se a ativação falhar;
   - fixar a imagem do passo do deploy por `@sha256`;
   - rodar o smoke pós-deploy mesmo se esse passo falhar, e repetir só erro de conexão;
   - `saveManualExecutions: false` nos fluxos que carregam telefone;
   - simulação duas vezes seguidas, com resultado "igual" na segunda, antes da primeira aplicação em produção.
   Até serem cumpridas, o risco é aceito pelo dono do projeto.

## Consequências

- `CLAUDE.md` e `.claude/rules/n8n.md` passam a descrever esta regra; o adendo do ADR 0009 deixa de contradizer as regras permanentes.
- Fluxo de terceiro em produção passa a mudar por merge em `main`, sem passo manual: o revisor de segurança e a confirmação do humano em cada PR são a trava.
- Risco residual: nome igual a workflow da plataforma sobrescreve e reativa esse workflow até o vínculo por id existir.
