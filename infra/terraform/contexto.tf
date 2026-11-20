# Bucket único do "contexto do cliente" (ADR 0027). Um prefixo por organização e cliente:
#   orgs/{orgId}/clientes/{clientId}/contexto/...   exportação estruturada derivada
#   orgs/{orgId}/clientes/{clientId}/arquivos/...   envios (logos, manual de marca, CSV, imagens)
# O isolamento entre clientes é feito pelo app (prefixo validado em src/shared/storage). Todo tráfego
# do navegador passa pelo app: sem URL assinada, sem CORS, sem acesso público.
resource "google_storage_bucket" "contexto" {
  name                        = "${var.project_id}-${local.prefix}-contexto"
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  labels = {
    ambiente = var.environment
    uso      = "contexto-do-cliente"
    dados    = "pessoais-e-de-negocio"
  }

  versioning {
    enabled = true
  }

  # 7 dias, igual ao time travel do BigQuery: janela curta de recuperação de exclusão acidental,
  # sem estender muito a permanência de dado que o titular pediu para eliminar.
  soft_delete_policy {
    retention_duration_seconds = 604800
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = var.contexto_versoes_antigas_dias
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      num_newer_versions = var.contexto_versoes_mantidas
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "AbortIncompleteMultipartUpload"
    }
  }

  depends_on = [google_project_service.required]
}

# objectAdmin neste bucket e só nele: o app precisa de objects.list/get/create/delete (apagar uma
# geração específica exige apenas objects.delete) e objectAdmin é o menor papel predefinido que
# junta as quatro. Não concede buckets.* nem signBlob.
resource "google_storage_bucket_iam_member" "vm_usa_contexto" {
  bucket = google_storage_bucket.contexto.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.vm.email}"
}
