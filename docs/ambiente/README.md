---
status: active
owner: arquiteto
---
# Ambiente de agentes do platform (Claude Code + Orca)

Decisão e porquês: ADR 0037 (`docs/adr/0037-ambiente-de-agentes-claude-e-orca.md`) e ADR 0038 (`docs/adr/0038-economia-de-tokens-contexto-e-seguranca-dos-agentes.md`). Tudo aqui vale só para este repositório; nada é gravado em `~/.claude`.

## Como iniciar uma sessão
- `scripts/start.sh [tarefa]` abre o Claude como agente `arquiteto` com o contexto já injetado e escolhe modelo e esforço pela tarefa (crítica: Opus; resto: Sonnet). `--opus`, `--modelo`, `--esforco` e `--sem-auto` forçam; `--worktree <nome>` isola pelo Orca; `--dry-run` mostra o comando e não exige o binário `claude` (o CI roda os testes do ambiente sem ele).
- Dentro de uma sessão aberta: `/start` recarrega o contexto; `/handoff` grava o estado em `HANDOFF.md`; depois `/clear`.
- Uma tarefa = uma sessão = um worktree quando houver trabalho paralelo.

## Mapa das camadas
| Camada | Onde | Função |
|---|---|---|
| Memória do projeto | `CLAUDE.md` (≤120 linhas) | regras permanentes, comandos, mapa |
| Regras por área | `.claude/rules/*.md` (`paths:`) | entram no contexto só ao tocar a área |
| Agentes | `.claude/agents/` | `arquiteto` (Sonnet), `explorer` (Haiku), `security-reviewer` (Opus) |
| Hooks | `.claude/settings.json` + `.claude/hooks/` | início injeta índice; prompt orienta modelo e contexto; pré-uso barra segredo e produção; parada valida tipos, testes e varre segredo |
| Skills e comando | `.claude/skills/`, `.claude/commands/` | `handoff`, `revisar-ambiente`, `economia-de-sessao`, `/start` |
| Worktrees | `orca.yaml` | setup e archive de cada worktree |
| Verificação | `scripts/ambiente-verificar.mjs` | falha se a estrutura sair do combinado |

