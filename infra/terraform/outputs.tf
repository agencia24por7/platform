output "app_url" {
  description = "Link para acessar o app."
  value       = "https://${var.app_hostname}"
}

output "n8n_url" {
  description = "Link do n8n, quando publicado."
  value       = var.n8n_hostname != "" ? "https://${var.n8n_hostname}" : "não publicado — acesse por túnel IAP"
}

output "external_ip" {
  description = "IP estático para apontar o DNS, se a zona não for gerenciada aqui."
  value       = google_compute_address.app.address
}

output "oauth_redirect_uris" {
  description = "Registre exatamente estes valores no console do Google e do Meta."
  value = {
    google = "https://${var.app_hostname}/api/oauth/google/callback"
    meta   = "https://${var.app_hostname}/api/oauth/meta/callback"
  }
}

output "tunnel_commands" {
  description = "Acesso administrativo sem abrir porta na internet."
  value = {
    ssh      = "gcloud compute ssh ${google_compute_instance.app.name} --zone ${var.zone} --tunnel-through-iap"
    postgres = "VM=${google_compute_instance.app.name} ZONE=${var.zone} ./scripts/tunel.sh postgres"
    n8n      = "VM=${google_compute_instance.app.name} ZONE=${var.zone} ./scripts/tunel.sh n8n"
  }
}

output "backup_bucket" {
  description = "Bucket dos dumps lógicos do Postgres, gravados a cada desligamento da VM."
  value       = google_storage_bucket.backups.name
}

output "contexto_bucket" {
  description = "Bucket do contexto do cliente. Chega ao app como CONTEXT_BUCKET; confira com scripts/contexto-verificar-bucket.mjs."
  value       = google_storage_bucket.contexto.name
}

output "secret_names" {
  description = "Preencha os valores antes do primeiro boot."
  value       = [for secret in google_secret_manager_secret.app : secret.secret_id]
}
