# Manifesto dos fluxos de clientes e da agência no n8n

Condições do ADR 0053 sobre `scripts/n8n-aplicar-clientes.mjs`. O manifesto é `n8n/clientes-manifesto.json`. Fica fora de
`n8n/workflows/` de propósito: a sincronização da plataforma e os testes leem todo `*.json` da raiz dessa pasta como
workflow. No deploy ele é copiado ao lado do script.

O comportamento real do n8n 2.x (PUT, ativação, `versionId`) não foi validado contra uma instância; o script confere o
resultado por GET e falha alto quando algo não bate.

## Formato

```json
{
  "clientes/credaz/rd-para-meta-conversoes.json": { "id": "<id do workflow no n8n>", "nome": "<nome exato esperado>" }
}
```

A chave é o caminho do arquivo relativo a `n8n/workflows/`, com `/`. Arquivo fora do manifesto não é aplicado e o passo do
deploy falha. O arquivo versionado começa vazio (`{}`): os ids reais só o humano obtém, por túnel.

## Regras do script

- Aplica só no workflow do id do manifesto. O nome implantado e o nome do arquivo têm de ser iguais ao `nome` do manifesto.
- Recusa (erro, arquivo não aplicado) alvo com tag `platform` ou nome começando por `ORLA ·`. A comparação normaliza nome e
  tag (NFKC, minúsculas, espaços colapsados) e recusa se o GET por id não devolver o array de tags.
- Id inexistente, nome divergente, credencial de exemplo (`a-definir…`) e arquivo fora do manifesto são erro definitivo.
  O manifesto não aceita o mesmo id em dois arquivos.
- `--aplicar` exige `--backup-dir <dir>`. Antes de cada `PUT`, grava `<id>-<timestamp>.json` (arquivo 0600, diretório 0700)
  com `name`, `nodes`, `connections`, `settings` e `active` (sem `pinData` nem `staticData`). A retenção por id guarda a cópia
  mais antiga (a de antes da primeira aplicação) e as 20 mais recentes, e só mexe dentro do `--backup-dir`.
  `--backup-dir-host` diz às mensagens qual é o caminho do mesmo diretório no host (no deploy, `/var/backups/tria-n8n`).
- Falha de `PUT` em workflow que estava ativo (erro 4xx ou 5xx, conexão ou timeout): o n8n pode ter removido o gatilho,
  gravado e falhado ao registrá-lo de novo, e `POST /activate` num fluxo que já consta ativo não faz nada. Por isso o script lê
  o conteúdo vigente, compara com a cópia, restaura se mudou e, em todos os casos, executa `POST /deactivate` e depois
  `POST /activate`, confere por GET e avisa que o gatilho pode ter ficado fora do ar. Se o GET também falhar, não toca em nada
  e manda restaurar à mão a partir da cópia no host. Sai sempre com 1, sem repetir.
- Depois de `PUT` e ativação bem-sucedidos, lê o workflow e exige o estado ativo e o conteúdo esperados. Se o GET trouxer
  `versionId` e `activeVersionId`, exige que sejam iguais. Sem esses campos a mensagem diz "conteúdo conferido; versão
  publicada não verificada". Se a conferência falhar, restaura, reinicia o gatilho e sai com 1.
- Códigos de saída: `0` ok; `1` erro definitivo (o deploy não repete; inclui qualquer falha depois de iniciado um `PUT`);
  `2` n8n indisponível ou erro de rede antes de qualquer `PUT`, na listagem ou em GET (o deploy repete).
- A restauração automática envia só `name`, `nodes`, `connections` e `settings` filtrados por `CHAVES_DE_CONFIGURACAO`
  (`executionOrder`, `saveDataErrorExecution`, `saveDataSuccessExecution`, `saveManualExecutions`, `saveExecutionProgress`,
  `executionTimeout`, `errorWorkflow`, `timezone`, `callerPolicy`). Chaves de `settings` fora dessa lista são perdidas
  na aplicação e na restauração.

## Recuperação manual a partir da cópia

Quando a saída disser "restaurar à mão a partir de /var/backups/tria-n8n/<id>-<timestamp>.json":

