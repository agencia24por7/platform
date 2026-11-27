---
status: accepted
date: 2026-11-24
---
# ADR-0059: Autoria imutável do item de contexto

Corrige o achado 24K-127 (integridade, baixa). Complementa o ADR 0026 (formulário público do contexto) e o ADR 0033 (limites do link). Não supera nenhum dos dois: a regra "o cliente só remove o que ele mesmo escreveu" continua, agora apoiada num fato que não muda.

## Problema

`core.contexto_link_remover_item` (migração 0060) só apagava item com `source = 'cliente'`, e o COMMENT prometia "Item da equipe não some pelo link". Só que `core.contexto_link_salvar_item` (0060 e 0131), ao alterar pelo link um item visível ao cliente, grava `source = 'cliente'`. Bastavam duas chamadas com o mesmo link: editar um item da equipe e depois removê-lo. `source` responde "quem escreveu por último"; a remoção precisava de "quem criou".

## Decisão

### Coluna `origem`
- `core.client_context_items.origem text NOT NULL DEFAULT 'equipe'`, com CHECK `origem IN ('cliente', 'equipe')`.
- `cliente` só quando o item nasceu pelo link (`core.contexto_link_salvar_item`, que passa o valor explícito no INSERT). Todo outro caminho de criação (repositório da equipe, testes, inserção manual) cai no DEFAULT `equipe`, sem mudança em `src/`.
- O domínio é mais estreito que o de `source` (`cliente`, `equipe`, `pesquisa`, `ia`) de propósito: a pergunta que a coluna responde é o canal de criação, e só existem dois. `pesquisa` e `ia` são marcações que a equipe aplica; para a remoção pelo link elas são "equipe". Se um dia um importador gravar por conta própria, o CHECK se alarga num ADR novo.

### Imutabilidade no banco
- Gatilho `client_context_items_origem_imutavel` (`BEFORE UPDATE`, sem `OF origem`, para pegar também troca feita por outro gatilho) chama `core.contexto_origem_imutavel()`, que recusa qualquer UPDATE em que a origem mude, com `check_violation` e `CONSTRAINT = 'client_context_items_origem_imutavel'`. Vale para o app, o worker e o dono.
- A função não é `SECURITY DEFINER` (não precisa atravessar nada), tem `search_path` fixo e `REVOKE ALL FROM PUBLIC`, como os outros gatilhos do contexto. A superfície de definers do app (`tests/apoio/funcoesDefinerDoApp.mjs`) não muda.

### As duas travessias
- `contexto_link_salvar_item` (assinatura de 8 argumentos) grava `origem = 'cliente'` só no INSERT. A alteração continua trocando `source` para `cliente`, `review` para `confirmado` e `shareable` para true: isso é o que faz o cliente continuar vendo o texto que escreveu (`core.contexto_visivel_ao_cliente` usa `source = 'cliente'` para mostrar o que ele mesmo escreveu, e a UI mostra "Fonte: cliente"). Mudar isso alteraria a visibilidade e não é parte da falha. A assinatura de 7 argumentos (0131) só delega e não foi recriada.
- `contexto_link_remover_item` passa a exigir `origem = 'cliente' AND source = 'cliente'`. As duas condições juntas são estritamente mais restritivas que a antiga: item criado pela equipe nunca sai pelo link, mesmo editado pelo cliente; item criado pelo cliente que a equipe depois remarcou com outra fonte continua fora do alcance, como já era.
- Anexar arquivo a item pelo link segue a mesma regra. `contexto_link_reservar_arquivo` e `contexto_link_confirmar_arquivo` (vigentes desde a 0130, nenhuma migração posterior as redefiniu) passam a exigir `origem = 'cliente' AND source = 'cliente'` quando há `p_item_id`; antes bastava `source = 'cliente'`, e o cliente anexava arquivo a um item da equipe depois de editá-lo. A confirmação confere de novo, para a reserva feita sem item não servir para anexar a item alheio.
- `contexto_link_registrar_arquivo` (0060, desativada pela 0130: sem EXECUTE para o app e o gatilho de reserva recusa o INSERT) recebeu a mesma condição, para não ficar uma travessia antiga com a regra frouxa caso alguém devolva o EXECUTE. Continua sem GRANT.
- Assinaturas, `SECURITY DEFINER`, `search_path`, GRANT ao papel do app e REVOKE de PUBLIC são os de antes (conferidos em 0060, 0130, 0131 e 0140; nenhuma migração posterior mudou o GRANT dessas funções). Os corpos recriados só diferem da versão vigente na condição de origem; os COMMENT foram mantidos e acrescidos da regra nova.

### Onde `source = 'cliente'` continua valendo
Varredura da última definição de cada função vigente:

