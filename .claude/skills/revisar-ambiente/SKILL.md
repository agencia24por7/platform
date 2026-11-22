---
name: revisar-ambiente
description: Revisa o ambiente de agentes do projeto (CLAUDE.md, .claude/, orca.yaml, scripts/start.sh) contra os gatilhos de docs/ambiente/README.md. Use após cada release, ao criar módulo ou pasta de topo, ao mudar um ADR de regra e a cada mês.
disable-model-invocation: true
---
1. Rode `npm run ambiente:verificar` e trate qualquer falha antes de continuar.
2. Leia `docs/ambiente/README.md` (gatilhos e checklist) e confira cada item contra o estado atual do repositório.
3. Compare os ADRs aceitos desde a última revisão (`git log --since` em `docs/adr/`) com `.claude/rules/`: regra nova ou superada precisa estar refletida na rule da área.
4. Compare `src/modules/`, `app/`, `scripts/` e `infra/` com o mapa do CLAUDE.md: pasta de topo nova entra no mapa e em uma rule.
5. Procure o que não faz mais sentido: regra sem ADR que a sustente, hook que ninguém dispara, pasta de `paths` que não existe, worktrees órfãos (`git worktree list`; liste, não apague sem pedir).
6. Registre o resultado na seção "Histórico de revisões" de `docs/ambiente/README.md` (data, o que mudou) e rode o verificador de novo.
