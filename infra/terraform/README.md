# Terraform da produção

Aplicado só pelo workflow `.github/workflows/infra.yml` (merge em `main`); o `bootstrap/` é aplicado
à mão, uma vez, por uma pessoa. Não rode `terraform apply` daqui.

## Bucket do contexto do cliente (ADR 0027)

Ordem para ativar a funcionalidade:

1. Merge em `main`: o `infra.yml` cria `google_storage_bucket.contexto`, o vínculo
   `roles/storage.objectAdmin` da conta da VM (só neste bucket) e inclui `CONTEXT_BUCKET` no script de
   inicialização. A mudança do script reinicia a VM, que regrava `/opt/tria/.env`.
2. Com credencial de operador: `node scripts/contexto-verificar-bucket.mjs "$(terraform output -raw contexto_bucket)"`.
3. Deploy do app. Sem `CONTEXT_BUCKET` o app sobe e a funcionalidade responde "indisponível".

O papel `roles/storage.admin` da conta `tria-terraform` (bootstrap) já cobre criar bucket e
definir IAM de bucket; nenhuma permissão nova é necessária. A conta de plano (`tria-terraform-plan`) lê
com `roles/viewer`.
