locals {
  app_secret_names = [
    "database-url",
    "worker-token",
    "session-secret",
    "postgres-password",
    "app-db-password",
    "worker-db-password",
    "n8n-encryption-key",
    "n8n-api-key",
    "n8n-db-password",
    "proxy-basic-auth",
  ]

  oauth_secret_names = [
    "google-oauth-client-id",
    "google-oauth-client-secret",
    "meta-app-id",
    "meta-app-secret",
    "meta-login-config-id",
  ]

  all_secret_names = concat(local.app_secret_names, local.oauth_secret_names)
}

resource "google_service_account" "vm" {
  account_id   = "${local.prefix}-vm"
  display_name = "Máquina do ambiente ${var.environment} da tria"
  description  = "Privilégio mínimo: lê segredos, escreve log e métrica. Não administra nada."
  depends_on   = [google_project_service.required]
}

resource "google_secret_manager_secret" "app" {
  for_each = toset(local.all_secret_names)

  secret_id = "${local.prefix}-${each.value}"

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "vm_access" {
  for_each = google_secret_manager_secret.app

  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_project_iam_member" "vm_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_project_iam_member" "vm_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_service_account_iam_member" "deployer_acts_as_vm" {
  service_account_id = google_service_account.vm.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:tria-deployer@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_project_iam_member" "vm_pull_image" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.vm.email}"
}
