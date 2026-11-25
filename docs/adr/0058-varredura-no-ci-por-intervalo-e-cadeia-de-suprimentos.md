---
status: accepted
date: 2026-11-24
---
# ADR-0058: Varredura no CI por intervalo, allowlist amarrada ao conteúdo e cadeia de suprimentos

Complementa o ADR 0039 (hooks do git e varredura) e o ADR 0028 §3 (imagens por digest). Linear 24K-126 e 24K-128.

## Contexto

Uma revisão de segurança achou lacunas em `scripts/seguranca-verificar.mjs` e na cadeia de suprimentos:

1. O CI rodava só `--arvore`, que pulava as regras de migração (destrutiva fora de `db/corte-gate.txt`, migração existente alterada). Quem commitava com `--no-verify` ou pela interface web levava um `DROP` fora do portão até `main`.
2. Arquivo com mais de 200 KB era pulado em silêncio.
3. Faltavam formatos de segredo comuns.
4. A allowlist casava por arquivo e regra: um `0.0.0.0/0` novo em `network.tf` passava calado.
5. As três bases do Dockerfile usavam tag móvel, o Dependabot não tinha atraso mínimo e o `npm ci` do CI rodava scripts de instalação.

## Decisão

### Varredura por intervalo no CI (muda o ADR 0039)
A frase do ADR 0039 "o CI cobre quem pula os hooks" passa a ser verdadeira: o job `qualidade` roda, além de `--arvore`, `seguranca-verificar.mjs --range <base>..HEAD`. Em `pull_request` a base é `github.event.pull_request.base.sha` e o HEAD é o commit de merge do checkout, então o intervalo é exatamente o PR. Em `push` a base é `github.event.before`. Em evento sem base (por exemplo `workflow_dispatch`) só a árvore vale. O checkout usa `fetch-depth: 0`, com a action ainda fixada por SHA. Os valores do evento entram por `env:`, nunca interpolados em `run:`.

`--range` passa a falhar fechado: revisão inexistente encerra com código 2 (antes o `git` mudo devolvia diff vazio e a verificação passava sem verificar). Base só de zeros (ramo novo) vira a árvore vazia. Push forçado em `dev` faz o `before` sumir do histórico e o job falha com a mensagem de revisão não encontrada, o que é intencional: o humano reexecuta depois de conferir.

### Arquivo grande e binário
`--arvore` lê cada arquivo por blocos de 1 MiB e analisa linha a linha, sem limite de tamanho. Binário é o arquivo cujo primeiro bloco tem byte nulo nos primeiros 8000 bytes; esse é pulado.

Custo limitado e cobertura de fronteira, em todos os modos (`--arvore`, `--staged`, `--range`, `--push`), com a invariante verificada por teste:
- Os padrões e as constantes ficam em `scripts/seguranca-padroes.mjs`. Toda linha é analisada em fatias de 8000 caracteres com 2048 de sobreposição. Cada padrão declara o comprimento máximo do casamento (`maximo`), e o teste exige `maximo + 512 <= sobreposição` para todos: o maior declarado é 1060 (SQL e shell interpolados, com o trecho entre crases limitado a 1000), seguido de 780 (atribuição entre aspas). Assim, qualquer casamento que atravesse uma fronteira aparece inteiro na fatia seguinte. O achado repetido pela sobreposição é deduplicado por arquivo, linha e regra. Linha com mais de 1 MB na leitura é cortada com a mesma sobreposição.
- Todo padrão aplicado tem quantificador limitado. O teste remove escapes e classes de caracteres do `source` de cada regex e falha se sobrar `*`, `+` ou `{n,}`. O custo do retrocesso fica proporcional ao limite, não ao tamanho da linha.
- Os padrões de segredo que o `politicas.mjs` define sem limite não são aplicados crus: o script mantém versões limitadas em `PADROES_DE_SEGREDO`, com a regra de que a versão limitada acusa tudo que a original acusa em linha realista e, quando o valor passa do teto, casa o prefixo em vez de desistir. Nome de até 120 caracteres depois da palavra sensível e até 64 espaços de cada lado do `:` ou `=` (o `terraform fmt` e o YAML alinhado usam dezenas de espaços); valor de 24 a 512 caracteres seguido da aspa de fechamento ou, se o teto foi atingido, de qualquer caractere do valor. Isso é feito com um lookahead que captura o valor e o repete por referência (`(?=(?<valor>...))\k<valor>`), que não admite retrocesso; um `{24,512}` comum seguido de alternativa também aceitaria valor curto sem aspa de fechamento. Os tokens de prefixo conhecido não terminam em `\b` (a original exigia fronteira de palavra, o que um teto de 512 faria perder tokens maiores). O `politicas.mjs` segue intacto e continua sendo o que o hook de ferramentas do Claude Code usa. Os mesmos princípios valem para os padrões próprios com teto no valor: o em português, o sem aspas (teto 256, casa o prefixo; só recusa valor seguido de ponto, que é referência) e o hexadecimal (teto 256, sem `\b`).
- Teste de paridade: lê o `politicas.mjs` e falha se aparecer tipo de segredo novo lá sem versão no script. Para a atribuição, mais de 9 mil combinações montadas em tempo de execução (9 nomes, de `token` a um nome de 100 caracteres; 1 a 60 espaços antes e 0 a 60 depois do separador; `:` e `=`; aspa no nome ou não; valor de 24, 25, 100, 512, 513 e 5000 caracteres; com e sem aspa de fechamento; começando na posição 0 e em 7900 da linha) em que tudo que a original acusa o script também acusa. Para os tokens de prefixo conhecido, comprimentos de 30 a 5000 e vários sufixos. Os exemplares do revisor (Terraform alinhado, YAML alinhado, nome longo, valor de 700) têm teste pelo script inteiro. Trocar a versão limitada pela versão estreita anterior faz o teste de paridade falhar.
- Teste da invariante: para cada um dos 32 padrões, um exemplar do tamanho máximo é deslizado por todas as posições ao redor das duas primeiras fronteiras de fatia (antes, atravessando, depois) e precisa ser detectado em todas; padrão ancorado no início da linha (`^`) é testado só na posição 0. Outro teste confere que o `maximo` declarado é o casamento real do exemplar (folga de no máximo 15). Trocar a sobreposição para 1024 faz dois desses testes falharem. Os casos do revisor (JWT de payload 1200 e SQL interpolado atravessando a fronteira) têm teste pelo script inteiro.
- Teste de desempenho por razão de crescimento: dobrar a entrada adversarial não pode triplicar o tempo (padrão de `redactTerceiraRodada.test.ts`).
- O JWT agora exige cabeçalho e o início do payload (`eyJ...` ponto `eyJ...`, até 100 caracteres cada), não os três segmentos: exigir o payload inteiro (até 1500 caracteres) e a assinatura estourava a sobreposição. O custo é aceitar como JWT um par `eyJ.eyJ` sem assinatura.
- Limites que ficam como residual: nome sensível com mais de 120 caracteres de sufixo ou mais de 64 espaços em volta do separador, valor de URL com credencial acima do limite de 100 caracteres, e padrão com `^` só vale no começo da linha, como antes.

