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
- Nunca mergear `dev` em `main` sem seguir `docs/release/`. O deploy espera o `infra.yml` do mesmo commit, roda o pre-flight (`scripts/preflight-release.sh` → `infra/compose/preflight-vm.sh`) antes de qualquer migração (ADR 0034).
- Deploy com migração destrutiva exige `workflow_dispatch` com `autorizar_corte=true`; o deploy automático do merge falha de propósito no gate.
- Segredos: nunca imprimir valor; criar versão por pipe sem eco.
- A VM fica desligada ao fim do trabalho: `scripts/vm-desligar.sh`.
- Nunca apagar backups.
