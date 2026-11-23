# 0049 — Auditoria, logs e correlação: falha de observabilidade, imutabilidade e ciclo de vida

- Status: aceito
- Data: 2026-11-22
- Issue: 24K-112
- Relacionado: ADR 0008 (auditoria append-only), 0010 (logs e retenção), 0028 (papel `orla_worker`)
- Numeração: o 0047 de `dev` é "agente executa os passos antes do humano" e o 0048 é o merge em dev autorizado no hook; este ADR, escrito como 0047, ficou com 0049.

## Contexto

A revisão da camada de auditoria, métricas, logs e traces encontrou:

1. `auditRepository.record` não tem tratamento de erro. Cerca de 110 chamadores com `await` propagam a falha (fecham a operação). A suspeita de chamada sem `await` em `contextoService.ts:443,456` foi **refutada**: as duas linhas são as definições de `registrar` e `registrarPublico`, e todo chamador usa `await`.
2. Eventos sem auditoria: logout, leitura de alertas, leitura de dado de cliente e a portaria do n8n (`n8nSession.ts:29-41` só escreve log).
3. `proxy.ts` não gera `x-request-id`. `workerRoute.ts:64` gera um, mas só o devolve no 429. Não há correlação entre log, auditoria e resposta.
4. `workerRoute.ts:69` registra `sourceIp` em log. `clienteN8n.ts` e `criarBrain.ts` repassam contexto ao logger, que redige por chave e por texto (`redact`), e o contexto do `clienteN8n` é `Record<string, string>` montado pelo chamador: sem mudança. O fluxo `alertas-de-falha.json` envia a mensagem de erro sem redação na origem, mas o servidor a redige (`limparTexto` → `redactText`, `alerta.ts`) antes de gravar e notificar, e o tráfego é interno (`app:3000`): **refutado como vazamento**, o fluxo não muda.
5. `workerRoute` aceitava o `x-request-id` do chamador sem validar (forja, injeção em log), e `requestId()` de `src/shared/http/actions.ts` gerava um UUID novo, de modo que ator, ação de servidor e página pública gravavam ids diferentes do `X-Request-Id` da resposta.
5. O `redact` não tratava ciclo, profundidade, `Error`, `bigint`, `Date` nem binário, e o `logger.emit` podia lançar. Corrigido em `src/shared/logging/` (sem commit ainda).
6. A trilha é append-only para `orla_app` (`0002_security.sql:17-18`, `REVOKE UPDATE`, sem `GRANT DELETE`). UPDATE e DELETE só ocorrem dentro de funções `SECURITY DEFINER` (0038, 0080, 0133). Nenhum teste prova isso para `orla_worker`, que é membro de `orla_app`.
7. Logs da VM: docker 10m × 3, journald 200M por 1 mês, sem sink nem alerta.

## Decisões

### 1. Falha de auditoria: fechada para mutação, aberta para leitura

- **Mutação** de autorização, acesso, posse, conexão ou dado de cliente: `record` continua lançando, e a operação falha junto. Uma ação sem trilha não é aceitável. Os chamadores atuais não mudam.
- **Leitura, logout e portaria do n8n**: `registrarSemFalhar(recorder, evento)` (`src/modules/audit/application/`), que captura a falha e escreve `auditoria.falhou` com `action`, `requestId` e só o nome do tipo do erro (nunca metadata nem mensagem crua do banco). A interface `AuditRecorder` não muda. Observabilidade que derruba o fluxo principal é pior que a lacuna.
- Logout e portaria gravam depois da resposta, por `after()` de `next/server`, para não atrasar o redirect; a função nunca rejeita. Se o processo morrer entre a resposta e a gravação (SIGTERM no deploy), o evento se perde: lacuna aceita. A leitura de cliente espera, para manter a ordem, e uma falha só adiciona latência.
- Teste: falha do repositório de auditoria não propaga em `registrarSemFalhar`; mutação segue propagando.

### 2. Correlação por `x-request-id`

