resource "google_service_account" "coleta" {
  account_id   = "${local.prefix}-coleta"
  display_name = "Coleta de métricas (n8n) do ambiente ${var.environment}"
  description  = "Só escreve na staging do dataset de coleta. Não lê nada fora dele."
  depends_on   = [google_project_service.required]
}

resource "google_bigquery_dataset" "dw" {
  dataset_id    = "tria_dw"
  friendly_name = "Dados coletados (fato + governança)"
  location      = "US"
  depends_on    = [google_project_service.required]
}

resource "google_bigquery_dataset_iam_member" "coleta_editor" {
  dataset_id = google_bigquery_dataset.dw.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.coleta.email}"
}

resource "google_bigquery_dataset_iam_member" "vm_reader" {
  dataset_id = google_bigquery_dataset.dw.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_project_iam_member" "coleta_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.coleta.email}"
}

resource "google_project_iam_member" "vm_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.vm.email}"
}
