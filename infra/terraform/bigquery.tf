locals {
  conta_do_terraform = "tria-terraform@${var.project_id}.iam.gserviceaccount.com"
}

resource "google_bigquery_dataset" "dw" {
  dataset_id    = "tria_dw"
  friendly_name = "Dados coletados (fato + governança)"
  location      = "US"

  access {
    role          = "OWNER"
    special_group = "projectOwners"
  }

  access {
    role          = "OWNER"
    user_by_email = local.conta_do_terraform
  }

  access {
    role          = "WRITER"
    user_by_email = google_service_account.vm.email
  }

  depends_on = [google_project_service.required]
}

removed {
  from = google_bigquery_dataset_iam_member.vm_editor

  lifecycle {
    destroy = false
  }
}

resource "google_project_iam_member" "vm_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.vm.email}"
}
