# 0033 — Revisão adversarial: contexto, brain e privacidade

- Status: aceito
- Data: 2026-11-20
- Relaciona: ADR 0026 (contexto do cliente), 0027 (armazenamento do contexto), 0029 (privacidade e
  revogação), 0030 (catálogo do brain), 0032 (cofre de tokens)
- Migrações: 0130 a 0134

Uma revisão independente sobre `dev` (67a6cfe) achou 16 pontos. Todos foram corrigidos neste ADR; nada
ficou para depois. Este registro guarda o porquê de cada decisão; o código não leva comentário.

## Alto

### 1. Envio de arquivo: reserva antes do bucket, sem órfão, com orçamento por link

Antes, o objeto ia ao bucket antes da linha do banco; um `x-item` que não era UUID derrubava o cast no
banco sem `try/catch`, o objeto ficava órfão e fora da cota, e quem tinha o link podia repetir 120 vezes
por minuto 25 MB.

- Os cabeçalhos são validados antes de tudo (`lerPedidoDeEnvio`): chave do campo e da lista no padrão do
  catálogo, `x-item` UUID, lista e item juntos, nome sem caractere de controle, tipo MIME bem formado e
  `Content-Length` obrigatório (411 sem ele) e até 25 MB.
- Todo envio reserva a cota no banco antes de ler o corpo e antes do bucket
  (`core.client_context_file_reservations`). A cota conta arquivos e reservas abertas sob
  `pg_advisory_xact_lock` por cliente, o que serializa envios simultâneos do mesmo cliente.
- O registro só entra consumindo a reserva: o gatilho `client_context_files_exige_reserva` recusa
  qualquer INSERT sem reserva aberta do mesmo id, cliente e caminho, com tamanho até o reservado. A função
  antiga `contexto_link_registrar_arquivo` perdeu o EXECUTE do app.
- Qualquer falha depois do `put` (tipo recusado, banco fora, link revogado no meio) apaga o objeto com
  todas as gerações e libera a reserva, nos dois caminhos (equipe e link).
- Orçamento por link, conferido no servidor: 200 MB e 60 envios por hora, contando também os envios que
  falharam (a reserva liberada continua contando). Esgotado, 429.
- Varredura de órfãos, idempotente, dentro de `POST /api/v0/contexto/publicar-pendentes` (o workflow do
  brain já chama) e em `POST /api/v0/contexto/varrer-arquivos` (`completa: true` varre todos os clientes):
  reserva não consumida com mais de 1 hora tem o objeto apagado e é marcada `varrida_em`; objetos de
  `arquivos/` com mais de 1 hora sem registro nem reserva em andamento são apagados.

### 2. O corpo não é lido antes de validar o token

- A rota pública valida origem e cabeçalhos, pega uma vaga de envio e só então o serviço aplica o limite
  de tentativas, confere o formato do token e abre o link; o corpo é lido por último, pelo leitor injetado,
  contando bytes e abortando no primeiro byte além do declarado (o `Content-Length` é teto, não verdade).
- Vagas por réplica: no máximo 4 envios em andamento (semáforo em memória); acima disso, 429.
- O `proxy.ts` do Next clona e bufferiza na memória o corpo de toda rota que ele intercepta
  (`proxyClientMaxBodySize`, que estava em 26 MB). Por isso as duas rotas de envio saíram do `matcher` do
  proxy (ele só punha o nonce da CSP, inútil numa resposta JSON) e o limite caiu para 1 MB. O teste HTTP
  confere que a rota de envio responde sem o cabeçalho de CSP do proxy e sem esperar o corpo.
- A rota interna segue a mesma ordem: sessão, escopo do cliente, cabeçalhos, vaga, reserva, corpo.

### 3. Bucket no expurgo e na exclusão

`expurgarArmazenamento` existia e ninguém chamava. Agora:

- `POST /api/v0/manutencao/expurgar-armazenamento` (worker, zod, auditoria
  `client.context.storage_purged`, idempotente, devolve quantos objetos apagou). A trava
  `core.contexto_alvo_do_armazenamento` só aceita cliente excluído logicamente ou já expurgado com
  `client.purged` na mesma organização; cliente ativo responde 409.
- `modo: 'tudo'` apaga `orgs/{org}/clientes/{cliente}/` inteiro, todas as gerações. `modo: 'derivados'`
  despublica `contexto/brain/` e `brain/` e zera o hash do export, para a restauração republicar.
- `scripts/titular.mjs`: `expurgar-cliente` roda BigQuery, bucket, Postgres e a limpeza por `client_id`,
  nessa ordem (`etapasDoExpurgo`); o bucket antes do Postgres porque é o Postgres que sabe a organização
  e a trava, e uma falha ali deixa o Postgres intacto para repetir. Sem o cliente no Postgres, a
  organização vem da linha `client.purged`. `--somente-armazenamento` repete só o bucket.
  `excluir-cliente` despublica os derivados. Preferimos a rota ao acesso direto do script ao bucket:
  o script já fala com o app assim (dimensões), o app é quem tem a credencial do bucket e a trava fica no
  banco.
- `arquivos/` de cliente excluído não tem rota de leitura no app (não existe download); fica até o
  expurgo ou a restauração.
- O soft delete do bucket (7 dias, `contexto.tf`) é o atraso efetivo do apagamento físico
  (docs/lgpd/retencao.md).

### 4. YouTube: conexão viva não perde os dados

O job contava só `active`/`expiring`; `reauth_pending` ou `degraded` por 7 dias disparava DELETE
irreversível no BigQuery, e o corte do cofre (ADR 0032) põe todas as conexões em `reauth_pending`.

