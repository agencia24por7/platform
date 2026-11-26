# 0055 — Limitador de taxa isolado por domínio

- Status: aceito
- Data: 2026-11-24
- Issue: 24K-117 (achado da revisão de segurança 24K-115)
- Relacionado: ADR 0026 (limite em memória por réplica), 0049 (auditoria fora do limitador), 0033 (vagas por réplica)

## Contexto

`src/shared/security/rateLimit.ts` guardava um único mapa por processo, com teto de 10.000 chaves. Ao lotar, o limitador recusava toda chave nova, de qualquer rota. A rota `app/api/webhooks/zapi/[token]` consumia `webhook:zapi:<token>` com o token da URL, escolhido por quem chama, antes de saber se o token existia. Um anônimo lotava o mapa variando o token; quando o balde `worker:<fingerprint>` vencia, toda a `/api/v0/**` (o `workerRoute`), o cofre de tokens, o limite de alertas, `/api/meta/exclusao`, o webhook do WhatsApp e as páginas públicas por token passavam a responder 429. O 429 do worker não escrevia log, então a queda era silenciosa. Uma variante sem o Z-API: uns 34 IPs variando o token de `/contexto/<token>` (cada IP cria até 300 chaves de credencial por minuto antes do limite por IP barrar) lotavam o mesmo mapa.

A "Segunda passada" do ADR 0049 já tinha visto que o webhook Z-API lotava o mapa global, mas só tirou a auditoria (deduplicação de leitura e reuso da portaria) de dentro dele. O limitador em si seguiu compartilhado.

O ADR 0026 aceita que o limite seja em memória e por réplica; isso não muda.

## Decisão

1. **Um mapa e um teto por domínio.** O domínio é um tipo fechado (`DominioDeLimite`) e vai explícito em cada chamada: `consume(dominio, chave, limite, janelaMs)`, `consumeAll([{ dominio, key, limit }], janelaMs)`, `existe(dominio, chave)` (sem criar nem incrementar), `renovar(dominio, chave, janelaMs)` (abre ou estende um balde), `cobrarComRecibo(dominio, chave, limite, janelaMs)` (cobra e devolve um recibo com a série do balde, um número único por balde aberto), `devolver(recibo)` (desfaz a cobrança uma vez só e só se o balde vivo ainda for o do recibo: a devolução nunca credita a janela seguinte nem um balde recriado com a mesma chave depois de um despejo) e `forget(dominio, chave)`. Nada deriva o domínio do prefixo da chave. O domínio é escolhido por quem controla a quantidade de chaves:

   | Domínio | Quem cria a chave | Chamadores | Teto |
   |---|---|---|---|
   | `worker` | worker autenticado | `workerRoute` (fingerprint), leituras do brain | 10.000 |
   | `cofre` | worker autenticado | `acessoDoWorker` (`tokens:<tipo>:<id>`) | 10.000 |
   | `alertas` | a própria aplicação | `alertas:novos` | 100 |
   | `ip` | anônimo, mas uma chave por IP confiável | WhatsApp, Meta exclusão, convite (página e OAuth), `client.erro`; consultas de credencial desconhecida do Z-API e do contexto público, teto total do contexto público | 20.000 |
   | `webhook` | criada só depois que o banco valida o token | Z-API por token (impressão SHA-256 do token) | 10.000 |
   | `publico` | criada só depois que o banco valida a credencial | contexto, upload público e contexto do convite, por credencial (impressão SHA-256) | 10.000 |
   | `relato` | a própria aplicação | teto global de `client.erro` | 100 |
   | `validadas` | criada só depois que o banco valida a credencial | registro das credenciais já validadas (impressão SHA-256, vida de 24 h renovada a cada validação) | 50.000 |
   | `recusadas` | criada só quando o banco responde que a credencial não existe, e essa consulta já foi cobrada na cota do IP | registro negativo (impressão SHA-256, vida de 5 min) | 50.000 |

   Assim, chave criada por anônimo nunca ocupa vaga de chamador autenticado: `worker`, `cofre` e `alertas` só recebem chaves de quem tem o token do worker ou da própria aplicação.