1. Na VM, o arquivo é do root, modo 0600. Abra o túnel (`scripts/tunel.sh n8n`) e leia o arquivo só no terminal do humano.
2. `PUT /api/v1/workflows/<id>` com corpo JSON contendo `name`, `nodes`, `connections` e `settings` do arquivo, mantendo em
   `settings` somente as chaves de `CHAVES_DE_CONFIGURACAO`. Não envie `active`, `id`, `versionId` nem `tags`.
3. Se `active` era `true` na cópia: `POST /api/v1/workflows/<id>/deactivate` e depois `POST /api/v1/workflows/<id>/activate`.
4. `GET /api/v1/workflows/<id>`: confira `active`, o conteúdo dos nós e, se vierem, `versionId` igual a `activeVersionId`.
5. Registre o ocorrido e não repita o deploy antes de entender a causa.

Não há `--restaurar`: o ciclo é curto, mas errar o alvo é grave, e a restauração a mão obriga o humano a olhar o id e o nome.

## Como preencher o manifesto (feito pelo humano)

1. `scripts/tunel.sh n8n`.
2. `N8N_API_URL=http://localhost:15678 N8N_API_KEY=… node scripts/n8n-aplicar-clientes.mjs n8n/workflows --propor-manifesto`.
   Somente leitura: lista `arquivo → id nome` por nome exato, sem imprimir conteúdo de fluxo e sem gravar nada.
   Candidato com tag `platform` ou nome `ORLA ·…` nunca é proposto; nome repetido aparece como ambíguo.
3. Revise os pares, escreva-os no manifesto e abra o PR (toca fora de `src/`, `app/` e afins: é do humano, ADR 0048).

## Pré-condição antes de o deploy aplicar em produção

A simulação não grava, então rodá-la duas vezes não prova nada. O procedimento é:

1. Simular: `node scripts/n8n-aplicar-clientes.mjs n8n/workflows` pelo túnel. Anotar quais arquivos dizem `atualizaria`.
2. Aplicar com o humano, pelo túnel, com `--aplicar --backup-dir <dir local>`, guardando a saída e as cópias.
3. Simular de novo: todos os 6 arquivos têm de dizer `igual`.
4. Arquivo que não chegar a `igual` (por exemplo porque o n8n remove parâmetros com valor padrão, ADR 0009) é reexportado do
   n8n no formato normalizado e commitado antes de o deploy aplicar. Sem isso, a conferência pós-aplicação do script pode
   falhar e restaurar a cada deploy.

## Deploy

- Imagem do passo: variável do repositório `N8N_CLIENTES_IMAGEM`. Aceita `node[:tag]@sha256:<64 hex>` ou
  `docker.io/library/node[:tag]@sha256:<64 hex>`, como valor inteiro. Vazia, de outro registro, sem digest, com quebra de
  linha, espaço, `;`, `$(` ou crase, o passo falha com mensagem clara.
- O passo manda o script por stdin para a VM e o executa sob `sudo flock -w 300 /run/lock/tria-n8n-clientes.lock`. A trava
  que dura o mesmo que o contêiner é o nome fixo `orla-n8n-clientes`: se já existir, o passo falha com exit 1 e mensagem clara.
- O contêiner roda destacado, com `--cap-drop=ALL`, `--security-opt no-new-privileges`, `--read-only`, `--tmpfs /tmp`,
  `--pids-limit 64` e `--memory 256m`; sem `--cap-add`. Se `/w` não for legível, a correção é `chmod -R a+rX` na VM,
  nunca capability. Só escreve em `/tmp` e em `/backup` (montagem de `/var/backups/tria-n8n`).
- A saída do script vai também para `/var/backups/tria-n8n/aplicacao-<timestamp>.log` (modo 0600) com a linha
  `desfecho: codigo N`, escrita por um observador independente do runner: se o timeout de 8 minutos do passo matar o runner,
  o contêiner segue sozinho e o log registra o desfecho.
- A `N8N_API_KEY` vai ao contêiner por `--env-file` temporário 0600 na VM, removido em EXIT/HUP/INT/TERM/PIPE, nunca na
  linha de comando.
- O passo tem `timeout-minutes: 8` (estoura como falha, não como cancelado). O smoke pós-deploy roda mesmo se esse passo
  falhar (o job continua falhando).
- `saveManualExecutions: false` está em todos os fluxos de `clientes/` e `agencia/`; um teste percorre a listagem de fluxos.
