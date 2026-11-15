resource "google_bigquery_dataset" "dw" {
  dataset_id    = "tria_dw"
  friendly_name = "Dados coletados (fato + governança)"
  location      = "US"
  depends_on    = [google_project_service.required]
}

resource "google_bigquery_dataset_iam_member" "vm_editor" {
  dataset_id = google_bigquery_dataset.dw.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_project_iam_member" "vm_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.vm.email}"
}