2. **Domínio lotado despeja o balde menos recente daquele domínio**, em vez de recusar toda chave nova. O mapa é usado como fila LRU: cada consulta a um balde vivo, permitida ou barrada, o tira e o recoloca no fim (`Map` preserva a ordem de inserção; tirar e pôr é O(1)). Ao lotar, sai o primeiro da fila. Não há varredura O(n) por pedido. Quando o despejado ainda estava vivo, o limitador escreve `warn` `ratelimit.lotado` com o nome do domínio, no máximo um por minuto por domínio, sem a chave (ela pode conter token ou IP).

3. **Despejar não vira bypass barato**, por três razões:
   - quem abusa é justamente quem mais consulta o próprio balde; como a consulta barrada também o recoloca no fim, o balde do abusador é o último a sair;
   - o limite por IP fica num domínio (`ip`) que só cresce com IPs distintos, mas cada IP cria até 8 chaves nele (`convite:view`, `convite:oauth:start`, `erros`, `meta:exclusao`, `webhook:whatsapp`, `webhook:zapi:desconhecidos`, `contexto:desconhecidas`, `contexto:ip`, contadas no código em 2026-11-25). Lotar `ip` exige, portanto, cerca de 2.500 IPs distintos dentro da janela (20.000 ÷ 8), e não mais de 20.000. O efeito segue o mesmo: despejar baldes ociosos, que recomeçam a contagem e ganham folga. O ADR 0060 trata de quem controla o IP que entra nesse domínio;
   - `webhook` e `publico` só recebem chave depois que o banco valida a credencial, então credencial forjada não cria balde nem despeja o de ninguém;
   - pedido barrado não cria balde novo (`consumeAll` é tudo-ou-nada).

