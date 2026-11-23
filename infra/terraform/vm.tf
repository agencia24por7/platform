resource "google_compute_resource_policy" "backup_dados" {
  name   = "${local.prefix}-backup-dados"
  region = var.region

  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = "06:00"
      }
    }

    retention_policy {
      max_retention_days    = var.backup_retention_days
      on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS"
    }
  }
}

resource "google_compute_disk" "dados" {
  name     = "${local.prefix}-dados"
  zone     = var.zone
  type     = "pd-balanced"
  size     = var.data_disk_gb
  snapshot = var.data_disk_source_snapshot

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [snapshot]
  }
}

resource "google_compute_disk_resource_policy_attachment" "backup_dados" {
  name = google_compute_resource_policy.backup_dados.name
  disk = google_compute_disk.dados.name
  zone = var.zone
}

resource "google_compute_instance" "app" {
  name         = "${local.prefix}-vm"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["tria-app"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-13"
      size  = var.boot_disk_gb
      type  = "pd-balanced"
    }
  }

  attached_disk {
    source      = google_compute_disk.dados.id
    device_name = "dados"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.main.id

    access_config {
      nat_ip = google_compute_address.app.address
    }
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  metadata = {
    enable-oslogin         = "TRUE"
    block-project-ssh-keys = "TRUE"

    startup-script = templatefile("${path.module}/files/startup.sh.tftpl", {
      project_id      = var.project_id
      prefix          = local.prefix
      app_hostname    = var.app_hostname
      n8n_hostname    = var.n8n_hostname
      acme_email      = var.acme_email
      contexto_bucket = google_storage_bucket.contexto.name

      logs_na_nuvem_habilitado          = var.logs_na_nuvem_habilitado
      logs_na_nuvem_chave_apt_impressao = var.logs_na_nuvem_chave_apt_impressao
    })
  }

  allow_stopping_for_update = true

  depends_on = [
    google_secret_manager_secret_iam_member.vm_access,
    google_project_iam_member.vm_logging,
  ]
}
