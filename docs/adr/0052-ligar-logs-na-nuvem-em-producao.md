---
status: accepted
date: 2026-11-24
---
# ADR-0052: Ligar o pacote de logs na nuvem em produção

## Contexto

O ADR 0049 (decisão 6) deixou o pacote de logs na nuvem preparado e desligado, à espera da decisão do humano, com duas ressalvas no README do Terraform: o preço da métrica baseada em log e da política de alerta não foi verificado, e o volume real de logs da VM não foi medido. Em 2026-11-24 o dono do projeto decidiu ligar o pacote em produção.

## Decisão

1. O `infra.yml` passa `TF_VAR_logs_na_nuvem_habilitado` ao `plan` e ao `apply`, lido da variável do GitHub `LOGS_NA_NUVEM_HABILITADO` (padrão `false` se ausente). A variável é `true` em produção.
2. A impressão digital da chave apt é o padrão de `logs_na_nuvem_chave_apt_impressao` (`35BAA0B33E9EB396F59CA838C0BA5CE6DC6315A3`), com a proveniência registrada no README: download por TLS e duas fontes independentes que não são páginas oficiais da Google.
3. O aplicar segue o fluxo normal: merge em `main`, `infra.yml` com o job `apply` aprovado no ambiente `producao` (revisor obrigatório). A mudança do script de inicialização reinicia a VM.

## Riscos aceitos

- Custo: ingestão de log US$ 0,50/GiB depois de 50 GiB grátis por mês é verificado; preço da métrica baseada em log e da política de alerta continua não verificado. Conferir a fatura do primeiro mês.
- Volume de logs não medido antes de ligar. O filtro do agente só envia a linha da aplicação (lista de permissão por `at` e `level`), o que limita o volume.
- A conferência da chave apt não protege contra comprometimento do domínio da Google.

## Como desligar

Na ordem do README: remover o agente na VM primeiro e só então pôr `LOGS_NA_NUVEM_HABILITADO=false`. Com o agente vivo e a variável em `false`, a exclusão do projeto some do plano e os logs de Caddy, Postgres e n8n passam a ser guardados por 30 dias.

## Consequências

- Supera "preparado e não aplicado" do ADR 0049, decisão 6; o restante do ADR 0049 não muda.
- Ligar ou desligar em produção passa a depender de uma variável de repositório, fora do diff do PR; o `plan` do `infra.yml` mostra o efeito antes do `apply`.