4. **Portão antes do banco** (`vigiarConsulta`, `src/shared/security/tentativasInvalidas.ts`). Toda decisão que protege o banco é uma cobrança atômica (`consumeAll`) feita antes do primeiro `await`, ou a recusa sem cobrança de uma credencial que está em `recusadas`. Não existe passo "consulta e conta depois", então rajada simultânea não fura nenhum teto. Na ordem:
   1. **Teto total do IP**, só onde ele cabe (contexto público, 300 por minuto).
   2. **Credencial já recusada.** Se a impressão está no registro `recusadas` (o banco disse "não existe" há menos de 5 min) e não está em `validadas`, a resposta é a de credencial desconhecida, sem cobrar nada e sem ir ao banco (detalhes no item 4a).
   3. **Credencial conhecida ou desconhecida.** O portão olha o registro `validadas` (item 1), que só o banco preenche:
      - credencial **conhecida** (o banco a validou nas últimas 24 h): cobra o balde da credencial (60/min no Z-API, 120/min no contexto). Não toca a cota de desconhecidas do IP;
      - credencial **desconhecida**: cobra a cota de consultas de credencial desconhecida do IP (600/min no Z-API, 30/min no contexto).
      Estourado o que se cobrou, 429 sem tocar o banco.
   4. **Banco**, para toda requisição que passou. Revogação vale na hora: o registro `validadas` decide só qual cota se cobra, nunca pula o banco. Só `recusadas` pula o banco, e só para credencial que o banco recusou há menos de 5 min (item 4a).
      - credencial inexistente: a cobrança na cota de desconhecidas fica (é a tentativa inválida) e a impressão entra em `recusadas`. Se ela estava em `validadas` (revogada, apagada), sai de lá e a chamada é cobrada na cota de desconhecidas;
      - credencial desconhecida que o banco validou: a cobrança na cota de desconhecidas é devolvida pelo recibo (sem efeito se a janela já virou ou se o balde foi recriado), a credencial sai de `recusadas`, entra em `validadas` e o balde dela é aberto (se lotou por concorrência, 429);
      - erro do banco: a cobrança **fica**. Falha fechada: devolver em erro deixaria provocar erro de propósito para consultar o banco sem gastar cota, e manteria um IP com a cota inteira em voo num banco degradado. Medido: 500 consultas que lançam erro levam 60 ao banco, não 500.

   **A cota de desconhecidas é o limite de tentativas inválidas, em forma atômica.** A cota só retém o que o banco recusou; o que o banco validou é devolvido. Por isso ela também é a sondagem pedida para credencial nova num IP ruidoso: enquanto a cota não lota, a credencial nova é consultada, validada e entra no registro, e daí em diante não depende mais da cota do IP.

   **Propriedades**, provadas em `tentativasInvalidas.test.ts` com concorrência real (milhares de promessas simultâneas contra uma busca que só resolve depois) e pelos scripts de corrida da revisão, adaptados à API nova:
   - credencial desconhecida: por IP e por janela, no máximo a cota de consultas recusadas pelo banco (600 no Z-API, 30 no contexto). Medido com cota 60: em 5 ondas de 5.000 simultâneas e em 4.000 escalonadas, 60 consultas ao banco no total; o teto acompanha a cota. Antes da primeira correção: 5.000 por onda; na versão anterior a esta: 32, mas com falso 429 para credencial válida;
   - IP saturado não derruba credencial conhecida. Medido: depois de 100 tokens obsoletos no mesmo IP, 0 de 50 credenciais conhecidas simultâneas barradas, e todas foram ao banco;
   - credencial válida martelada de 100 IPs: servida exatamente 60 vezes; depois de conhecida, zero consultas ao banco na rajada seguinte;
   - só o banco põe credencial em `validadas`: 5.000 forjadas não criam entrada lá nem balde por credencial;
   - `validadas` tem teto (50.000, com despejo do menos recente), e forjar não despeja entrada legítima dele, porque forjada nunca entra. Em `recusadas` a forjada entra (até 3.000 por IP no Z-API) e pode despejar a entrada de uma credencial revogada; o efeito é uma consulta e uma cobrança a mais para aquela revogada (item 4a);
   - falha do banco não devolve a cota;
   - devolução que atravessa a virada da janela não credita a janela nova. Medido: com 59 credenciais em voo na virada, 60 palpites ao banco na janela nova (antes: 119).

   **Por que não um semáforo de consultas em andamento.** A versão anterior usava um. Com toda cobrança atômica antes do banco, ele deixou de proteger qualquer teto e só criava 429 falso para mais de 16 requisições válidas simultâneas de um IP da Z-API; foi retirado. Reservar e devolver venceu pelo mesmo motivo: só uma credencial validada devolve, e a credencial conhecida não usa a cota do IP. Cache de validade do token continua descartado: `validadas` escolhe a cota e não pula o banco; o único atalho é `recusadas`, que só recusa (item 4a).

