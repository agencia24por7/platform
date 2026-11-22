# platform (ORLA) — instruções do projeto

Monólito modular Next.js 16 + TypeScript, Postgres 16 com RLS, BigQuery (`tria_dw`), n8n (coletores), Terraform no GCP. Responda sempre em português. Este arquivo é carregado em toda mensagem: mantenha-o abaixo de 120 linhas (regras por área vivem em `.claude/rules/`).

## Antes de agir
- O hook SessionStart injeta o índice de ADRs/docs e o `HANDOFF.md`. Leia com Read os ADRs ligados à tarefa antes de propor ou alterar código; ADR `accepted` não se contradiz, só se supera com um novo ADR.
- Next.js aqui não é o que você conhece: leia o guia em `node_modules/next/dist/docs/` antes de mexer em `app/`.
- Verifique o antes, não só o agora: `git log` do arquivo e o ADR da área.

## Modo arquiteto crítico (proposta nova de arquitetura, modelagem ou escopo)
- Não concorde por educação. Aponte falha, complexidade desnecessária e risco de escala ou segurança, e diga o porquê.
- Na primeira resposta a uma proposta nova: só auditoria crítica, os 5 maiores riscos, perguntas duras e o que CORTAR da v1. Sem código.
- Isto não vale para tarefa já decidida (ADR aceito, bug, execução de plano aprovado): nesses casos, execute.
- Rejeite gambiarra: tratamento de erro, validação de entrada, tipagem estrita e manutenção fácil em toda proposta.

## Regras permanentes
- Produção só muda por Terraform (`infra/terraform` + `infra.yml` na `main`); `infra/terraform/bootstrap` é aplicado à mão com ADC pelo humano. Agente prepara, roda dry-run e entrega o passo; não aplica nada em produção.
- Nunca apagar backups do Postgres. Nunca imprimir valores de segredo. Sem dado pessoal em coletores.
- n8n: nunca usar nem tocar fluxos com tag `credaz` ou `agencia` (são de terceiros); todo workflow da plataforma leva a tag `platform`.
- Aceites legais e logins em contas são do humano.
- Commit e push passam pelos hooks do git em `.githooks/` (varredura de segredo e de padrão inseguro, migração imutável, typecheck, testes, `npm audit`). Nunca `--no-verify` nem trocar `core.hooksPath`; exceção consciente entra na allowlist por PR (ADR 0039).
- VM desligada ao fim de todo trabalho (`scripts/vm-desligar.sh`; liga com `scripts/vm-ligar.sh`).
- Release: nunca mergear `dev` em `main` sem seguir `docs/release/` (ADR 0034).
- Scripts que tocam produção não têm alvo padrão: rode `--help` antes e leia o alvo impresso (ADR 0028).
- Comentário novo em código é negado por hook: o porquê vai para ADR, o que o sistema faz para `docs/`.
- Mudou algo, revise depois: rode o que cobre a área (escada abaixo) e passe o diff por `security-reviewer` se tocar auth, tenant, segredos, infra ou dados pessoais.

## Comandos
- `npm run typecheck` · `npm run test:unit` · `npm run build` · `npm run test:integration` (precisa de Postgres local, ver `.claude/rules/testes.md`) · `npm run verify` (tudo).
- `npm run ambiente:verificar` valida este ambiente de agentes.
- `npm run dev` (porta 3000, lê `.env`); `scripts/dev.sh` equivalente.
- Escada de verificação: typecheck → unit → build → integração (só se tocou rota, autorização ou banco).

## Mapa
- `app/` rotas e server actions · `src/modules/<x>/{domain,application,infrastructure}` regra de negócio · `db/migrations` SQL · `tests/*.test.mjs` integração · `src/**/*.test.ts` unidade.
- `scripts/` operação (BQ, n8n, VM, release) · `infra/` Terraform e compose · `n8n/workflows` coletores · `docs/adr` decisões · `docs/release` roteiros.
- BigQuery: o catálogo canônico é `scripts/bq/README.md` e muda no mesmo PR de qualquer DDL (ADR 0015).

## Economia de contexto
- Comando coberto pelo rtk nunca na cabeça de pipe; saída longa vai para arquivo. Detalhes no `RTK.md` global.
- Exploração ampla (mapear módulo, rastrear dependência, resumir log) vai para o subagente `explorer`; revisão adversarial vai para `security-reviewer`. Pesquisa de uma linha resolve-se com grep direto.
- Uma tarefa = uma sessão: ao trocar de etapa use `/handoff` e depois `/clear` (`/clear` é grátis; `/compact` é uma chamada grande; `/rewind` se as últimas voltas foram erradas). Rode `/context` uma vez numa sessão nova para ver o que já está carregado.
- Skill `economia-de-sessao` vale para tarefas de vários passos.

## Modelo e esforço (a potência certa, nem a mais nem a menos)
- Busca, mapeamento e resumo de log: subagente `explorer` (Haiku, esforço low). Implementação padrão: Sonnet, esforço medium; refator ou vários arquivos: `/effort high`.
- Arquitetura, segurança, revisão adversarial, produção e causa-raiz: Opus (`security-reviewer` em high; `max` só para auditoria de segurança ou causa-raiz depois de duas falhas).
- O modelo se escolhe no início da sessão (`scripts/start.sh` decide pela tarefa) e não muda no meio: o cache é por modelo e trocar reenvia a conversa inteira. Planejar em Opus, `/handoff`, nova sessão em Sonnet para implementar.
- Escale quando precisar: Sonnet falhou duas vezes no mesmo problema, chame um subagente Opus para diagnosticar. Economia nunca justifica baixar o modelo de tarefa crítica.
- Hooks do projeto (`.claude/hooks/`) lembram disto a cada prompt, avisam de contexto grande, barram segredo e comando de produção e varrem o diff por segredo ao parar.

## Identidade visual
- Marca, cor, tipografia e azulejo: `docs/marca/LEIA-ME.md`. Fonte: Figma https://www.figma.com/design/lJ4hDLCunsBTli4MIcZXn2/Orla-%C2%B7-Identidade-visual; referência visual da azulejaria: `docs/marca/referencia-azulejaria.png`. Todo material visual novo (app, site, apresentação) parte dali.

## Ambiente de agentes
- Iniciar sessão: `scripts/start.sh` (ou `/start` dentro de uma sessão). Estrutura, limites e manutenção: `docs/ambiente/README.md` (ADR 0037).
- Mexeu em `.claude/`, `CLAUDE.md`, `orca.yaml` ou `scripts/start.sh`: rode `npm run ambiente:verificar` e atualize `docs/ambiente/README.md` no mesmo PR.
