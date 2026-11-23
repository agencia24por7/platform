---
status: accepted
date: 2026-11-21
---
# ADR-0041: Tenant sem sessão falha alto e as travessias por token são exceção documentada

> Item 4 e Limites superados parcialmente pelo ADR 0045: a exceção de `GRANT` ao app vale agora pela allowlist exata do ADR 0045 (lista em `tests/apoio/funcoesDefinerDoApp.mjs`), e a sessão em entrada pública passa a ser ignorada.

Complementa os ADRs 0021, 0026, 0028 e 0036. Vale para o app e para o banco.

## Contexto
`escopoDeCliente` (`src/shared/db/escopo.ts`) devolvia "organização inteira" quando não havia sessão. O caso legítimo era o worker (`/api/v0`) e as entradas públicas por token (convite, link de contexto, callback de OAuth do convite, exclusão da Meta). Qualquer outro caminho que chegasse ali sem sessão por engano ganhava acesso à organização inteira em silêncio. A política `organizations_read` (0021) aceita `core.current_user_id() IS NULL` pela mesma razão, e seis funções `SECURITY DEFINER` por token têm `GRANT EXECUTE` ao papel do app, o que a regra de `banco.md` reserva ao worker.

## Decisão
1. Sem sessão, `escopoDeCliente` só devolve a organização inteira se a chamada é do worker (`comoWorker`) ou de uma entrada pública declarada (`comoPublico`, `src/shared/db/client.ts`; `entradaPublica` em `src/shared/http/entradaPublica.ts`). Fora disso lança erro. A entrada pública usa o pool do app, não o do worker.
2. Cada rota ou ação pública declara a entrada. `src/shared/db/fronteiraDoWorker.test.ts` falha se um arquivo de `app/` chama `modules()` sem sessão e sem declarar `comoPublico`/`entradaPublica` (exceções listadas no teste).
3. `organizations_read` continua aceitando `current_user_id() IS NULL`: as entradas públicas rodam como `orla_app` sem usuário e precisam ler a organização do token. O fechamento está no app (item 1), não na política.
4. Exceção documentada às regras de `banco.md`: `integrations.resolve_webhook_connection`, `record_whatsapp_inbound` (0026) e `resolve_invite_item`, `resolve_invite_for_display`, `invite_item_still_pending`, `complete_invite_item` (0028) mantêm `GRANT EXECUTE` ao papel do app. Cada uma resolve pelo segredo do token (nunca por id), recusa convite expirado ou revogado antes de devolver algo, e não devolve segredo nem dado de outra plataforma. Função nova que atravesse inquilinos continua só para `orla_worker`.

## Limites conhecidos
- O teste estático procura os marcadores de sessão no texto do arquivo inteiro e não segue helpers transitivos. O erro em tempo de execução é fechado (lança, não vaza); o teste reduz o 500 em produção, não o garante.
- A lista de arquivos que usam `comoPublico`/`entradaPublica` é exata em `fronteiraDoWorker.test.ts`: acrescentar entrada pública exige editar a lista, que é a revisão.
- A publicação adiada do brain (`contextoService`) roda fora da requisição e declara `comoPublico`; falha vira `logger.warn`.

## Consequências
- Chamada de tenant sem sessão fora dessas exceções vira erro e aparece em teste, e não vaza dado.
- Entrada pública nova precisa de `entradaPublica` ou `comoPublico`, ou o teste estático reprova.
- Sessão válida de outra organização numa página pública continua sem vínculo vivo com a organização do token e erra como antes; tratar isso (ignorar a sessão em página pública) fica para outra decisão.