| Função | Uso | Decisão |
|---|---|---|
| `contexto_link_remover_item` | autoriza remover item | trocada: `origem` e `source` |
| `contexto_link_reservar_arquivo` | autoriza anexar a item | trocada: `origem` e `source` |
| `contexto_link_confirmar_arquivo` | autoriza anexar a item | trocada: `origem` e `source` |
| `contexto_link_registrar_arquivo` (desativada) | autorizava anexar a item | trocada, sem devolver o EXECUTE |
| `contexto_visivel_ao_cliente` | visibilidade: o cliente vê o que ele escreveu | mantida: é leitura, e o texto editado por ele deve continuar visível |
| `contexto_link_salvar_item` (alterar) | grava `source = 'cliente'` | mantida: marca quem escreveu por último; a autorização de alterar é a visibilidade, não a autoria |
| `contexto_link_salvar_campo` | grava `source = 'cliente'` em campo escalar | mantida: campo não tem item nem origem; ver "Fora desta entrega" |

### Backfill
O critério é conservador: só vira `cliente` o item para o qual há prova de que nasceu pelo link. A prova é a revisão de criação, escrita pelo gatilho `core.contexto_apos_mudanca` desde a migração 0060 (o mesmo arquivo que criou a tabela, então todo item tem a sua revisão `criar`):

- `target = 'item'`, `item_id` e `client_id` do item, `operation = 'criar'`;
- `via_link_id IS NOT NULL` e `actor_user_id IS NULL` (o gatilho copia `updated_via_link` e `updated_by` do INSERT; só a travessia do link grava `updated_via_link` na criação, e o repositório da equipe grava `updated_by`);
- `after ->> 'source' = 'cliente'`.

Tudo o mais fica `equipe`, inclusive item sem revisão de criação (não deveria existir, mas o lado seguro é o link não poder apagar). Um item da equipe que já foi editado pelo link hoje tem `source = 'cliente'`, mas a revisão de criação dele não tem `via_link_id`, então volta a ser protegido.

Limite conhecido: `via_link_id` tem `ON DELETE SET NULL`. Se um link tivesse sido apagado, os itens que ele criou viram `equipe` e deixam de ser removíveis pelo cliente (a equipe ainda os remove). Links não são apagados pelo app (não há GRANT de DELETE); só somem com o expurgo do cliente, que leva os itens junto.

Durante o backfill os gatilhos `client_context_items_touch` e `client_context_items_revisao` ficam desligados dentro da mesma transação, para não mexer em `updated_at`, não escrever revisão `status` falsa por item e não enfileirar reexportação do brain. A migração recusa rodar se o papel não ignora RLS (a tabela tem `FORCE ROW LEVEL SECURITY` e o UPDATE leria zero linhas sem erro).

### Migração
`db/migrations/0142_autoria_imutavel_do_item_de_contexto.sql`, no par `BEGIN;`/`COMMIT;` de topo que o `migrar.sh` remove para rodar junto com a linha do livro-razão. Não é destrutiva (só acrescenta coluna, CHECK, função e gatilho), não entra em `db/corte-gate.txt`. O `ADD COLUMN` com DEFAULT constante é só metadado no Postgres 16; o `lock_timeout` de 5 s vale para o ALTER TABLE.

## Consequências
- `origem` aparece no `before`/`after` das revisões novas de criação e remoção (o gatilho de revisão não a ignora). Como nunca muda, não gera revisão `status` em edição.
- O repositório da equipe mapeia colunas explicitamente (`paraItem`); a coluna nova não entra no tipo `ItemDeLista` nem no brain exportado.
- O app ainda pode inserir item com `origem = 'cliente'` direto. Não é falha: a equipe já pode remover qualquer item dela.

## Fora desta entrega
- Campo escalar (`client_context_entries`): `contexto_link_salvar_campo` com valor nulo apaga a entrada que o cliente vê, inclusive a escrita pela equipe. É o desenho do ADR 0026 (o cliente corrige o formulário e o anterior fica na revisão) e não usa `source` como autorização; se for para restringir, pede origem também nas entradas, num ADR próprio.

## Critérios de aceite
1. Alterar pelo link um item da equipe e depois tentar removê-lo devolve `nao_encontrado`, e o item continua existindo com `origem = 'equipe'`.
2. Item criado pelo link nasce com `origem = 'cliente'` e continua removível pelo link, inclusive depois de editado.
3. Depois de editar pelo link um item da equipe, reservar ou confirmar anexo a ele devolve `fora_do_escopo` e nenhum arquivo fica ligado ao item; em item criado pelo cliente, mesmo editado, o anexo passa.
4. UPDATE que troque `origem` falha como app e como dono; UPDATE de outras colunas não mexe nela.
5. No backfill, item criado pelo link vira `cliente`; item da equipe, editado pelo link ou marcado `source = 'cliente'` pela equipe, fica `equipe`; `updated_at` e a contagem de revisões não mudam.
6. A lista de definers executáveis pelo app continua igual à allowlist.