- `resolverRequestId` (`src/shared/http/requestId.ts`, função pura) aceita o id de entrada só se casar `^[A-Za-z0-9-]{8,64}$`; senão gera um UUID. O `proxy.ts` o põe no request (para as rotas) e em `X-Request-Id` de **toda** resposta, inclusive o redirect de login.
- `workerRoute` e `requestId()` de `actions.ts` usam a mesma função, então ator, ação de servidor, página pública e resposta compartilham o id.
- `record` recebe o `requestId` onde o chamador o tem. Sem id, grava `NULL`; não inventa.
- Risco aceito: o id é escolhido pelo cliente quando válido, então serve para correlação e nunca como prova de identidade ou de unicidade.

### 3. Lacunas de auditoria

Novas ações, todas por `registrarSemFalhar`: `auth.logout`, `cliente.leitura` (id do cliente, sem conteúdo, no máximo uma entrada por usuário e cliente a cada 60 s, depois da checagem de escopo) e `n8n.portaria` (resultado, sem token).

`alertas.leitura` **não entra**: não existe listagem de alertas, só o contador `alertas.contarAbertos()` em `/automacoes`, para admin, sobre alerta da plataforma (sem organização e sem dado de cliente). Auditar cada carregamento seria ruído sem valor. Reavaliar quando houver tela de alertas. Risco aceito.

Eventos com `organization_id` nulo e ator `user` (logout, portaria) expiram em 30 dias pela retenção (`0038`), o que é intencional.

### 4. Redação e dado pessoal em log

- O IP do worker sai do log; permanece na auditoria, que tem retenção de 6 meses para IP (ADR 0010).
- O contexto de `clienteN8n` e `criarBrain` passa pelo `redact` já existente (chaves novas: cookie, cpf, jwt, signature, assinatura, passwd).
- `alertas-de-falha.json` redige a mensagem na origem (e-mail, Bearer, JWT) antes de enviar.

### 5. Imutabilidade provada por teste

Teste de integração em `tests/fronteiras.test.mjs`: `orla_app` e `orla_worker` não têm `UPDATE` nem `DELETE` direto em `audit.audit_log` (`has_table_privilege`), e a tentativa real falha. A retenção, o titular e a posse continuam por função `SECURITY DEFINER`. Adicionar duas organizações: a organização B não lê a trilha de A.

### 6. Ciclo de vida

- Retenção da trilha (2 anos; IP 6 meses; acessos sem organização 30 dias) já existe (0038) e não muda.
- Logs da VM: os limites atuais (docker 10m × 3, journald 200M/1 mês) ficam. Sink para Cloud Logging só por Terraform, preparado e **não aplicado**, com estimativa de custo; o humano decide. Os preços do Cloud Logging **não foram verificados**: a estimativa entra só depois de conferir a tabela vigente.
- Ferramenta paga de logs ou APM: só proposta com custo, decisão do humano.

### 7. Fora da v1

Métricas operacionais (o health só faz `SELECT 1`), tracing distribuído, tela de auditoria e alerta sobre log da VM. Entram em issue própria se o humano quiser.

## Correções da auditoria de segurança (mesma entrega)

A revisão adversarial do diff achou sete pontos, todos corrigidos antes de fechar:

