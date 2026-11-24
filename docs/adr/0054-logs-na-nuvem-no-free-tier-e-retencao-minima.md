---
status: accepted
date: 2026-11-24
---
# ADR-0054: Logs na nuvem dentro do free tier e com retenção mínima

## Contexto

O pacote de logs na nuvem foi ligado em produção (ADR 0052, que o PR #154 renumera de 0051). O dono do projeto estabeleceu duas metas em 2026-11-24: ficar dentro do free tier e guardar só o mínimo necessário, por enquanto. O ADR 0052 deixou o custo como risco aceito, sem retenção própria e sem trava de uso: o `_Default` do projeto guarda 30 dias, e nada avisava se o volume se aproximasse do limite grátis.

Verificado em 2026-11-24 na documentação do Google Cloud: os primeiros 50 GiB por projeto por mês de ingestão são grátis (acima, US$ 0,50/GiB); os 30 dias de retenção padrão estão incluídos (acima de 30 dias, US$ 0,01/GiB/mês); log excluído não é cobrado; alerta não é cobrado hoje, e a cobrança só começa a partir de 2027-09-01, com alertas sobre métricas de billing fora dela.

## Decisão

1. **Retenção mínima configurável.** `logs_na_nuvem_retencao_dias`, de 1 a 30, padrão **3 dias**, aplicada ao bucket `_Default` (`google_logging_project_bucket_config`). Três dias cobrem um fim de semana entre o alerta por e-mail e a investigação. O limite de 30 impede cair, sem querer, na faixa cobrada.
2. **Trava de uso.** Alerta por e-mail quando os logs ingeridos no mês passam de `logs_na_nuvem_alerta_uso_gib` (padrão **40 GiB**, folga de 10 GiB sobre o free tier), com a métrica de billing `logging.googleapis.com/billing/monthly_bytes_ingested`. O alerta só avisa; não corta a ingestão.
3. **O que já limita o volume continua:** lista de permissão do agente (só a linha da aplicação sai da VM), exclusão do projeto para o resto de `containers_docker` e limite de 120 requisições por minuto em `client.erro`.
4. A meta é medida na prática: o volume real ainda não foi medido (o agente não acessa a VM de produção). O humano mede antes de ligar e acompanha a página Logs Storage por um mês.

## Riscos aceitos

- **Retenção do projeto inteiro:** o `_Default` é do projeto, não só da aplicação. Reduzir de 30 para 3 dias apaga o que for mais antigo que 3 dias em todo o `_Default`. O `_Required` (auditoria administrativa) não muda. Ao desligar o pacote, a retenção não volta a 30 dias sozinha.
- **Pior caso de `client.erro`:** até cerca de 1 GB por dia (31 GB por mês) se alguém saturar o limite, dois terços do free tier. Cabe, mas deixa pouca folga para o resto.
- **Métrica de erros baseada em log:** a única fonte encontrada (um blog antigo) fala em 150 MiB grátis por conta de cobrança. Não confirmado em página vigente; conferir na primeira fatura.
- **Alerta de uso:** os dados chegam em lotes de uma hora, então o aviso pode atrasar até algumas horas, e a sintaxe do filtro não foi testada contra o projeto real. O `plan` valida o esquema, não a existência da métrica.
- **Alerta vira cobrado:** a partir de 2027-09-01 a política de erros pode passar a custar (US$ 0,35 por mês por referência de métrica, segundo o Google). Reavaliar na época.

## Consequências

- Supera a parte de custo do "Riscos aceitos" do ADR 0052; o restante não muda.
- Dois recursos novos em `observabilidade.tf`, ambos sob `logs_na_nuvem_habilitado`; sem a variável ligada o `plan` não mostra mudança.
- Mudar o prazo de retenção é mudar uma variável do Terraform e passar pelo `infra.yml`; a política de alerta de erros e a de uso seguem a mesma aprovação do ambiente `producao`.
