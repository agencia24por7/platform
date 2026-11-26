---
status: accepted
date: 2026-11-25
---
# ADR-0064: Chave de fornecedor de IA em tabela própria com a cifra do cofre, modelo por tarefa e teto diário

Numeração anterior: 0058. Os comentários das migrações 0142 a 0144 e as mensagens de commit anteriores a 2026-11-26 citam o número antigo; o conteúdo do ADR não mudou, só o número e o nome do arquivo.

Complementa os ADRs 0032, 0042 e 0063. Corrige o caminho previsto no ADR 0063 §11. Não supera nenhum. Issue 24K-131. Aceito em 2026-11-25 pelo dono do produto.

## Contexto

O ADR 0063 §11 previa guardar a chave do fornecedor de IA como mais uma plataforma de conexão. A leitura do código mostrou que isso é errado:

- `Platform` é a lista de fontes de dados do produto. Uma chave de IA ali entraria no mapa de fontes de coleta, na descoberta de contas, nas telas de conexão do cliente e no catálogo do Brain, como "conexão" do cliente. Exigiria mudar o enum `integrations.platform` fora de transação e excluir a IA, um a um, de cada fluxo que lista conexões.
- O cofre tem rotação operada no fim por uma pessoa (ADR 0042): a varredura semanal recifra, e só com `avaliadas = 0` e `falhas = 0` a versão antiga da chave do KMS é desativada. Segredo selado fora dessa varredura fica ilegível no dia em que a versão antiga sai.

Conferido no código: hoje só o worker decifra segredo (`acessoDoWorker` é o único chamador de `obterAcesso`); o app só sela.

## Decisão

### 1. Tabela própria, mesma cifra

A chave fica em `core.ai_provider_keys`, uma linha por organização e fornecedor. O valor é selado com o mesmo envelope e a mesma chave mestra do cofre de tokens (`createSeladorDeEnvelope(escolherChaveMestra(config))`, extraído de `createCifraEnvelope` sem mudar o comportamento do cofre). Não há criptografia nova.

O contexto de cifra é `orla.ia.chave.v1|<organização>|<fornecedor>`: um selado copiado para outra organização ou outro fornecedor não abre.

RLS igual à do cofre: organização do contexto e sem recorte de clientes. Só `admin` ou superior guarda, troca ou remove chave. Guardada, a chave nunca mais é exibida; a tela mostra só os quatro últimos caracteres.

### 2. Uma varredura só para a rotação

`POST /api/v0/tokens/recifrar` passa a cobrir as duas tabelas. O serviço do worker recebe recifradores extras e soma as contagens no mesmo resumo e no mesmo evento de auditoria `tokens.recifragem`. O workflow do n8n e o procedimento do ADR 0042 não mudam: **`avaliadas = 0` e `falhas = 0` continuam sendo a única condição para desativar uma versão antiga da chave do KMS**, agora valendo também para as chaves de IA.

- `core.ia_chaves_com_versao_antiga(versão, limite)` (`SECURITY DEFINER`, só `orla_worker`) devolve ponteiros, nunca o selado.
- A recifragem abre e sela de novo dentro do tenant e só grava se a versão e o próprio selado lidos ainda forem os mesmos: uma troca de chave feita durante a varredura nunca é sobrescrita pela chave antiga.
- Recifrador extra que quebra conta como falha, para que `avaliadas = 0` nunca esconda segredo pendente.
- Sem a chave primária disponível os extras não rodam.

### 3. Onde a chave é aberta

Só dentro do executor (`src/modules/ia/application/execucao.ts`), depois da reserva de uso e imediatamente antes da chamada ao modelo, e na ação "Atualizar lista de modelos". O resolvedor devolve fornecedor, modelo e uma função `abrirChave`; nenhum módulo consumidor recebe a chave.

Isso faz o processo do app decifrar segredo, o que antes só o worker fazia. É aceito porque a tarefa de IA nasce de uma ação de tela, o app já tinha `SELECT` no selado do cofre sob a mesma RLS e a mesma identidade no KMS, e a abertura fica confinada a um ponto.

### 4. Testar a chave e listar modelos

Guardar a chave chama o endpoint de lista de modelos do fornecedor, com destino fixo em `https`, sem seguir redirecionamento, com a chave em cabeçalho. A lista filtrada (só modelos de texto, id dentro do padrão) fica gravada com a chave; a página não decifra nada para se desenhar.

Guardar chave tem limite de 10 tentativas a cada 10 minutos por organização, para a plataforma não servir de verificador de chaves alheias. Chave de fornecedor que saiu da lista habilitada continua removível.

Chave recusada é 400, 401 ou 403 (o Google responde 400). Qualquer outra falha é "fornecedor fora". A mensagem nunca traz a chave nem o corpo da resposta.

### 5. Modelo por tarefa

`core.ai_task_models` guarda fornecedor e modelo por organização e tarefa. Só aceita tarefa registrada, fornecedor com chave e modelo da lista que a chave alcança. Remover a chave apaga as escolhas que dependiam dela (chave estrangeira com `ON DELETE CASCADE`): a tarefa volta a ficar bloqueada. Modelo que sai da lista marca a tarefa como "modelo indisponível" na tela; a plataforma não troca sozinha.

