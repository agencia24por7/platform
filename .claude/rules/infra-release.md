---
paths:
  - "infra/**"
  - ".github/**"
  - "docs/release/**"
  - "db/corte-gate.txt"
  - "scripts/vm-*.sh"
  - "scripts/preflight-release.sh"
---
# Infra e release

- Produção só muda por Terraform: `infra/terraform` via `infra.yml` (plan e apply na `main`). `infra/terraform/bootstrap` é aplicado à mão pelo humano com ADC.
- Agente prepara e roda `terraform plan`/dry-run. Dispara workflow ou faz merge em `dev` só com autorização explícita do humano para aquela operação (ADR 0046); `terraform apply` local, merge em `main` e o bootstrap continuam do humano.
- Merge de PR em `dev` autorizado pelo humano usa a forma exata `AUTORIZO_MERGE_EM_DEV=<n> gh pr merge <n> --repo github.com/agencia24por7/platform --merge --match-head-commit <sha40 do head>` (ou `--squash`/`--rebase`); o hook confere base `dev`, PR aberto, head igual ao sha, nenhum arquivo em `.github/` e checks `qualidade` e `integracao` do workflow `ci` verdes da mesma execução (ADR 0048). Só use o marcador quando o humano autorizou aquele PR.
- Nunca mergear `dev` em `main` sem seguir `docs/release/`. O deploy espera o `infra.yml` do mesmo commit, roda o pre-flight (`scripts/preflight-release.sh` → `infra/compose/preflight-vm.sh`) antes de qualquer migração (ADR 0034).
- Deploy com migração destrutiva exige `workflow_dispatch` com `autorizar_corte=true`; o deploy automático do merge falha de propósito no gate.
- Segredos: nunca imprimir valor; criar versão por pipe sem eco.
- A VM fica desligada ao fim do trabalho: `scripts/vm-desligar.sh`.
- Nunca apagar backups.