## Economia, contexto e segurança (ADR 0038)
| Item | Onde | O que faz |
|---|---|---|
| Escolha de modelo e esforço | `.claude/hooks/lib/politicas.mjs`, `scripts/start.sh` | classifica a tarefa; modelo fixo na sessão (cache por modelo) |
| Orientação por prompt | `ao-enviar-prompt.mjs` | uma linha só quando foge de Sonnet/medium; avisa contexto grande (700 KB e 1,2 MB) |
| Guarda pré-uso | `guarda-pre-uso.mjs` | `deny` para ler segredo, apagar backup, push em main, `--no-verify`, `core.hooksPath`, `terraform apply` local e chave KMS; `ask` (o humano autoriza cada operação, ADR 0046; vira `deny` sem modo de confirmação) para DDL em produção, mudar segredo, deploy e merge; leitura de arquivo enorme, migração versionada. Exceção estreita (ADR 0048): `AUTORIZO_MERGE_EM_DEV=<n> gh pr merge <n> --repo github.com/agencia24por7/platform --merge\|--squash\|--rebase --match-head-commit <sha40>` (forma exata) é `allow` só em `auto`/`bypassPermissions` (nos demais modos é `ask`), e só se o PR é de `dev`, aberto, não rascunho, sem fork, sem arquivo em `.github/`, com head igual ao sha, e com `qualidade` e `integracao` do workflow `ci` verdes da mesma execução (consulta `gh` por caminho absoluto, `--repo` fixo, ambiente mínimo, timeout de 5 s; "fecha por padrão" vale para falha de consulta e exceção, e o timeout do gh é menor que o do hook justamente para o hook não morrer sem decidir; exceção inesperada em Bash sai com código 2); o corpo do guarda está em `.claude/hooks/lib/guarda.mjs`; `gh pr edit --base` é `ask`; o marcador é declarado pelo agente, então o hook garante o escopo, não a autorização |
| Varredura de segredo | `varrer-segredos.mjs` (Stop) | bloqueia o encerramento se o diff tiver segredo; nunca exibe o valor |
| Limites de saída | `settings.env` | `BASH_MAX_OUTPUT_LENGTH`, `MAX_MCP_OUTPUT_TOKENS`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` |
| Esforço | `effortLevel` e `effort` dos agentes | medium padrão; explorer low; security-reviewer high |

Rotina de contexto: `/clear` entre tarefas (grátis), `/handoff` antes, `/rewind` se as últimas voltas erraram, `/compact` só focado em decisões, arquivos alterados e pendências, `/context` uma vez numa sessão nova. Ao pausar mais de uma hora, o cache expirou: prefira `/clear` com HANDOFF a retomar uma sessão enorme.

## Hooks do git (ADR 0039)
| Hook | Roda | Barra |
|---|---|---|
| `.githooks/pre-commit` | `seguranca-verificar.mjs --staged` | segredo, arquivo sensível, padrão inseguro, workflow, Terraform, dependência, migração imutável ou destrutiva fora do portão |
| `.githooks/pre-push` | `seguranca-verificar.mjs --push` | o mesmo sobre os commits enviados, push em `main`, histórico reescrito, mais typecheck, testes de unidade e `npm audit` |
| CI (`ci.yml`) | `npm run seguranca:verificar` | a árvore inteira, também para quem pulou os hooks |

Instalação: `npm run ambiente:hooks` (o `start.sh` e o `orca.yaml` já fazem). O agente é impedido de usar `--no-verify` e de trocar `core.hooksPath` pelo hook de ferramentas. Exceções: `.githooks/seguranca-allowlist.txt`, uma linha `caminho::id` por PR com justificativa.

## Regras de manutenção
1. Mudou `.claude/`, `CLAUDE.md`, `orca.yaml` ou `scripts/start.sh`: rode `npm run ambiente:verificar` e atualize este documento no mesmo PR.
2. `CLAUDE.md` tem teto de 120 linhas. O que cresce vai para uma rule de área; se não cabe em nenhuma, crie a rule com `paths:` que case arquivos reais.
3. Regra nova ou superada em ADR: a rule da área muda no mesmo PR. Rule sem ADR ou doc que a sustente é removida na revisão.
4. Pasta de topo nova, módulo novo em `src/modules/` ou script novo de operação: entra no mapa do `CLAUDE.md` e em uma rule.
5. Hook novo precisa de teste em `tests/ambiente-agentes.test.mjs` e roda com `$CLAUDE_PROJECT_DIR`, nunca com caminho absoluto nem `$HOME`.
6. Toda rule tem `paths:` e até 60 linhas; todo agente tem `name` igual ao arquivo, `description` e `model` explícito. `security-reviewer` é Opus; `explorer` é Haiku e sem ferramenta de escrita.
7. Escopo: configuração só neste repositório. Ajuste global (rtk, hooks pessoais) fica fora e nunca é editado a partir daqui.
8. Segredo, dado pessoal e valor de `.env` nunca entram em `CLAUDE.md`, rules, agentes, skills nem HANDOFF.
9. Comentário novo em código é negado por hook; o porquê vai para ADR e este documento descreve o ambiente.
10. Política de segurança ou de modelo nova entra em `.claude/hooks/lib/politicas.mjs` com teste em `tests/ambiente-economia-seguranca.test.mjs`; regra sem teste não vale. Nunca coloque valor real de segredo em fixture: monte em tempo de execução.
11. O classificador de tarefas é heurístico: se errou, ajuste a palavra-chave e acrescente o caso ao teste, em vez de contornar no prompt.
13. Regra nova de segurança no `seguranca-verificar.mjs` precisa de caso em `tests/ambiente-git-hooks.test.mjs` e de passar na árvore (`npm run seguranca:verificar`) sem inflar a allowlist; allowlist só com o motivo registrado nela.
12. Número de limiar (700 KB, 1,2 MB, 70% de auto-compact, 100 KB de leitura) é hipótese. Reavalie com `/context` e `/usage` depois de algumas semanas e registre aqui.

## Gatilhos de revisão
Rode a skill `revisar-ambiente` quando:
- terminar uma release (`docs/release/`);
- criar módulo, pasta de topo ou plataforma de coleta nova;
- um ADR aceito mudar uma regra que as rules repetem;
- o verificador avisar de worktrees acumulados ou de limite de tamanho;
- mudar o catálogo de modelos ou o suporte a `effort`, hooks ou variáveis de ambiente do Claude Code (releia a documentação de custos e de hooks);
- passar um mês sem revisão.

## Checklist de revisão
- [ ] `npm run ambiente:verificar` verde
- [ ] regras do CLAUDE.md batem com os ADRs aceitos recentes
- [ ] cada rule ainda casa arquivos e não repete o que o código já deixa claro
- [ ] índice de início cabe em 10.000 caracteres e lista o que importa
- [ ] worktrees órfãos listados; remoção só com pedido do humano
- [ ] limiares de contexto ainda fazem sentido (`/context`, `/usage`)
- [ ] classificador acertou nas últimas tarefas; casos errados viraram teste
- [ ] nenhum `deny`/`ask` novo ficou sem teste
- [ ] allowlist de segurança revisada: cada linha ainda se justifica e o arquivo existe
- [ ] histórico abaixo atualizado

## Histórico de revisões
- 2026-11-21: criação do ambiente (ADR 0037). CLAUDE.md reescrito (a versão anterior era o texto de orientação, não instruções do projeto); a regra "primeira resposta sem código" passou a valer só para proposta nova de arquitetura.
- 2026-11-21: camada de economia de tokens, escolha de potência (modelo e esforço), gestão de contexto e segurança (ADR 0038), com base em pesquisa nas documentações da Anthropic.
- 2026-11-21: hooks do git (pre-commit e pre-push) com varredura e verificação de segurança, espelhados no CI (ADR 0039).

## Identidade visual
`CLAUDE.md` aponta para `docs/marca/LEIA-ME.md` (cor, tipografia, azulejo, link do Figma e referência visual da azulejaria). Material visual novo parte dali.