4a. **Registro negativo (`recusadas`).** Sem ele, o caso real sem atacante derrubava a descoberta de conexões novas. `revogar()` zera o `webhook_token`; nada descadastra o webhook na Z-API; a instância revogada segue postando do IP de saída que a Z-API usa para todos; e cada post era uma tentativa inválida cobrada na cota de desconhecidas do IP. Com ele, um token recusado repetido custa uma consulta e uma cobrança do IP por vida do registro; só tokens **distintos** consomem a cota.
   - **Vida de 5 minutos.** Curta o bastante para não segurar por muito tempo uma credencial que passe a existir (o único caminho é a restauração de cliente excluído, abaixo), longa o bastante para absorver o reenvio de uma instância revogada: a 120/min ela custa uma consulta a cada 5 min, em vez de 120 por minuto.
   - **Teto e inflação.** Entra no registro só o que o banco recusou, e essa consulta já foi cobrada na cota do IP: no máximo 600 × 5 = 3.000 entradas por IP no Z-API (30 × 5 = 150 no contexto). O teto de 50.000, com despejo do menos recente, comporta uns 16 IPs de saída da Z-API recusando na cota cheia ao mesmo tempo, e custa alguns MB; uma entrada despejada só custa mais uma consulta e uma cobrança. Não há balde por impressão para o repetidor: a resposta a um token já recusado não toca banco nem cria memória, e custa o mesmo que a recusa por formato inválido, que também não tem limite.
   - **Por que é seguro no Z-API.** O `webhook_token` é gerado no servidor (`connectionService`, `randomBytes(24)`, 192 bits) e gravado no mesmo `INSERT` que cria a conexão. A URL só aparece na tela da conexão (`app/integracoes/conector/[platform]/page.tsx`), lida do banco depois desse `INSERT`. Por isso não existe corrida em que alguém consulte o token antes de ele existir. O token não é reutilizado: a reconexão mantém o token existente, e a revogação o zera para sempre. Uma credencial Z-API nunca passa de inexistente a existente.
   - **Pior caso no Z-API.** Para esgotar a cota de um IP compartilhado, um co-inquilino precisa mandar 600 ou mais tokens **distintos** por minuto, sem parar, a partir do mesmo IP de saída. Na Z-API isso exige reconfigurar continuamente a URL de webhook das próprias instâncias (um token novo por URL) ou gerar o tráfego por fora da Z-API, e nesse caso ele não sai do IP da Z-API. Enquanto durar, credencial nunca vista por esta réplica naquele IP espera; as conhecidas seguem servidas.
   - **Contexto público.** O registro negativo vale só para a credencial `link`. Link revogado ou vencido nunca volta a valer: não há caminho que limpe `revoked_at` ou estenda `expires_at`. A exceção é `core.restaurar_cliente` (`scripts/titular.mjs`, executado pelo dono do banco), que volta a expor os links do cliente restaurado: um link aberto enquanto o cliente estava excluído volta a abrir em até 5 minutos depois da restauração. A credencial `convite` **não** entra no registro: `contexto_link_pelo_convite` devolve vazio para convite que ainda não tem link de contexto, e o convite ganha um link depois, legitimamente. Provado por teste: o convite recusado três vezes abre na hora em que o link é criado.

4b. **Formato antes de tudo.** `abrirPublico` valida o formato de toda credencial antes de qualquer cobrança ou consulta: link com 43 caracteres de base64url (o que `gerarTokenDeContexto` produz), convite com `^[A-Za-z0-9_-]{16,64}$` (o convite é gerado com `randomBytes(24)` em base64url). Credencial fora do formato responde como desconhecida, sem cota e sem banco. Isso fecha o caminho em que um `\u0000` vindo da server action ou do upload chegava ao Postgres (erro 22021) e, quando o erro devolvia a cota, permitia até 300 consultas com erro por minuto por IP. O Z-API já validava o formato do token antes do portão. A mesma função de formato do convite (`tokenDeConviteBemFormado`, em `src/modules/connections/domain/integrationInvite.ts`) protege a página `/convite/<token>` e o início do OAuth por convite: depois da cobrança do IP que essas rotas já faziam e antes da consulta, um token fora do formato recebe a mesma resposta de convite inexistente, sem chegar ao banco nem dar 500.

