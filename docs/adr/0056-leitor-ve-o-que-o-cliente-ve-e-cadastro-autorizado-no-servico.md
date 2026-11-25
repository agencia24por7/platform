---
status: accepted
date: 2026-11-24
---
# ADR-0056: O leitor vê o que o cliente vê, e o cadastro de cliente é autorizado no serviço

Fecha dois achados da revisão de segurança: 24K-118 (o papel leitor recebia conteúdo interno da equipe) e 24K-119 (a regra de quem cadastra cliente só existia na tela). Não contradiz os ADRs 0026, 0036, 0050 e 0051; complementa-os nos pontos citados abaixo.

## Contexto

- O vocabulário da agência descreve o leitor (`viewer`) como "o papel certo para o próprio cliente acompanhar os dados da conta". Mas `contextoService.carregar` devolvia o contexto inteiro a qualquer papel com o cliente no escopo: notas internas (`notas_internas_*`, "Só a equipe vê"), hipóteses, sugestões da IA ainda não confirmadas e valores que a equipe não marcou como compartilháveis. O mesmo valia para o histórico de revisões (com o valor antigo e o novo), para o Brain da tela e para a prontidão do cabeçalho.
- O link público já tinha o critério certo (ADR 0026): o cliente vê só campos com `visivelAoCliente` no catálogo e só valores visíveis (`core.contexto_visivel_ao_cliente` no SQL, `ehVisivelAoCliente` no domínio).
- `podeCadastrarCliente` (anunciante: owner ou admin; agência: quem opera) era conferida em `/clientes/novo`, mas não em `clientService.create`. A seleção de contas do onboarding (`/comecar/contas`) só checava `canOperate` e, se a criação falhasse, vinculava as contas ao primeiro cliente da lista.

## Decisão

### 1. Leitura do contexto por papel, no serviço

- `ContextoService.carregar` e `listarRevisoes` recebem `papelDeQuemLe: MemberRole` como campo obrigatório do tipo (`Leitura`). Nenhum chamador compila sem dizer quem lê.
- `visaoDoPapel(papel)` (`domain/contexto/visaoDoCliente.ts`) decide a visão: quem opera (`canOperate`) recebe a visão `equipe`; o leitor recebe a visão `cliente`.
- A visão `cliente` usa exatamente o critério do link público, num lugar só do domínio:
  - campos e itens de lista: seção do catálogo, chave em `chavesLegiveisPeloCliente` (as mesmas chaves que o link manda a `core.contexto_link_ler`) e `ehVisivelAoCliente` (espelho de `core.contexto_visivel_ao_cliente`);
  - arquivos: `compartilhavel` e chave legível, como em `core.contexto_link_ler`;
  - catálogo: `catalogoParaCliente`, sem os campos `visivelAoCliente = false`.
  O link público passa a usar as mesmas funções de chave (`chavesLegiveisPeloCliente`, `chavesVisiveisAoCliente`), que saíram do serviço para o domínio.
- Indicadores derivados saem do recorte: completude, próximos campos e uso de arquivos são calculados sobre o que o leitor recebe. Sugestão pendente não aparece como "sugestão pendente" nem conta; arquivo não compartilhável não soma no uso.
- Histórico: o leitor só recebe uma revisão quando a chave é legível pelo cliente e **todos** os estados que ela carrega (antes e depois) eram visíveis ao cliente naquele momento, pelas marcas gravadas no próprio retrato (`shareable`, `source`, `review`, `epistemic`). Retrato sem marcas reconhecíveis conta como não visível. Assim a revisão que trocou uma hipótese pelo valor do cliente, ou que tirou o compartilhamento, não vaza o valor interno. Isto refina o ADR 0026 ("Revisões não são expostas"), que continua valendo para o link público: o cliente pelo link segue sem histórico.
- O cabeçalho "Do cadastro" do ADR 0050 grava a entrada herdada com `compartilhavel` falso; por consequência o leitor não recebe `nome_empresa` e `segmento` herdados, como o link público.

### 2. Brain e prontidão da tela

- `CarregadorDeContexto.carregar` (módulo brain) recebe a visão (`equipe` ou `cliente`). O serviço de contexto expõe `carregarNaVisao(escopo, visao)` para esse adaptador.
- `BrainService.montarNaOrganizacao(organizationId, clienteId, papelDeQuemLe)` exige o papel e pede a visão do cliente para o leitor. A tela do Brain e a prontidão (`carregarProntidao`, usada no cabeçalho, em Fontes e na lista de clientes) passam o papel da sessão.
- O catálogo para agentes (`montar`, rotas `/api/v0/brain/*` do worker) e a publicação no bucket continuam na visão `equipe`: são o consumo interno previsto no ADR 0026 e não chegam a membro leitor.

### 3. Cadastro de cliente autorizado no serviço

