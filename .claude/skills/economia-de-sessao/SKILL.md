---
name: economia-de-sessao
description: Disciplina de economia de tokens no nível da SESSÃO (não do comando) para este repo — complementa o RTK.md global, que já filtra a saída de cada comando. Use ao iniciar qualquer tarefa de engenharia de múltiplos passos neste projeto (exploração de código, implementação, verificação, deploy), e sempre que perceber que está repetindo exploração já feita ou acumulando dezenas de chamadas de Bash pequenas.
---

# Economia de sessão — platform

O RTK (`~/.claude/RTK.md`) já resolve a economia **por comando**: filtra saída,
aponta ponteiro em disco, nunca destrói informação. Esta skill resolve o que o
RTK não alcança: o custo que vem do **número de idas e vindas** e da
**repetição de trabalho já feito**, dentro de uma mesma sessão.

Diagnóstico de origem: numa sessão real deste projeto, 223 comandos de shell
geraram overhead de enquadramento mesmo com 55% cobertos pelo rtk (que sozinho
economizou ~82% do payload desses 99 comandos). O maior item isolado de custo
foi perder o worktree no meio da tarefa e ter que re-mapear a estrutura do
zero. Esta skill ataca essas duas causas.

## Regra 1 — Antes de explorar, baixe o mapa que já existe

Não gaste `find`/`ls`/`grep` redescobrindo estrutura que uma sessão anterior
já mapeou. Antes de qualquer exploração:

1. Procure `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/adr/*`, `new_specs.md`
   na raiz — eles já descrevem módulos, convenções e decisões.
2. Se a tarefa toca `src/modules/<x>`, leia primeiro `rtk read -l aggressive`
   nos arquivos de domínio daquele módulo (esqueleto, não corpo) antes de
   fazer grep exploratório linha a linha.
3. Só rode `find`/`ls` amplo se os dois passos acima não derem o suficiente.

## Regra 2 — Um comando, vários padrões; uma mensagem, vários comandos

- Combine padrões num único `grep -nE "a|b|c"` em vez de três chamadas
  separadas de grep. Combine arquivos num único comando (`rtk grep -n padrao
  f1 f2 f3`) em vez de um comando por arquivo.
- Quando duas chamadas de tool não dependem uma da outra, dispare as duas na
  mesma mensagem (paralelo), nunca em sequência "para ver o que vem primeiro".
- Prefira uma sequência `cmd1 && cmd2 && cmd3` dentro de **um** Bash call a
  três Bash calls separados, quando os comandos são sequenciais e baratos de
  descrever juntos (ex.: aplicar migração + checar resultado).

## Regra 3 — Proteja o trabalho antes de depender de diretório temporário

Se o código vive num worktree/diretório gerenciado por outra ferramenta
(Orca, `.orca-preparing/*`, worktrees efêmeros): antes de investir exploração
pesada nele, confirme que o estado é alcançável por um commit/branch
rastreável (`git log`, `git branch -a`, `git remote -v`). Se o diretório for
apagado no meio da sessão, o primeiro passo é procurar o commit mais recente
em `origin/*` — não refazer a árvore do zero. Isso evitou, numa sessão real,
ter que escolher entre recriar tudo do zero ou perder o trabalho.

## Regra 4 — Verificação em escada, não em bloco

Ao validar consistência de uma mudança, rode na ordem do mais barato/rápido
para o mais caro, e pare cedo se algo já reprovar:

1. `typecheck` (segundos, pega a maioria dos erros estruturais)
2. `test:unit` (rápido, sem infraestrutura)
3. `build` (só depois dos dois acima passarem)
4. `test:integration` com infra local (só se a mudança tocar rota HTTP,
   autorização ou banco — nem toda tarefa precisa subir Docker)

Não rode a suíte pesada "para ter certeza" se a mudança não tocou a área que
ela cobre.

## Regra 5 — Subagente é a ferramenta mais cara da caixa

Um subagente de revisão/pesquisa pode custar sozinho mais tokens que toda a
exploração de shell da tarefa (medido: 84K tokens num único subagente de
revisão de segurança, contra ~11K de saída de shell no resto da sessão
inteira). Use subagente quando:

- a tarefa é genuinely isolável (revisão adversarial, pesquisa ampla) e você
  não precisa dos detalhes brutos de volta, só a conclusão; OU
- o usuário pediu explicitamente uma segunda opinião/revisão independente.

Não use subagente para "ajudar a explorar" algo que um `grep`/`read` direto
resolve mais barato. Prefira `fork` (herda contexto) a um agente novo sempre
que o trabalho dependeria de re-explicar o que você já sabe.

## Regra 6 — Não releia o que já está no contexto

Se um arquivo já foi lido (ou editado) nesta conversa e não mudou desde
então, não leia de novo "para confirmar". Edit/Write já validam a escrita;
re-ler para checar é o padrão de desperdício mais comum em sessões longas.

## Regra 7 — Saída verbosa sempre em arquivo, nunca em tela

Build, instalação, migração, subida de container, suíte de teste: sempre
`comando > arquivo.log 2>&1`, depois `rtk read arquivo.log --tail-lines N` ou
`rtk grep -n padrao arquivo.log`. Nunca deixe um comando longo imprimir cru
no terminal da sessão.
