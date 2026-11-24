---
status: accepted
date: 2026-11-24
---
# ADR-0054: Logs na nuvem dentro do free tier e com retenção mínima

## Contexto

O pacote de logs na nuvem foi ligado em produção (ADR 0052, hoje `0051-ligar-logs-na-nuvem-em-producao.md` até o PR #154 renumerá-lo). O dono do projeto estabeleceu duas metas em 2026-11-24: ficar dentro do free tier e guardar só o mínimo necessário, por enquanto. O ADR 0052 deixou o custo como risco aceito, sem retenção própria e sem trava de uso: o `_Default` do projeto guarda 30 dias, e nada avisava se o volume se aproximasse do limite grátis.

Verificado em 2026-11-24 na documentação do Google Cloud: os primeiros 50 GiB por projeto por mês de ingestão são grátis (acima, US$ 0,50/GiB); os 30 dias de retenção padrão estão incluídos (acima de 30 dias, US$ 0,01/GiB/mês); log excluído não é cobrado; alerta não é cobrado hoje, e a cobrança só começa a partir de 2027-09-01, com alertas sobre métricas de billing fora dela.

## Decisão

1. **Retenção mínima só para a aplicação.** `logs_na_nuvem_retencao_dias`, de 1 a 30, padrão **3 dias**, aplicada a um bucket próprio `<prefixo>-aplicacao` (`google_logging_project_bucket_config`). Três dias cobrem um fim de semana entre o alerta por e-mail e a investigação. O limite de 30 impede cair, sem querer, na faixa cobrada.
2. **O `_Default` do projeto não muda.** Ele guarda a trilha de acesso a dados do KMS, do Secret Manager e do BigQuery, da qual o ADR 0032 depende para detectar uso indevido do cofre; esses logs ficam no `_Default`, não no `_Required`. Encurtar o `_Default` apagaria essa trilha em todo o projeto e não economizaria nada, porque os 30 dias já estão incluídos no preço. A primeira versão deste ADR fazia isso e a revisão de segurança do #155 a bloqueou.
3. **Um sink leva a linha da aplicação ao bucket próprio**, com identidade de escrita própria e o papel `logging.bucketWriter` restrito por condição a esse bucket. Uma exclusão tira a mesma linha do `_Default`, para não guardá-la duas vezes nem contá-la em dobro nos 50 GiB. A exclusão só é criada depois do sink e do papel; como o IAM propaga de forma eventual, nos primeiros minutos do `apply` a linha pode ser descartada antes de a permissão valer (janela curta aceita).
4. **Trava de uso.** Alerta por e-mail quando os logs ingeridos no mês passam de `logs_na_nuvem_alerta_uso_gib` (padrão **40 GiB**, folga de 10 GiB sobre o free tier), com a métrica de billing `logging.googleapis.com/billing/monthly_bytes_ingested`. Mede o projeto inteiro, inclusive os logs de acesso a dados. O alerta só avisa; não corta a ingestão.
5. **O que já limita o volume continua:** lista de permissão do agente (só a linha da aplicação sai da VM), exclusão do projeto para o resto de `containers_docker` e limite de 120 requisições por minuto em `client.erro`.
6. A meta é medida na prática. Em 2026-11-24 o humano mediu na VM 1.467 bytes em 24 horas no container `orla-app` (cerca de 44 KB por mês, contra 50 GiB): uma amostra de um dia, não representativa de pico. O volume que pode se aproximar do free tier não vem da aplicação, e sim dos logs de acesso a dados (KMS, Secret Manager, BigQuery) e do pior caso de `client.erro`; o alerta de uso cobre essas fontes. O humano acompanha a página Logs Storage por um mês depois de ligar.

## Riscos aceitos

- **Sink sem teste real:** o `plan` valida o esquema, não prova que o sink consegue escrever no bucket. Como a exclusão só vem depois do sink e do papel, uma falha de escrita ainda pode deixar a linha sem destino. Teste obrigatório depois do `apply`: gerar um erro de teste, confirmar a linha no bucket `<prefixo>-aplicacao` e confirmar que o alerta de erros dispara (a métrica de erros conta na entrada, antes das exclusões; isso é o comportamento esperado do Cloud Logging, não verificado aqui).
- **Logs mais difíceis de achar:** a aplicação deixa de aparecer no escopo padrão do Logs Explorer; é preciso escolher o bucket em "Refinar escopo". O texto do alerta de erros já diz isso.
- **Pior caso de `client.erro`:** até cerca de 1 GB por dia (31 GB por mês) se alguém saturar o limite, dois terços do free tier. Os logs de acesso a dados do KMS (um por Encrypt ou Decrypt de cada coleta), do Secret Manager e do BigQuery somam a isso e não foram estimados; o alerta de uso os cobre.
- **Métrica de erros baseada em log:** a única fonte encontrada (um blog antigo) fala em 150 MiB grátis por conta de cobrança. Não confirmado em página vigente; conferir na primeira fatura.
- **Alerta de uso:** os dados chegam em lotes de uma hora (segundo a página de buckets do Cloud Logging, não testado neste projeto), então o aviso pode atrasar até algumas horas, e a existência da métrica com `resource.type="global"` não foi verificada no projeto real.
- **Alerta vira cobrado:** a partir de 2027-09-01 a política de erros pode passar a custar (US$ 0,35 por mês por referência de métrica, segundo o Google). Reavaliar na época.
- **Dado pessoal pseudônimo:** as linhas de `client.erro` carregam `userId`; o prazo de 3 dias consta em `docs/lgpd/retencao.md`.

## Consequências

- Supera a parte de custo do "Riscos aceitos" do ADR 0052; o restante não muda.
- Cinco recursos novos em `observabilidade.tf` (bucket, sink, papel, exclusão e o alerta de uso), todos sob `logs_na_nuvem_habilitado`; sem a variável ligada o `plan` não mostra mudança.
- Mudar o prazo de retenção é mudar uma variável do Terraform e passar pelo `infra.yml`; a política de alerta de erros e a de uso seguem a mesma aprovação do ambiente `producao`.