- `clientService.create` recebe `tipoDaOrganizacao` e `papelDeQuemAge` na entrada (`NovoCliente`) e devolve `forbidden` quando `podeCadastrarCliente` nega, antes de qualquer leitura, gravação ou auditoria. A mensagem usa `vocabularioDe(tipo)`. As telas continuam checando para dar a mensagem cedo; a garantia é do serviço. Isto torna exato o que o ADR 0036 ("Quem cadastra negócio ... vale no servidor") já pedia.
- `/comecar/contas` (`linkSelected`) passa a exigir `podeCadastrarCliente`, porque sempre cria um cliente. Sem o fallback para `list()[0]`: se a criação falha, volta com erro e nenhuma conta é vinculada nem ignorada. A ordem é criar, vincular as escolhidas e só depois marcar as demais como ignoradas, e só se todas as escolhidas foram vinculadas; com qualquer falha de vínculo volta com erro e as não escolhidas continuam pendentes. Não há transação entre os módulos de clientes e conexões; a ordem garante que uma falha nunca deixa conta marcada como ignorada.
- **Retomada depois de falha parcial.** Criar o cliente e vincular contas não cabem numa transação só (serviços e repositórios distintos, cada um com o próprio `withTenant`). Por isso, quando parte das contas falha, a tela volta com uma retomada assinada (`domain/retomadaDoCadastro.ts`): HMAC-SHA256 com chave derivada de `TRIA_SESSION_SECRET` para a finalidade `orla.retomada-do-cadastro:v1`, sobre organização, pessoa, id do cliente criado e prazo de 1 hora. A nova tentativa leva a retomada num campo oculto e vincula as contas que faltam ao mesmo cliente, sem criar outro. O servidor nunca confia no id: confere a assinatura e o prazo, exige que organização e pessoa sejam as da sessão, revalida o cliente com `clienteNoEscopo` (organização da sessão, recorte, não excluído) e exige `podeCadastrarCliente` e organização inteira antes de ler a retomada. Um id cru, uma retomada de outra pessoa, de outra organização ou vencida é recusada sem vincular nada. Só uma retomada emitida por este fluxo, logo depois de criar o cliente, aponta para um cliente; o fallback para `list()[0]` não volta. Vencida a hora, as contas que faltam se vinculam pela página do cliente.

## Caminhos de leitura do leitor conferidos

| Caminho | Tratamento |
| --- | --- |
| Perfil (`contexto/Perfil.tsx`, editor) | visão `cliente` no serviço; o editor usa `catalogoDaVisao` |
| `recarregarContextoAcao`, `compartilharSecaoAcao` | `carregar` com o papel da sessão |
| `listarRevisoesAcao` e "Atividade recente" | `listarRevisoes` com o papel; filtro por retrato |
| Brain (`contexto?secao=brain`) | `montarNaOrganizacao` com o papel |
| Prontidão (cabeçalho, Fontes, lista de clientes) | snapshot do Brain com o papel |
| Cabeçalho (uso de arquivos, estado do Brain) | `carregarContexto` com o papel; estado do Brain não tem conteúdo |
| Regras (`regras`, página e ações) | sem mudança: o ADR 0051 define que o leitor lê regras, e regras não têm marca de conteúdo interno |
| Pedir ao cliente (links) | metadados do link (seções, nota ao cliente, datas); a nota é escrita para o cliente |
| Auditoria (`/auditoria`) | metadados de contexto só levam seção, chave e marcas, nunca o valor |
| Rotas antigas (`dados`, `acessos`, `brain`, `configuracoes`) | só redirecionam |
| Download de arquivo | não existe rota de leitura de arquivo no app |

## Consequências

- O texto do leitor no vocabulário da agência passa a ser verdadeiro.
- O leitor de anunciante (colega ou consultor) passa a ver o mesmo que um convidado pelo link; o que está marcado "só você vê" fica com quem opera.
- Risco aceito: a auditoria mostra ao leitor com a organização inteira que um campo interno foi salvo (chave e marcas, sem valor). Esconder isso pede filtrar a auditoria por papel, fora desta entrega.
- Risco aceito: a revisão de um estado que era visível continua visível ao leitor mesmo que o valor atual tenha deixado de ser; o cliente viu esse valor quando ele estava compartilhado.
- O operador em anunciante deixa de concluir a seleção de contas do onboarding; precisa de admin, como para cadastrar negócio.

## Critérios de aceite

1. Leitor não recebe nota interna, hipótese, sugestão nem valor não compartilhável no Perfil, no Brain nem na prontidão; quem opera recebe tudo (`contextoDoLeitor.test.ts`, `tests/pagina-do-cliente.test.mjs`).
2. Leitor não recebe revisão com estado interno (`contextoDoLeitor.test.ts`).
3. `clientService.create` recusa operador em anunciante e aceita admin; agência aceita operador (`clientService.test.ts`).
4. `/comecar/contas` recusa operador de anunciante e, com falha de criação, não vincula nem ignora conta (`tests/anunciante-direto.test.mjs`).
5. Depois de falha parcial, a nova tentativa vincula o resto ao mesmo cliente sem criar outro; retomada forjada, de outra organização, de outra pessoa ou vencida é recusada (`retomadaDoCadastro.test.ts`, `tests/anunciante-direto.test.mjs`).
