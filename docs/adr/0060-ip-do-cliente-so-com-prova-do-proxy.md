---
status: accepted
date: 2026-11-25
---
# ADR-0060: O IP do cliente só vale com prova do proxy

Fecha um achado da revisão de segurança 24K-115 (gravidade média-baixa). Complementa o ADR 0055 (limitador por domínio) e se apoia no ADR 0057 (o n8n é ator não confiável). Não contradiz nenhum dos dois: o limitador, os domínios e as cotas ficam como estão; muda só de onde vem o IP que vira chave.

## Problema

`enderecoConfiavel` (`src/modules/audit/domain/actor.ts`) usa o **último** item do `x-forwarded-for`, que é o que o Caddy acrescenta com o IP real. Essa confiança só vale para quem passa pelo Caddy. O n8n chama `http://app:3000` direto pela rede `interna`, sem Caddy, e escolhe o último item. Mandando um `X-Forwarded-For` diferente a cada pedido para `/api/webhooks/zapi/<token>` e `/contexto/<token>`:

- cada IP inventado ganha uma cota nova do limitador (600 por minuto de token desconhecido no Z-API, 30 no contexto), o que anula o limite por IP;
- cada IP inventado cria chaves nos domínios `ip` e `recusadas` (ADR 0055), enchendo-os e despejando baldes ociosos de visitantes reais.

## Decisão

1. **Segredo compartilhado Caddy para app.** A variável `TRIA_PROXY_SECRET` (Secret Manager `tria-producao-proxy-secret`, 32 bytes em hexadecimal) chega ao Caddy e ao app. O Caddy envia `header_up X-Orla-Borda "{$TRIA_PROXY_SECRET}"` no `reverse_proxy` do app; `header_up` sobrescreve qualquer valor mandado pelo cliente. O app só lê o `x-forwarded-for` quando `x-orla-borda` é igual ao segredo. A comparação é em tempo constante (`crypto.timingSafeEqual` sobre digests SHA-256, que têm sempre o mesmo tamanho). O cabeçalho nunca é logado nem devolvido.
2. **Sem prova, o IP é desconhecido (`null`), e desconhecido não pula limite.** Todos os chamadores já mapeiam `null` para uma chave fixa: `desconhecido` (Z-API, WhatsApp, Meta exclusão, convite), `desconhecida` (`client.erro`) e `sem-endereco` (contexto público, com 30 de credencial desconhecida e 60 no total por janela, e aviso limitado). Quem não prova a origem divide um único balde conservador por domínio, e as chaves inventadas deixam de existir. O IP `null` também não pode colidir com um IP real, porque o endereço aceito só tem hexadecimais, `.` e `:`.
3. **Desenvolvimento e testes.** Sem `TRIA_PROXY_SECRET` e com `NODE_ENV` diferente de `production`, o comportamento anterior continua (os testes de integração variam o `x-forwarded-for`). Com `NODE_ENV=production` e sem o segredo, o IP é desconhecido e o app emite o aviso limitado `proxy.segredo_de_borda_ausente` (no máximo um por minuto, sem valor).
4. **Infra.** O Terraform declara só o recurso do segredo (`proxy-secret` em `secrets.tf`, sem versão, sem `random_*`: o ADR 0057 e o README mantêm o state sem segredo). A versão é criada pelo humano, por pipe, sem eco (`docs/release/2026-11-identidades-e-metadados.md`). O `startup.sh.tftpl` e o `completar-env.sh` leem o segredo como opcional e o gravam no `.env`; o compose o passa ao app e ao Caddy com `${TRIA_PROXY_SECRET:-}`. O validador de ambiente de release trata `TRIA_PROXY_SECRET` como obrigatória em produção, no mesmo padrão de `TOKENS_KMS_KEY`: o deploy sem o segredo para no pre-flight em vez de subir com todos os visitantes no mesmo balde.
5. **Escopo do ponto único.** Os chamadores passam a usar `enderecoDoCliente(cabecalhos)` (`src/shared/http/enderecoDoCliente.ts`), em vez de montar o IP a partir do `x-forwarded-for` cru. Isso inclui o WhatsApp e a Meta exclusão, que tinham leitura própria do último item. Fica fora o `clientIp` do `workerRoute` (primeiro item, só para rótulo de log de chamador já autenticado por token).

## Consequência registrada do achado 5 (ADR 0055)

O ADR 0055 dizia que lotar o domínio `ip` exigia mais de 20.000 IPs distintos. Contado no código, cada IP cria até 8 chaves nesse domínio (`convite:view`, `convite:oauth:start`, `erros`, `meta:exclusao`, `webhook:whatsapp`, `webhook:zapi:desconhecidos`, `contexto:desconhecidas`, `contexto:ip`), então bastam cerca de 2.500 IPs (20.000 ÷ 8). O efeito continua sendo despejar baldes ociosos, que recomeçam a contagem e ganham folga, e o ADR 0055 foi corrigido. Esse número mostra por que a prova do proxy importa: com o IP livre, qualquer chamador interno, e não só quem tem milhares de IPs, enche o domínio com um laço de pedidos. Com a prova, só IPs que o Caddy viu entram nele, e o custo para lotar volta a ser o de controlar milhares de IPs reais.

## Consequências

- O n8n, ou qualquer container na rede `interna`, não escolhe mais o IP do limitador: cai no balde `desconhecido`. Um fluxo que martele a rota pública esgota só esse balde, que já é conservador.
- Trocar o segredo exige um deploy (o `.env` lê `latest`); app e Caddy sobem juntos. Na janela de `compose up`, o IP cai no balde desconhecido, sem abrir o limite.
- A auditoria (`sourceIp` do ator) passa a gravar `null` quando não há prova; antes gravava o valor alegado, que o n8n podia forjar.
- Se o Caddy parar de mandar o cabeçalho (configuração quebrada), todos os visitantes dividem o balde `desconhecido`: queda de disponibilidade por limite, não bypass. O validador de release e o aviso limitado ajudam a perceber.
- O segredo protege contra chamador na rede interna que não o conhece. Quem lê o `.env` da VM ou o ambiente do app já tem acesso maior que este.

## Alternativas descartadas

- **Remover do app o `x-forwarded-for` e usar o IP da conexão TCP:** atrás do Caddy o IP da conexão é sempre o do proxy, então perde o IP real.
- **Confiar por faixa de IP de origem (`private_ranges`):** o n8n está na mesma faixa privada que o Caddy.
- **Colocar o n8n atrás do Caddy:** tira o tráfego interno da rota direta, mas depende de uma regra de rede para manter e não impede outro container de chamar o app.
- **Assinar o IP com HMAC no Caddy:** o Caddy padrão não computa HMAC sem módulo de terceiro; o segredo estático cobre o mesmo ator.
