# 0008 — Correções da revisão de segurança e consistência (nov/2026)

- Status: aceito
- Data: 2026-11-19
- Issue: 24K-111

## Contexto

Uma revisão do projeto inteiro (código, infra, n8n e produção) encontrou
pontos a corrigir. A superfície externa estava bem fechada:

- só as portas 80 e 443 respondem;
- o editor e os webhooks não listados do n8n passam pela portaria;
- RLS ativo em todas as tabelas, e todas as funções `SECURITY DEFINER` fixam
  o `search_path`;
- auditoria append-only;
- zero vulnerabilidades em dependências de produção;
- CSP, HSTS e `X-Frame-Options` no app.

## Decisões

1. **O segredo do app Meta sai do n8n.** O fluxo `24/7 · Meta Lead Ads
   (entrada)` lia o `META_APP_SECRET` de uma Data Table do n8n, que **não é
   cifrada**: o valor fica em texto puro no Postgres do n8n e é visível no
   editor. Agora o fluxo chama `POST /api/v0/webhooks/meta/assinatura`
   (autenticada com o token do worker), e o app valida a assinatura
   `X-Hub-Signature-256` em tempo constante (`assinaturaDaMetaValida`, a mesma
   do webhook do WhatsApp). O segredo fica só no Secret Manager, que alimenta o
   ambiente do app. Antes da troca, conferimos por hash que os dois segredos
   eram iguais. O fluxo falha fechado: qualquer resposta que não seja
   `valida: true` recusa o aviso. Substitui o trecho correspondente do ADR 0007.
2. **Credencial órfã na autorização OAuth.** A credencial era gravada no
   cofre (n8n) antes de a conexão ser salva, sem compensação. Uma falha no
   meio deixava um token válido sem dono. Produção tinha 10 credenciais
   "Google Ads" órfãs, todas com o escopo `adwords` de leitura e escrita. Agora
   a busca e o `insert`/`renew` da conexão rodam em `executarComCompensacao`:
   se falharem, a credencial nova é descartada e o erro original sobe.
3. **Deploy só a partir de `main`.** O repositório é privado e está no plano
   gratuito, que não oferece proteção de branch nem regras de ambiente. O
   `workflow_dispatch` permitia publicar em produção a partir de qualquer
   branch, com os segredos de produção. O job `publicar` agora exige
   `github.ref == refs/heads/main`.
4. **Graph API alinhada em `v23.0`.** O app, o coletor e o executor da Meta
   estavam em `v21.0`, a versão mais próxima de ser descontinuada. Os fluxos
   da Credaz já usavam `v23.0` com o mesmo app.
5. **`middleware.ts` → `proxy.ts`.** Convenção do Next 16, que deprecia
   `middleware`. O comportamento não muda.
6. **Backup lógico a cada desligamento.** Os snapshots diários são
   consistentes só como um crash e ficam na mesma região. Agora
   `scripts/vm-desligar.sh` faz `pg_dumpall` (app e n8n) e grava no bucket
   `<projeto>-tria-producao-backups`:
   - multi-região `US`;
   - sem acesso público;
   - 30 dias de retenção;
   - a SA da VM tem **só** `objectCreator`: grava, mas não lê nem apaga.

   Se o dump falhar, o script avisa e desliga mesmo assim, porque o snapshot
   continua valendo. `SEM_BACKUP=1` pula o dump.
7. **`data_disk_source_snapshot` volta a `null`.** O padrão apontava para um
   snapshot já apagado: o disco atual não é afetado (`ignore_changes`), mas a
   recriação do ambiente falharia.

## Fora desta mudança

Itens que dependem de decisão ou são destrutivos:

- apagar as credenciais e workflows órfãos do n8n;
- apagar a rede `default` do projeto, que não é usada mas tem SSH e RDP
  abertos para `0.0.0.0/0`;
- reduzir `ads_management` na configuração de login da Meta.

Melhorias de menor risco, adiadas:

- CSP sem `'unsafe-inline'` (nonces);
- testes de integração no CI;
- versionar o provisionamento de workflows do n8n.