- **Portaria do n8n** gravava na trilha a cada acesso anônimo (DoS de escrita). Agora só audita com assinatura do handoff válida (`aberta`, `reuso`, `indisponivel`); assinatura inválida e `sem_automacao` ficam só no log. O `reuso` tem limite de 3 por minuto por usuário. Logout e portaria usam `after()` de `next/server`.
- **`redactText` quadrático**: 80 KB travavam o processo por 1,7 s. Agora corta antes de redigir (pilha em 2000, texto em 4096) e as regex têm quantificadores limitados. Risco aceito: segredo cortado exatamente na fronteira pode deixar um prefixo sem redação.
- **`X-Request-Id` nas rotas fora do matcher** (`/api/contexto/**/arquivos`): o handler resolve o id uma vez e o devolve em toda resposta; o matcher não muda, por causa do limite de corpo.
- **`cliente.leitura`**: no máximo uma entrada por usuário e cliente a cada 60 s. A deduplicação é em memória e por réplica; com várias réplicas pode haver uma por réplica. Risco aceito.
- **Logs na nuvem** só saem da VM com formato da aplicação (lista de permissão por `at` e `level`), com segunda trava no `_Default` (`google_logging_project_exclusion`). Caddy e Postgres levam token de URL e dado pessoal e ficam de fora. A instalação do agente falha sem derrubar o provisionamento, e a chave apt só é aceita com impressão digital conferida (`logs_na_nuvem_chave_apt_impressao`, vazia por padrão: sem valor, o agente não instala).
- **Segunda passada** (três médios, dez baixos), todos tratados: o fim do segredo ficava em claro por tetos nos quantificadores e pelo corte antes da redação (agora a redação roda com folga e só depois corta); a deduplicação e o limite de `reuso` usam mecanismo próprio e limitado, nunca o limitador de segurança, e gravam mesmo se lotar (um anônimo lotava o mapa global pelo webhook zapi e suprimia a auditoria em silêncio); o caminho do Referer em `client.erro` normaliza tokens; a portaria grava o IP (ADR 0010, 6 meses); orçamento de nós contra referências compartilhadas; 500 do upload com `X-Request-Id`.
- **Terceira passada** (nenhum médio): fronteira de corte que encolhe com a redação (agora só sai conteúdo de antes da posição original 4096); e-mail com parte local acima de 64 ou TLD acima de 24 volta a ser redigido; regex de JWT deixa de ser quadrática; a máscara de token em texto livre (`message`, `stack`, `digest`, `path` de `client.erro`) cobre barra escapada de JSON, `%252F`, palavra-chave percent-encoded, colchetes, `code`/`state` do OAuth e `exclusao-de-dados/status`, em um único passo.
- **Riscos aceitos nesta camada:** (1) atacante com handoff capturado pode esconder o `reuso` seguinte da vítima repetindo mais de 3 vezes por minuto, mas as três primeiras repetições ficam gravadas com IP e o `aberta` não tem limite; (2) o orçamento de nós do `redact` conta objetos e arrays, não strings, então um array interno de centenas de milhares de strings custa cerca de 1 s (só código interno monta isso; entrada externa passa por corte antes); (3) um JWT anormal, com mais de 8192 caracteres já na posição 0, pode soltar até 4096 caracteres em claro (cabeçalho e começo do payload em base64); só ocorre com entrada fora do formato real; (4) a deduplicação de leitura é por réplica; (5) JWT precedido de `-` ou `_` com cabeçalho acima de 512 caracteres não é redigido (o limite evita custo quadrático; um JWT real tem cabeçalho muito menor); (6) a máscara de token em texto livre não cobre grafias não canônicas (barra em largura cheia, homóglifo, `\x2f`, entidade HTML, segmentos com `.`/`..`), que nenhum navegador gera para um token válido; `/api/contexto/<clienteId>/arquivos` não é mascarado, porque o id do cliente não é credencial.
- **Serialização de `Error` no log** mudou: só `name`, `message` e `stack` (saem `code`, `detail` e campos enumeráveis do driver do banco, que podem carregar valor digitado). A metadata da auditoria passa pelo mesmo `redact` (profundidade 8, corte em 4096, chaves novas).
- **`client.erro`** (erro de navegador, aberto a anônimo) fica fora da métrica e do alerta de erros: senão qualquer um dispararia e-mail.
- **Desligar os logs na nuvem** exige ordem: remover o agente na VM primeiro e só então pôr a variável em `false`. Com o agente vivo e a variável desligada, a exclusão do projeto some do plano e os logs de Caddy, Postgres e n8n passam a ser guardados por 30 dias. Passo do humano, documentado no README; risco aceito.
- **Entregue ao humano**: aplicar o Terraform, preencher a impressão digital, validar a sintaxe do filtro do agente e testar numa VM com três linhas (aplicação, Caddy, Postgres). Preço de métrica baseada em log e de alerta segue **não verificado**.

## Consequências

- O fluxo de mutação continua a falhar fechado; nada muda para os ~110 chamadores.
- Toda resposta passa a carregar `x-request-id`; log, auditoria e cliente se cruzam.
- Leituras e logout deixam rastro sem risco de indisponibilidade.
- Risco aceito: uma falha prolongada do banco de auditoria deixa leituras sem trilha. O log de erro marca cada lacuna.
