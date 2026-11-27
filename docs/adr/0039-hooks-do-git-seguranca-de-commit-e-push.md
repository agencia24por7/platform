---
status: superseded
superseded_by: ADR-0069
date: 2026-11-21
---
# ADR-0039: Hooks do git de segurança (pre-commit e pre-push) espelhados no CI

Complementa os ADRs 0037 e 0038. Vale só para este repositório.

## Contexto

Os hooks do Claude Code (ADR 0038) protegem o que o agente faz, mas não o que um humano ou outra ferramenta commita. Queremos que nada inseguro seja commitado nem enviado por nenhum caminho, e que a regra seja a mesma no commit, no push e no CI.

## Decisão

`scripts/seguranca-verificar.mjs` é a única implementação das regras, com quatro modos: `--staged` (pre-commit), `--push` (pre-push, lê as referências de stdin), `--range A..B` e `--arvore` (CI). Só lê o git; nunca grava nem exibe o valor de um segredo (só `arquivo:linha`, `[id]` e a mensagem).

Regras:
- Segredo conhecido (chave privada, AWS, GitHub, Slack, Google, Meta, `sk-`) e atribuição suspeita de segredo, esta última fora de arquivos de teste, onde é ruidosa; arquivo sensível versionado (`.env*` exceto `.env.example`, chaves, credenciais).
- Código: TLS desligado, HTML injetado sem sanitização, `eval` e `new Function`, SQL e shell montados por interpolação, CORS aberto. Não valem para arquivo de teste.
- Workflow: `pull_request_target`, `write-all`, ação sem SHA de 40 caracteres, baixar e executar script.
- Terraform: `0.0.0.0/0`, `allUsers`, papéis `owner` e `editor`.
- `package.json`: script de instalação e dependência fora do registro ou sem versão.
- Migrações: migração versionada é imutável (alterar, remover ou renomear é bloqueado) e migração nova com `DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA` ou `TRUNCATE` precisa constar em `db/corte-gate.txt` (ADR 0034).
- Só no pre-push: bloqueia push para `main` (exceto `RELEASE_PUSH_MAIN_AUTORIZADO=1`, que o humano usa no fluxo de release) e push que reescreve histórico remoto; roda `typecheck`, `test:unit` e `npm audit --audit-level=high` (sem rede, o audit vira aviso porque o CI repete).

Exceção consciente: uma linha `caminho::id` em `.githooks/seguranca-allowlist.txt`, por PR e com o motivo registrado no próprio arquivo. A allowlist inicial cobre o script de tema com nonce, as regras de firewall públicas e fixtures de token falso.

Instalação: `core.hooksPath` aponta para `.githooks/` (`npm run ambiente:hooks`), feito também por `scripts/start.sh` e pelo `orca.yaml`. Como `core.hooksPath` é configuração do repositório, vale para todos os worktrees dele e não afeta outros projetos.

O hook de ferramentas do Claude Code (`guarda-pre-uso.mjs`) nega `--no-verify` e a troca de `core.hooksPath`, para o agente não contornar os hooks. O CI roda `npm run seguranca:verificar` na árvore inteira, o que cobre quem pula os hooks localmente.

## Alternativas descartadas
- Husky ou lint-staged: dependência extra para o que `core.hooksPath` já faz.
- Varredura só no CI: o segredo já estaria no histórico remoto quando fosse achado.
- Sem allowlist: as regras são heurísticas; sem válvula, o time passaria a usar `--no-verify`.
- Escanear o histórico inteiro no CI: caro e reportaria o que já foi aceito; o modo `--arvore` pega o estado atual e os hooks pegam cada mudança.

## Consequências
- O pre-push leva de dezenas de segundos a alguns minutos (typecheck e testes de unidade).
- Falso positivo possível; o caminho é corrigir o código ou entrar na allowlist por PR.
- Um segredo já vazado exige rotação; este ADR só impede o vazamento novo.
- Quem tem `--no-verify` liberado (humano) ainda pode contornar; o CI e a revisão são a camada seguinte.
