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
| Hooks | `.claude/settings.json` + `.claude/hooks/` | início injeta índice; pré-uso é guarda de melhor esforço (nega segredo, backup, push em `main` e `--admin`; pede confirmação no irreversível) |
| Skills e comando | `.claude/skills/`, `.claude/commands/` | `handoff`, `revisar-ambiente`, `economia-de-sessao`, `/start` |
| Worktrees | `orca.yaml` | setup e archive de cada worktree |
| Verificação | `scripts/ambiente-verificar.mjs` | falha se a estrutura sair do combinado |

## Economia, contexto e segurança (ADR 0038)
| Item | Onde | O que faz |
|---|---|---|
| Escolha de modelo e esforço | `.claude/hooks/lib/politicas.mjs`, `scripts/start.sh` | classifica a tarefa; modelo fixo na sessão (cache por modelo) |
| Guarda pré-uso | `.claude/hooks/guarda-pre-uso.mjs`, `.claude/hooks/lib/guarda.mjs`, `.claude/hooks/lib/politicas.mjs` | `deny` para ler segredo, apagar backup ou instância do Postgres (na prática o Postgres de produção é contêiner com volume: `docker compose down -v` e `docker volume rm` pedem confirmação), e push direto em `main`; `ask` para KMS destrutivo, migração versionada editada e comando que descarta trabalho. O resto é livre (ADR 0069). Editar `.claude/hooks/` e `.claude/settings*.json` é `ask`, pela ferramenta de escrita e por shell (`>`, `tee`, `sed -i`, `cp`, `mv`, `rm`; um script que grave por dentro não é detectado); `gcloud secrets versions access` direto é `deny`. `permissions.allow` no settings lista só terraform plan e apply, SSH, merge, workflow, release, scripts da VM e Chrome (um teste garante que não há `gcloud:*`, `gh:*` e semelhantes). A guarda nega `gh pr merge --admin` e pede confirmação em `terraform destroy` e `apply -destroy`, `autorizar_corte=true`, `DROP`/`TRUNCATE`/`DELETE` e `bq rm` no BigQuery e nega comando acima de 30 mil caracteres (conteúdo grande vai pela ferramenta de escrita). A avaliação roda num worker com limite de 6 s; estourar o tempo bloqueia (falha fechada). Push sem destino a partir do ramo main é negado. Pedem confirmação também: apagar segredo, banco, disco, instância, projeto ou cluster; `gh api` que muda `main`, rulesets ou proteção de branch ou faz merge; `bq mk --force`, `bq load --replace` e `CREATE OR REPLACE`; `terraform -replace` e `state rm`; `docker inspect` sem filtro e `docker compose config` (imprimem segredos); `disableAllHooks` e a configuração do Claude do usuário. Nega `grep -r` na raiz e `rg` sem `.gitignore`. A guarda é melhor esforço: não garante contra comando montado de propósito |
| Limites de saída | `settings.env` | `BASH_MAX_OUTPUT_LENGTH`, `MAX_MCP_OUTPUT_TOKENS`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` |
| Esforço | `effortLevel` e `effort` dos agentes | medium padrão; explorer low; security-reviewer high |

Rotina de contexto: `/clear` entre tarefas (grátis), `/handoff` antes, `/rewind` se as últimas voltas erraram, `/compact` só focado em decisões, arquivos alterados e pendências, `/context` uma vez numa sessão nova. Ao pausar mais de uma hora, o cache expirou: prefira `/clear` com HANDOFF a retomar uma sessão enorme.

## Conduta do agente (ADR 0069)
O acesso amplo é compensado por conduta, não por bloqueio: tarefa só do humano na sessão, plano antes de agir em produção, revisão do diff antes de commitar, merge só com CI verde, confirmação nomeada para o que é irreversível e relato depois. O texto vive no `CLAUDE.md` e em `.claude/agents/arquiteto.md`. A `main` deve ter ruleset no GitHub exigindo PR e os checks `qualidade` e `integracao`.

## Verificação
Os hooks do git e a varredura de segurança foram removidos (ADR 0069). O CI (`ci.yml`) roda typecheck, testes de unidade, build e integração; a integração é dividida em 6 fatias paralelas (`testes`) e um job `smoke`, e `integracao` agrega as duas.


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
12. Número de limiar (70% de auto-compact, 100 KB de leitura) é hipótese. Reavalie com `/context` e `/usage` depois de algumas semanas e registre aqui.

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
- [ ] histórico abaixo atualizado

## Histórico de revisões
- 2026-11-21: criação do ambiente (ADR 0037). CLAUDE.md reescrito (a versão anterior era o texto de orientação, não instruções do projeto); a regra "primeira resposta sem código" passou a valer só para proposta nova de arquitetura.
- 2026-11-21: camada de economia de tokens, escolha de potência (modelo e esforço), gestão de contexto e segurança (ADR 0038), com base em pesquisa nas documentações da Anthropic.
- 2026-11-21: hooks do git (pre-commit e pre-push) com varredura e verificação de segurança, espelhados no CI (ADR 0039).
- 2026-11-26: ADR 0069 supera 0039, 0046, 0047 e 0048. Saem hooks do git, varredura de segredo, Stop e prompt; o agente opera produção sem confirmação por operação (24K-129).

## Identidade visual
`CLAUDE.md` aponta para `docs/marca/LEIA-ME.md` (cor, tipografia, azulejo, link do Figma e referência visual da azulejaria). Material visual novo parte dali.