A primeira tarefa registrada é `teste_de_modelo`, usada pelo botão "Testar modelo".

### 6. Uso, teto e botão de desligar

- `core.ai_usage` tem uma linha por chamada, só com contagens. A linha nasce como **reserva antes da chamada** e recebe o desfecho depois.
- A reserva roda numa transação sob trava por organização: confere o botão de desligar, conta as chamadas do dia e soma os tokens (os consumidos, mais os reservados das chamadas em andamento, mais a reserva nova). Chamadas simultâneas não passam do teto.
- A reserva de tokens é `passos × tokens de saída` do orçamento da tarefa. Chamada que termina bem conta os tokens reais; chamada que falha conta o maior entre a reserva e o que foi medido, porque o fornecedor cobra tentativas que não devolvem resultado utilizável.
- O dia é o de `America/Sao_Paulo`. O app não escolhe `occurred_at`, não cria linha já concluída, não muda a reserva e não apaga uso. Um gatilho no banco só deixa a linha mudar uma vez, de reservada para o desfecho: ninguém zera tokens nem reabre reserva.
- `core.ai_settings`: ligada por padrão, 200 chamadas e 2 milhões de tokens por dia. `admin` ou superior liga e desliga; só `owner` muda os tetos. Cada gravação toca só as próprias colunas, então salvar tetos nunca religa a IA e desligar nunca apaga os tetos.
- Desligada ou no teto, a tarefa é recusada antes de abrir a chave.

### 7. Fornecedores ligados

Padrão: `anthropic`, `google`, `openai`. `xai` e `moonshot` têm adaptador e catálogo prontos e só entram quando listados em `IA_FORNECEDORES_HABILITADOS`; o Moonshot depende também do aceite legal (ADR 0063 §3).

### 8. Costura de teste

No molde de `provedorDeTeste.ts` do cofre: fora de produção, sem `TOKENS_KMS_KEY` e com endereço local, uma chave com o prefixo `orla-teste:` é atendida por um catálogo e um modelo falsos. Em produção, com KMS ou com endereço público, as funções devolvem o catálogo e a fábrica reais sem embrulho. É o que deixa a integração provar a tela, o executor, o uso e a recifragem sem chamar fornecedor.

## Fora desta entrega

Fila de execução longa (não há consumidor) e tabela de sugestão de modelo por classe (a tela mostra só a classe da tarefa).

## Alternativas consideradas

- **Fornecedor como plataforma de conexão.** Rejeitada pelos motivos do contexto.
- **Chave da plataforma em variável de ambiente.** Rejeitada: contraria "a organização usa a própria chave" e mistura o custo das organizações.
- **Varredura e rota próprias para as chaves de IA.** Rejeitada: dois números para conferir antes de desativar uma versão do KMS é um convite a esquecer um.
- **Abrir a chave só no worker.** Rejeitada na v1: obrigaria a pôr toda tarefa de IA numa fila que ainda não tem consumidor.

## Consequências

- Todo segredo novo selado com a chave mestra precisa entrar como recifrador extra na mesma rota, com teste.
- `core.ai_usage` cresce uma linha por chamada e ainda não tem retenção; definir quando houver volume.
- O teste de fronteira de fornecedor continua valendo: nenhum módulo fora de `src/modules/ia/infrastructure` importa SDK de modelo.

## Não verificado

- Lista de modelos e código de erro de chave inválida de Anthropic, OpenAI, xAI e Moonshot com chave real. Só o Google foi provado, antes desta entrega e fora do catálogo novo.
- A recifragem das chaves de IA com o KMS real; foi provada com a chave mestra local.
- **Antes da primeira desativação de versão do KMS:** `core.ia_chaves_com_versao_antiga` e `integrations.tokens_com_chave_antiga` (ADR 0042) leem tabelas com `FORCE ROW LEVEL SECURITY`. Se o dono das funções em produção não for superusuário nem tiver `BYPASSRLS`, elas devolvem zero linhas sem erro e `avaliadas = 0` deixa de significar "nada pendente". Só foi provado com o superusuário do contêiner local. Conferir `rolsuper` e `rolbypassrls` do dono em produção é pré-condição da desativação.
  - Evidência do repositório, não do banco de produção: o deploy roda `/opt/tria/migrar.sh` com `PG_USER` padrão `postgres` (`.github/workflows/deploy.yml`, `infra/compose/migrar.sh`), o superusuário de bootstrap do contêiner (`POSTGRES_SUPERUSER` em `infra/docker-compose.yml`). Se for isso, as funções pertencem a um superusuário e ignoram a RLS.
  - Prova que falta, só leitura, para o humano rodar no banco de produção: `SELECT p.proname, r.rolname, r.rolsuper, r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname IN ('ia_chaves_com_versao_antiga', 'tokens_com_chave_antiga');`. Cada linha precisa de `rolsuper` ou `rolbypassrls` verdadeiro.
- O comportamento da tela com centenas de modelos na lista.
