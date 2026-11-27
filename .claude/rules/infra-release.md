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

- Produção muda por Terraform (`infra/terraform` via `infra.yml`) e pelos workflows. O agente roda `terraform plan` e `apply`, inclusive no bootstrap quando houver credencial (ADR 0069).
- O agente dispara workflow, mergeia PR em `dev` e em `main` e libera release seguindo `docs/release/` (ADR 0034). Chave KMS: só depois da recifragem com `avaliadas = 0` e `falhas = 0` (ADR 0042).
- Nunca mergear `dev` em `main` sem seguir `docs/release/`. O deploy espera o `infra.yml` do mesmo commit, roda o pre-flight (`scripts/preflight-release.sh` → `infra/compose/preflight-vm.sh`) antes de qualquer migração (ADR 0034).
- Deploy com migração destrutiva exige `workflow_dispatch` com `autorizar_corte=true`; o deploy automático do merge falha de propósito no gate.
- Segredos: nunca imprimir valor; criar versão por pipe sem eco.
- A VM fica desligada ao fim do trabalho: `scripts/vm-desligar.sh`.
- Nunca apagar backups.