5. **Z-API.** Ordem da rota: formato do token e `content-length` (sem ler o corpo), portão do item 4 (600/min de token desconhecido por IP, 60/min por token conhecido, sem teto total por IP), banco, leitura e validação do corpo, revogação. Não há teto total por IP porque a Z-API entrega os avisos de todos os clientes a partir de poucos IPs.
   - **Por que 600 por minuto.** O IP de saída é compartilhado por todos os clientes da Z-API. Logo depois de um deploy, os registros começam vazios e todas as conexões são desconhecidas por um instante. Com 60/min, 200 descobertas simultâneas num IP davam 140 barradas. O custo de 600 é no máximo 10 consultas indexadas por segundo por IP ao banco, desprezível. O contexto público fica em 30/min, porque lá o IP é de visitante, não de plataforma.
   - O limite por token usa a impressão do token, e não a conexão resolvida, porque só uma chave conhecida antes do banco permite recusar sem consultá-lo. A chave só nasce depois que o banco valida o token. Token revogado que estoura o limite recebe 429 em vez de 410 até a janela virar.
   - O corpo é lido depois da resolução: corpo inválido com token desconhecido responde 404 em vez de 400, o que não revela nada novo.
   - O `warn` `webhook.zapi.webhook_desconhecido` passa por `criarAvisoLimitado` (`src/shared/logging/avisoLimitado.ts`, sobre a `janelaLimitada` do ADR 0049): no máximo uma linha por minuto no processo, com `suprimidos`.
   - **Instância revogada que continua postando.** Medido com o cenário da revisão (uma conexão nova a cada 3 s por 3 min): com a revogada repetindo o mesmo token a 120/min, 0 de 60 entregas novas barradas (antes do registro negativo: 30 de 60).
   - **Pior caso que sobra:**
     - Tokens **distintos** em volume contínuo no mesmo IP de saída (item 4a). Medido com cota 600, no cenário de uma conexão nova a cada 3 s por 3 min: tokens distintos a 120, 540, 590 e 600 por minuto, 0 de 60 entregas novas barradas; a 660 por minuto, 3 de 60. Com cota 60, a 120/min davam 30 de 60. O falso 429 começa por volta de 600 tokens distintos por minuto. Depois de um deploy os dois registros começam vazios, e nesse cenário as conexões daquele IP voltam conforme sobra cota.
     - Descobertas legítimas simultâneas acima da cota no mesmo IP também esbarram nela, porque a devolução só vem depois do banco. Medido com cota 600 (banco com 10 conexões e 5 ms): 200 e 600 credenciais novas simultâneas, 0 barradas; 601, 1 barrada; 800, 200; 1.000, 400. Com cota 60: 200 simultâneas davam 140 barradas. Medido pela revisão, logo depois de um deploy: 200 conexões com 3 primeiras requisições simultâneas cada, 0 barradas; com 4 cada, 200 barradas; com 10 cada, 1.400 barradas. Com 120 revogadas no meio, 200 × 3 deram 120 barradas.
     - Banco degradado logo depois de um deploy. Erro do banco não devolve a cota (falha fechada, item 4), então cada post com erro gasta cota do IP. Medido pela revisão: 700 posts com erro e depois o banco volta; as 200 conexões ainda não validadas recebem 429 (200 de 200) até a janela virar, até 60 s depois de o banco voltar. Depois da virada, 200 de 200 servidas. A decisão de não devolver em erro fica: devolver deixaria provocar erro para consultar o banco sem gastar cota.
   - Testes por HTTP: `tests/webhook-zapi.test.mjs` cobre a rota real:
     - aceite;
     - 404 sem gravar;
     - 413;
     - 429 por tokens desconhecidos, com o token conhecido seguindo aceito;
     - 429 com `Retry-After` pelo limite por token;
     - revogação pelo caminho real (token zerado): 404 sem gravar, e o reenvio repetido não esgota a cota do IP;
     - 410 sem gravar para conexão de cliente excluído (status revogado com token mantido, migração 0043);
     - isolamento entre organizações.
   - Testes por HTTP: `tests/webhook-zapi.test.mjs` cobre a rota real (aceite, 404 sem gravar, 413, 429 por tokens desconhecidos com o token conhecido seguindo aceito, 429 com `Retry-After` pelo limite por token, 410 sem gravar, isolamento entre organizações).