Medida (caixa-preta, `--staged`, 26 unidades adversariais como `token`, `token=`, `senha="`, `eyJa.`, `ab://c:`, espaços, `curl ` e `.unsafe(\``, cada uma em dois arquivos): a primeira versão levava 61 s com 200 mil caracteres por unidade (por padrão numa linha de 200 mil caracteres: ~2,8 s para valor sem aspas e hexadecimal, ~6,7 s para atribuição em português). A versão atual leva 0,3 s com 100 mil, 0,5 s com 200 mil, 1,5 a 1,7 s com 400 mil e 3,1 a 3,5 s com 1 MB por unidade; a medida por unidade com 200, 400 e 800 mil caracteres cresce de forma linear (a pior, `token=`, vai de 0,35 a 0,83 s). A máquina estava compartilhada, então os números têm ruído.

Binário e byte nulo (terceira e quarta revisões):
- A extensão binária conhecida (imagem, fonte, compactado, executável, mídia, banco) só autoriza pular o arquivo se ele for binário de fato, isto é, se tiver byte nulo nos primeiros 8000 bytes (o critério do próprio git). Texto com extensão `.png` ou `.zip` é varrido como qualquer outro. Na árvore o script lê os 8000 primeiros bytes; nos diffs usa `git diff --numstat -z`, que marca binário com `-`, sem carregar blobs.
- Arquivo sem extensão binária conhecida e com byte nulo gera um único achado `byte-nulo-em-arquivo-de-texto` por arquivo (linha 0, assinatura `-`) e o resto dele não é varrido: ele reprova por esse achado, o que basta para barrar. Binário de 30 MB com extensão desconhecida: um achado, 49 MB de memória na árvore e 41 MB no `--staged`, em 0,4 e 0,6 s. Na árvore o arquivo é lido por blocos e a leitura para no primeiro byte nulo; no diff o binário aparece no `--numstat` e vira o achado sem ler o conteúdo. Arquivo de texto do git com byte nulo só depois do oitavo KB passa pelo diff normal e também gera o achado.
- A exceção na allowlist é uma entrada por arquivo, no formato comum: `caminho::byte-nulo-em-arquivo-de-texto::-::1` (a assinatura `-` é a do achado de arquivo inteiro; o cabeçalho do arquivo cita só `arquivo-sensivel` e `migracao-*` como exemplos, e a regra vale igualmente para este id).
- A lista de nomes alterados (`--name-status`) nunca é filtrada por extensão: `.env.gz`, `d/.env.db` e `.env.production.zip` disparam `arquivo-sensivel` em todos os modos.

