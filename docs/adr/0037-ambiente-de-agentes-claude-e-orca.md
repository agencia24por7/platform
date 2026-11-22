---
status: accepted
date: 2026-11-21
---
# ADR-0037: Ambiente de agentes (Claude Code + Orca) versionado no repositório

## Contexto

Sessões longas perdiam contexto, repetiam exploração e podiam contradizer ADRs já aceitos. O `CLAUDE.md` da raiz era um texto de orientação genérico (124 linhas, carregado em toda mensagem), não instruções do projeto. Havia 30 worktrees de agentes acumulados em `.claude/worktrees` e nenhum ponto único para iniciar uma sessão já orientada.

## Decisão

O ambiente de agentes vive no repositório e vale só para ele. Nada é escrito em `~/.claude` nem em outros projetos; o que o usuário já tem globalmente (rtk, hooks de comentário, hooks do Orca) soma-se ao que está aqui sem ser alterado.

Camadas, cada uma com uma função:

1. `CLAUDE.md` enxuto (limite de 120 linhas): regras permanentes, comandos, mapa. Regras por área em `.claude/rules/*.md` com `paths:`, que só entram no contexto ao tocar a área.
2. Agentes em `.claude/agents/`: `arquiteto` (principal, Sonnet), `explorer` (Haiku, somente leitura) e `security-reviewer` (Opus, diff em contexto limpo). A configuração `"agent": "arquiteto"` em `.claude/settings.json` faz toda sessão do projeto, inclusive as abertas pelo Orca, começar como o arquiteto.
3. Hooks em `.claude/settings.json`: `SessionStart` injeta o índice de ADRs, regras, HANDOFF e estado do git (limite de 10.000 caracteres); `Stop` roda typecheck e os testes de unidade dos módulos alterados e bloqueia o encerramento se falharem (ignora quando já está continuando, para não entrar em laço, e quando falta `node_modules`).
4. Skills `handoff` (grava `HANDOFF.md`, não versionado) e `revisar-ambiente`, mais o comando `/start`, que recarrega o contexto numa sessão em andamento.
5. `scripts/start.sh`: ponto de entrada. Inicia `claude --agent arquiteto` com o prompt de início; `--worktree` abre a tarefa num worktree novo pelo Orca (cai para `claude -w` se o Orca não responde); `--opus` troca o modelo; `--dry-run` imprime o comando.
6. `orca.yaml`: `setup` de cada worktree novo (copia `.env` do checkout principal, `npm ci` se faltar e roda o verificador rápido) e `archive`.
7. Bloqueios de leitura (`permissions.deny`) para `node_modules`, `.next`, lockfile, `.env*` e `.claude/worktrees`; `ask` para `terraform apply/destroy`, remoção em bucket e push forçado, alinhados à regra de produção só por Terraform.

Manutenção: `docs/ambiente/README.md` define os gatilhos de revisão e o checklist. `scripts/ambiente-verificar.mjs` (`npm run ambiente:verificar`, coberto por `tests/ambiente-agentes.test.mjs` no CI) falha quando a estrutura sai do combinado.

## Alternativas descartadas

- Linter e formatador no `PostToolUse`: o projeto não tem ESLint nem Prettier configurados; adicioná-los é decisão separada. O `Stop` com `tsc` cobre o erro estrutural.
- Hooks e agentes no `~/.claude`: afetariam outros projetos.
- Subagente `implementador`: o agente principal já roda em Sonnet; delegar implementação simples usa o subagente genérico com modelo Sonnet, sem agente a manter.
- `.claude/hooks` chamando `npm run verify` no `Stop`: lento (build e integração) e dependente de Postgres; a escada completa fica no CI.

## Consequências

- Todo PR que toca `.claude/`, `CLAUDE.md`, `orca.yaml` ou `scripts/start.sh` atualiza `docs/ambiente/README.md` e passa no verificador.
- Os worktrees de agentes antigos não são apagados automaticamente; o verificador avisa quando passam de 10 e a revisão decide caso a caso.
- O `Stop` adiciona alguns segundos (typecheck leva cerca de 7 s) a cada encerramento com `.ts` ou `.tsx` alterado.