- `integrations.connections.status_desde` (gatilho) mede há quanto tempo a conexão está no status.
- `privacidade.autorizacao_viva`: `active`/`expiring` sempre; `reauth_pending`/`degraded` por 30 dias; a
  conexão capturada no corte, enquanto não for reautorizada ou revogada. `revoked` e conexão removida não
  contam. Remover conexão, o job diário e a fila usam a mesma regra.
- Com o corte em andamento (`privacidade.corte_do_cofre_em_andamento`) o job não enfileira nada
  (`pausadoPeloCorte`) e a fila não executa expurgo por falta de autorização. A migração cancelou, ao
  rodar, os expurgos `sem_autorizacao_ativa` de canais que a regra nova considera autorizados.

## Médio

### 5. Lista pessoal não vaza pela seção

A entrada da seção apontava, como `permitido`, para `perfil.json`, que trazia os itens de personas e
depoimentos. Agora listas com `avisoDeDadoPessoal` saem de `perfil.json`, `perfil.md` e `anexos.json`
(fica `{ restrita, total, arquivo }` e uma linha com a contagem); os itens ficam só no `.jsonl` da lista,
cuja entrada é `restrito`. O esquema do brain subiu para 2, o que força a republicação de todos os brains
e tira o dado pessoal dos arquivos já publicados.

### 6. Injeção de instrução no brain

Texto livre do cliente entrava cru no `perfil.md`. Agora todo valor vai como trecho de código (crases
mais longas que as do valor) ou bloco cercado (cerca maior que qualquer sequência de crases do valor),
sem caracteres de controle nem de direção bidi; títulos de item também. O cabeçalho avisa que o conteúdo
cercado é dado, não instrução. No `catalogo.md` (publicado e o do painel) títulos e descrições passam por
`textoNeutro`: marcação escapada e esquemas de URL desarmados. Saída determinística.

### 7. Posse legada e cliente renomeado

A 0080 casava nome antigo de cliente renomeado com quem herdou o nome. A 0133:

- grava `client.renamed` (de, para, ids) em toda troca de nome (gatilho);
- reúne a história de nomes (atuais, `client.status_changed`, `client.create`, renomeações e pares
  gravados pelo app, sem contar as linhas que a própria 0080 preencheu); um nome só aponta para um
  cliente se for único nessa história e se o cliente já existia no instante da linha;
- revisa as linhas da 0080: id que a regra nova não confirma sai e fica em `idsRemovidos`; linha sem
  dono resolvível ganha `posseDesconhecida`, e `dono_anterior_da_auditoria` deixa de casar por nome
  nesses casos. Idempotente; `preencher_ids_de_posse_legados` passou a delegar à regra nova.
- Limite conhecido: renomeação anterior ao gatilho, sem nenhuma linha que a registre, só é pega pela
  data de criação. Na dúvida o dono fica desconhecido (nada é apagado por engano).

### 8. Pimenta dedicada do pseudônimo da Meta

O pseudônimo usava `TRIA_SESSION_SECRET`; trocar o segredo de sessão quebrava a idempotência. Agora
`META_EXCLUSAO_PEPPER` (segredo `meta-exclusao-pepper` no Secret Manager, startup, `completar-env.sh`,
compose e `env.ts`; obrigatória em produção com `META_APP_SECRET`, e diferente do segredo de sessão). O
app calcula também o pseudônimo pela derivação antiga e a função
`registrar_pedido_de_exclusao_meta(text, text[], text, text)` migra para o novo o pedido gravado com o
antigo antes de decidir se há pedido aberto.

### 9. Limite de leitura do brain por cliente

A chave passou a ser token + cliente (300/min por padrão, `BRAIN_LEITURAS_POR_MINUTO`), com teto geral
por token (3.000/min, `BRAIN_TETO_DE_LEITURAS_POR_MINUTO`).

## Baixo

10. O índice único parcial contava link vencido como vivo (índice não pode usar `now()`); virou o gatilho
    `client_context_links_um_vivo_por_convite`, com trava por convite. Conflito real vira 409 no app.
11. `regenerarLink` valida tudo antes (incluindo o convite) e revoga e cria na mesma transação: se a
    criação falhar, nada é revogado.
12. `contexto_link_pelo_convite` respeita o `expires_at` e o status `expired` do convite; a criação do
    link também.
13. Teto de itens por lista conferido sob trava por (cliente, lista): gatilho de 500 em todo INSERT, o
    máximo do catálogo na função do link (nova assinatura com `p_maximo`) e no repositório da equipe.
14. A gaveta do celular fecha em qualquer clique em link, inclusive o da página atual (o `dialog`
    devolve o foco ao botão e o Esc continua nativo).
15. `frescorPelaColeta` saiu do exemplo para `painel/brain/frescor.ts`; o exemplo virou
    `exemploDeTeste.ts`, e um teste garante que nada de produção o importa.
16. A abertura do formulário vai à trilha no máximo uma vez por link por hora
    (`abertura_registrada_em`); `last_used_at` continua a cada uso.

## Implantação

1. `terraform apply` (cria o segredo `meta-exclusao-pepper`).
2. Adicionar a versão do segredo: 32+ caracteres aleatórios, diferente do segredo de sessão.
3. Deploy normal: o `completar-env.sh` lê o segredo para o `.env` sem reiniciar a VM; as migrações 0130 a
   0134 rodam antes do app novo. Durante a troca de imagem, envio de arquivo pela imagem antiga falha
   (a função antiga perdeu o EXECUTE e o gatilho exige reserva): é esperado e dura o tempo do deploy.
