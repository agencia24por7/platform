# Release: regras, limites e decisões do cliente — passo pós-deploy do Brain

Complementa o ADR 0051 (itens 9 e 10) e o roteiro `2026-11-release-cofre-e-contexto.md`. Este passo é do humano (H) em produção; o agente só prepara e roda o ensaio local (ADR 0046).

## O que muda no Brain com esta entrega

- `VERSAO_DO_CATALOGO` do Contexto sobe para 2 (os campos normativos de J e K saem do catálogo) e o esquema do catálogo do Brain sobe para 2 (marca `conteudoNaoConfiavel`, tipos `limite`, `regra` e `decisao`).
- O catálogo passa a publicar `regras.md` (só os vigentes) e `decisoes.jsonl` (uma linha por decisão) em `orgs/<org>/clientes/<cliente>/brain/`, junto de `catalogo.json`.
- Linhas antigas de `client_context_entries` cujos `field_keys` não existem mais no catálogo ficam como histórico no banco, mas o Brain não as publica.

## Passo: reconstruir o brain do Contexto depois do deploy

Por que: o hash do export do Contexto só muda quando o conteúdo muda; com a versão do esquema nova, o `perfil.json` e os arquivos em `contexto/brain/` precisam ser regravados para sumirem os campos removidos. O script força a regravação mesmo sem mudança.

1. Confirmar que o deploy da imagem nova terminou e que a `0141` está aplicada.
2. Ler o alvo antes de agir (ADR 0028): `node scripts/contexto-reconstruir-brain.mjs --help`. **Sem `--local` o script fala com a produção** (`APP_URL`, padrão `https://platform.agencia24por7.com`) e lê o token do worker no Secret Manager (`tria-producao-worker-token`, projeto `tria-platform`). O script não imprime o alvo: confira `APP_URL` e `PROJETO` no ambiente antes de rodar.
3. Ensaio em um cliente só: `node scripts/contexto-reconstruir-brain.mjs --org <uuid> --cliente <uuid>`. Conferir em `contexto/brain/perfil.json` que `orcamento_mensal_total`, `regras_regulatorias`, `o_que_nao_pode_ser_dito`, `quem_aprova` e `prazo_de_aprovacao` não aparecem.
4. Depois, por organização (`--org <uuid>`) ou para todos (`--todos`). `--todos` e `--org` com `--cliente` não se combinam.
5. Rodar a migração dos dados de J e K para decisões (script próprio com `--help` e ensaio, ADR 0051) **antes** do passo 4 em produção, para o conteúdo preenchido já estar em Regras quando os campos saírem do Contexto.

## Catálogo do Brain (regras.md e decisoes.jsonl)

- O catálogo é remontado a cada leitura da API; os arquivos do bucket só são regravados pela varredura `POST /api/v0/brain/publicar-pendentes` (workflow n8n `brain-catalogo-publicar`), que publica quando o hash do catálogo muda, a cada coleta concluída ou no máximo 20 horas depois.
- Para ver `regras.md` e `decisoes.jsonl` logo após o deploy, dispare a varredura uma vez (chamada de worker) ou espere o próximo ciclo.
- Mudança de regra não marca o catálogo como pendente por si só (a `0141` marca só o brain do Contexto). O atraso máximo é o das 20 horas; se for pouco, abrir pendência para a `0141` ou a composição chamarem `brain.marcarPendente`.

## Verificação

- `GET /api/v0/brain/clientes/<id>/catalogo?tipo=limite` devolve os limites vigentes, com `conteudoNaoConfiavel: true`.
- `GET /api/v0/brain/clientes/<id>/diagnostico` traz `regras.lacunasEssenciais` (lidas da coluna `essencial` de `core.limit_definitions`) e as ações `definir_limite:<chave>`.
- `npm run test:integration -- tests/brain.test.mjs` com Postgres e app descartáveis.

## Reversão

O passo só regrava arquivos derivados. Se algo vier errado, rode de novo com a imagem anterior; nenhum dado de decisão é alterado.

## Migração 0141 e migração dos dados de J e K (ADR 0051)

- `db/migrations/0141_regras_limites_e_decisoes_do_cliente.sql` é não destrutiva: cria `core.limit_definitions`, `core.client_decisions` e `core.client_decision_events` (RLS forçada, só `SELECT` e `INSERT` ao app) e carrega as definições iniciais de limite. Não entra em `db/corte-gate.txt`.
- Ordem do release: migração 0141, deploy do app, `scripts/regras-migrar-contexto.mjs` em ensaio (`--help`, conferir o alvo impresso, `--org <uuid>` ou `--todas`), revisão do relatório, `--aplicar` só com autorização nomeada (ADR 0046) e backup conferido, depois a reconstrução do Brain acima.
- `VERSAO_DO_CATALOGO` sobe para 2: as linhas antigas dos campos que saíram de J e K ficam em `client_context_entries` sem leitura pela tela nem pelo Brain.
- A fila "revisar e converter em limite" (texto livre com número) fica na aba Regras de cada cliente.