Falha de leitura do git passa a encerrar com código 2. Antes, o `git` mudo devolvia texto vazio quando o diff passava do `maxBuffer` (50 MB), e a varredura passava sem varrer; o limite agora é 400 MB e o estouro falha fechado.

### Formatos novos (todos em `seguranca-verificar.mjs`, não no `politicas.mjs`, que também alimenta os hooks do Claude Code)
- URL com credencial embutida `esquema://usuario:senha@host`, ignorando senha de exemplo (`password`, `senha`, `changeme`, `${...}`, `<...>`, asteriscos), senha igual ao usuário e host local (`localhost`, `127.0.0.1`, `::1`).
- Atribuição sem aspas em `.sh`, `.yml`, `.yaml`, `.tf`, `.tfvars` e `.env*` para nome sensível, com valor de 20+ caracteres que misture letra e dígito (referência com ponto, `$(...)` e `${...}` não casam).
- Nomes em português (`senha`, `segredo`, `chave`) e `ENCRYPTION_KEY` entre aspas, 24+ caracteres, com letra e dígito (UUID e nome de campo não casam).
- JWT (cabeçalho `eyJ` e início do payload `eyJ`, base64url), webhook do Slack (`hooks.slack.com/services/` seguido do caminho) e hexadecimal de 32+ caracteres junto de nome sensível, inclusive o par `"name"` sensível e `"value"` hexadecimal em até 3 linhas no JSON de credencial exportada do n8n.
- Os tipos heurísticos (atribuições e hexadecimal) seguem isentos em arquivo de teste, como já era a atribuição com aspas; JWT, webhook e URL valem também nos testes, e as fixtures de teste entram na allowlist.

### Allowlist amarrada ao conteúdo
A linha passa de `caminho::id` para `caminho::id::assinatura::contagem`. A assinatura são os 12 primeiros caracteres do sha256 da linha do achado (aparada, espaços internos reduzidos a um); achado de arquivo inteiro usa `-`. A contagem é quantas linhas do arquivo têm aquele achado com aquela assinatura. Efeito:
- linha trocada ou editada muda a assinatura e deixa de valer;
- linha igual a mais muda a contagem: na árvore (CI) a divergência, para mais ou para menos, vira o achado `allowlist-divergente`, que não pode ser coberto por allowlist; entrada de código que saiu precisa ser removida;
- nos modos de diff (`--staged`, `--range`, `--push`) só a assinatura é conferida (o diff não vê o arquivo inteiro); a contagem é conferida no CI pela árvore;
- entrada no formato antigo encerra com código 2.
`--arvore --sugerir` imprime as entradas dos achados atuais, sem valor de segredo. Escolhi hash mais contagem em vez de só contagem porque contagem sozinha deixa trocar uma linha por outra.

### Cadeia de suprimentos
- Dockerfile (muda o ADR 0028 §3): as três bases `node:22-alpine` ficam fixadas por digest do índice multi-arquitetura, `sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a`, lido em 2026-11-24 com `docker buildx imagetools inspect node:22-alpine`. A tag fica por legibilidade. O Dependabot `docker` atualiza o digest fixado.
- `.github/dependabot.yml`: `cooldown` com `default-days: 7` nos três ecossistemas e `semver-major-days: 14` no npm. O cooldown não atrasa atualização de segurança: o Dependabot a ignora ao abrir PR de vulnerabilidade conhecida.
- `npm ci --ignore-scripts` no `ci.yml` (o Dockerfile já tinha). Única dependência do `package-lock.json` com script de instalação: `protobufjs` (verificação opcional da CLI, sem efeito no uso como biblioteca). O `deploy.yml` não roda `npm ci`.
- `.npmrc` com `min-release-age` não foi criado: o npm do Node 22 é o 10.x, que não tem a opção (existe `before`, que é data absoluta e não serve como idade mínima móvel). Reavaliar quando o Node LTS trouxer npm 11.10 ou superior.

## Alternativas descartadas
- Escanear o histórico inteiro no CI: segue descartado pelo ADR 0039; o intervalo cobre só o que o PR ou o push traz.
- Só contagem na allowlist: deixa trocar uma linha por outra.
- Variável de ambiente para apontar outro arquivo de allowlist: viraria rota de contorno.
- Pôr os padrões novos em `politicas.mjs`: ele também decide o que o agente pode escrever, e os formatos heurísticos produziriam falso positivo no trabalho diário.

## Consequências
- O CI fica um pouco mais lento (histórico completo no checkout e uma segunda passada).
- O histórico completo no checkout não muda permissões: o job segue com `contents: read`.
- Falso positivo dos formatos novos: corrigir o código ou gerar a entrada com `--sugerir` e justificar no PR.
- Risco residual: segredo em formato não coberto, valor curto, ou truncado por quebra de linha dentro do valor continua fora; o hexadecimal em JSON só casa com `"value"` hexadecimal de 32+; quem tem `--no-verify` e escreve a própria allowlist ainda depende da revisão do PR.