6. **Páginas públicas.** `/contexto/<token>`, o upload público e a parte do convite que carrega o contexto passam por `abrirPublico`, com o portão do item 4: teto total por IP (300/min, como era antes deste ADR), 30/min de credencial desconhecida por IP, 120/min por credencial conhecida. Um escritório dividindo IP cabe nos 300 por minuto; atrás de CGNAT, o link que já abriu uma vez segue abrindo mesmo com o IP saturado de tentativas inválidas. Credencial desconhecida responde `not_found` como antes e não cria balde por credencial.
   - A chave por credencial usa a impressão de `tipo:token`, e não o `linkId`, que só é conhecido depois do banco. Link e convite que levam ao mesmo link têm baldes separados, então esse link aceita até 240 por minuto pelas duas credenciais.
   - Sem IP confiável (falta do `x-forwarded-for`), os baldes caem na chave única `sem-endereco`: 30 de credencial desconhecida e 60 no total por janela, compartilhados. Em produção cada requisição assim chama um aviso limitado, `warn` `contexto.publico.sem_endereco_confiavel`, no máximo uma linha por minuto (ligado em `src/composition.ts`, só com `NODE_ENV=production`). Assim, se o proxy deixar de mandar o cabeçalho, a falha de configuração aparece no log em vez de todos os visitantes dividirem o teto em silêncio.
   - Testes por HTTP em `tests/contexto-publico-limite.test.mjs`: tokens forjados de um IP passam a receber "Muitas tentativas" e o link já aberto segue abrindo; link revogado reaberto 50 vezes gasta uma tentativa só; teto total por IP com links válidos.
   - `/convite/<token>` (página) e o OAuth por convite seguem com o limite por IP sobre toda visualização (30 e 20 por 10 minutos), anterior a este ADR.

7. **O 429 do `workerRoute` escreve `warn`** `worker.limite_excedido` com `requestId`, caminho, fingerprint do chamador e `retryAfterSeconds`, sem o token.

## Consequências

- O único domínio que um anônimo consegue encher é o `ip`, e só com IPs distintos (cerca de 2.500, item 3); mesmo assim o ataque degrada só esse domínio: no pior caso, baldes ociosos de visitantes legítimos são despejados e recomeçam a contagem (eles ganham folga, não perdem acesso).
- Sem credencial válida, um IP leva ao banco no máximo a cota de desconhecidas por janela: 600 no Z-API e 30 no contexto público, de forma atômica.
- Quem tem uma credencial válida ainda consegue, por janela: 60 requisições servidas por token no Z-API e 120 por credencial no contexto (até 300 por IP), de quantos IPs quiser. Enquanto a credencial ainda não está no registro (primeira vez em 24 h, ou depois de reinício ou despejo), ela é cobrada na cota de desconhecidas de cada IP: uma rajada simultânea de muitos IPs pode levar ao banco até `IPs × cota` consultas uma vez (medido: 2.000 consultas numa rajada de 2.000 vindas de 100 IPs, das quais 60 servidas), e zero na rajada seguinte.
- Credencial nova num IP compartilhado com abuso contínuo pode esperar até o abuso parar (item 5, pior caso).
- O registro de validadas é por réplica e em memória: some a cada deploy, e cada réplica aprende de novo.
- Limite em memória e por réplica (ADR 0026): com N réplicas, cada número acima vale N vezes.
- Memória limitada: no pior caso, 160.200 baldes no processo (inclui 50.000 de `validadas` e 50.000 de `recusadas`), dezenas de MB no máximo.
- Um link de cliente restaurado que tenha sido aberto durante a exclusão pode levar até 5 minutos para voltar a abrir naquela réplica.

## Alternativas descartadas

- **Manter o mapa único e só aumentar o teto:** adia o problema; o custo para lotar continua linear e o anônimo segue disputando a vaga do worker.
- **Recusar chave nova ao lotar (comportamento anterior), mas por domínio:** o domínio anônimo pararia por inteiro, inclusive para visitante legítimo; despejar o menos recente mantém o serviço e o limite de quem abusa.
- **Despejar por ordem de criação, sem recolocar no fim:** o balde do próprio abusador (o mais antigo) sairia primeiro e zeraria a contagem dele.
- **Derivar o domínio pelo prefixo da chave:** frágil (um prefixo novo cai no domínio errado sem aviso) e invisível ao typecheck.
- **Limite de taxa no Caddy:** a imagem padrão do Caddy não traz módulo de rate limit; exigiria imagem customizada (`xcaddy` com módulo de terceiro), mais uma peça para manter e atualizar. Pode vir depois como camada extra, não como substituto do limite da aplicação, que conhece o token, a conexão e o worker.
- **Limitador compartilhado (Redis ou Postgres):** resolve também o limite por réplica, mas adiciona infraestrutura e latência em toda rota; desproporcional ao volume de hoje (ADR 0026).
