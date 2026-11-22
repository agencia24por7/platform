---
status: accepted
date: 2026-11-21
---
# ADR-0038: Economia de tokens, gestão de contexto, escolha de modelo e segurança dos agentes

Complementa o ADR 0037. Vale só para este repositório.

## Contexto

Queremos a potência certa para cada tarefa: nem um modelo maior nem um esforço maior que o necessário, e nunca menor que o necessário numa tarefa crítica. Também queremos conter o crescimento do contexto e impedir que um agente vaze segredo ou toque produção. Pesquisa feita em 2026-11-21:

- [Docs do Claude Code, custos](https://code.claude.com/docs/en/costs.md): Sonnet cobre a maior parte das tarefas de código; Opus fica para decisão de arquitetura e raciocínio em várias etapas; subagente simples usa `model: haiku`; `/clear` entre tarefas não custa nada e `/compact` é uma chamada grande; thinking vem ligado e não desliga nos modelos 5.5 (o ajuste é o nível de esforço); definições de MCP são diferidas por padrão; manter o `CLAUDE.md` abaixo de 200 linhas; filtrar saída de comando por hook.
- [Anthropic, maximizando o valor das sessões](https://claude.com/blog/maximizing-the-value-of-your-claude-code-sessions): cada modelo tem o seu próprio cache, então trocar de modelo no meio da conversa reenvia tudo a preço cheio; troque no início ou logo após `/clear`; `/rewind` em vez de `/compact` quando as últimas voltas foram erradas; cache expira em cerca de uma hora (assinatura) ou cinco minutos (chave de API); subagente em tarefa pequena é só custo extra; "eficiência não é usar menos tokens no total".
- [Anthropic Engineering, engenharia de contexto](https://anthropic.com/engineering/effective-context-engineering-for-ai-agents): menor conjunto possível de tokens de alto sinal, recuperação sob demanda em vez de pré-carregar, e subagentes para tarefas longas. A página original não foi lida por inteiro; o resumo vem de fontes secundárias.
- Documentação de hooks e de subagentes: `UserPromptSubmit` injeta `additionalContext`; `PreToolUse` devolve `permissionDecision` (`allow`, `deny`, `ask`); `effort` existe no frontmatter de subagente (`low` a `max`); `effortLevel` existe em settings de projeto (`low` a `xhigh`, sem `max`). Regras `deny` e `ask` de settings continuam valendo por cima do hook.
- Pesquisa em blogs de terceiros (KDnuggets, Composio, MindStudio) repete as mesmas práticas; números de economia citados por eles não foram verificados e não são usados aqui.

## Decisão

### Potência certa por tarefa
| Tarefa | Modelo | Esforço |
|---|---|---|
| Busca, mapeamento, resumo de log | subagente `explorer` (Haiku) | low |
| Implementação padrão | Sonnet (agente `arquiteto`) | medium (padrão do projeto) |
| Refator, vários arquivos | Sonnet | high, por `/effort high` na tarefa |
| Arquitetura, segurança, revisão adversarial, produção, causa-raiz | Opus (`security-reviewer` ou sessão iniciada em Opus) | high |
| Auditoria de segurança, causa-raiz após duas falhas, migração destrutiva | Opus | max |

- O modelo é escolhido no início da sessão e não muda no meio (cache por modelo). `scripts/start.sh` classifica a tarefa e passa `--model` e `--effort`; `--modelo`, `--opus`, `--esforco` e `--sem-auto` forçam. Planejar em Opus, gravar `/handoff`, implementar em nova sessão Sonnet.
- Escalar é permitido e esperado: Sonnet falhou duas vezes no mesmo problema, o diagnóstico vai para um subagente Opus. Economia nunca justifica reduzir o modelo de tarefa crítica.
- `effortLevel: medium` em `.claude/settings.json` é o padrão do projeto. O `arquiteto` não fixa `effort` no frontmatter (o fixo sobrepõe o `--effort` do `start.sh`); `explorer` fixa `low` e `security-reviewer` fixa `high`.
- O classificador (`.claude/hooks/lib/politicas.mjs`) é heurístico, por palavras-chave. Ele sugere; o humano ou o agente decide. Prompt de busca pura vence palavra-chave crítica (listar onde `withTenant` é usado é busca, não segurança), desde que não haja verbo de ação.

### Contexto
- Hook `UserPromptSubmit` (`ao-enviar-prompt.mjs`): a cada prompt injeta, só quando foge do padrão Sonnet/medium, uma linha de orientação de modelo ou esforço; mede o tamanho da transcrição e avisa uma vez por nível (700 KB aviso, 1,2 MB crítico, ajustáveis por `PLATFORM_CONTEXTO_AVISO_BYTES` e `PLATFORM_CONTEXTO_CRITICO_BYTES`). A transcrição é uma aproximação: ela cresce também depois de `/compact`, então o aviso pode vir cedo numa sessão compactada.
- `settings.env`: `BASH_MAX_OUTPUT_LENGTH=20000`, `MAX_MCP_OUTPUT_TOKENS=10000` e `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=70` (compacta mais cedo que o padrão; o 70 vem de uma fonte de terceiros, vale reavaliar após uso).
- Leitura inteira de arquivo com mais de 100 KB é negada pelo hook de `PreToolUse`; o caminho é `grep -n` e depois leitura com `offset` e `limit`. O rtk global filtra a saída de comandos e continua valendo.
- Regras por área só carregam ao tocar a área; `CLAUDE.md` com teto próprio de 120 linhas (o oficial é 200).
- `/clear` entre tarefas, `/handoff` antes dele, `/rewind` para voltas erradas, `/context` uma vez numa sessão nova.

### Segurança
- Hook `PreToolUse` (`guarda-pre-uso.mjs`) em `Bash`, `Read`, `Write`, `Edit` e `MultiEdit`, com a política em `politicas.mjs`:
  - `deny`: ler ou gravar `.env*` (exceto `.env.example`), chaves e credenciais; imprimir variável de segredo, despejar o ambiente ou ler valor de segredo no Secret Manager; apagar backup; `rm -rf` em raiz, HOME ou `.git`; `git push` para `main`; `bq-ddl` em produção sem `--dry-run`; `curl | sh`; escrever conteúdo com aparência de segredo; editar `node_modules`, `.next` e o lockfile à mão.
  - `ask`: `gh workflow run`, `gh pr merge`, `git reset --hard`, `git clean -f`, `git push --force`, `--no-verify`, SQL destrutivo via `psql` ou `docker exec`, editar migração já versionada (imutável).
- Hook `Stop` (`varrer-segredos.mjs`) varre as linhas adicionadas do diff e os arquivos novos por padrões de segredo e bloqueia o encerramento sem nunca exibir o valor, só `arquivo:linha` e o tipo.
- Falha de leitura da entrada do hook nunca bloqueia (fail-open), para não travar a sessão por defeito do próprio hook; a política deny/ask das settings e o CI continuam como camada independente.
- Limite assumido: a política por regex não impede quem quer contornar (por exemplo, montar o comando por variável). Ela barra o erro comum e o prompt injection óbvio; a barreira final é o princípio de que produção só muda por Terraform e CI, com aprovação humana.

## Alternativas descartadas
- Trocar de modelo no meio da sessão por hook: o hook não consegue trocar o modelo e a troca invalida o cache.
- Aplicar `effort` no `arquiteto`: sobreporia a escolha por tarefa do `start.sh`.
- Hook `PostToolUse` para encurtar saída: não altera a saída de ferramentas nativas; o limite é `BASH_MAX_OUTPUT_LENGTH` mais o rtk.
- Fixar Opus como padrão: custo sem ganho na maior parte das tarefas.

## Consequências
- Cada chamada de ferramenta passa por um processo Node curto (dezenas de milissegundos).
- Falso positivo possível no detector de segredo; o caminho é trocar o valor por variável de ambiente, que é o desejado.
- `docs/ambiente/README.md` e `npm run ambiente:verificar` cobrem estes itens; testes em `tests/ambiente-economia-seguranca.test.mjs`.
