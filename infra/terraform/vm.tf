resource "google_compute_instance" "app" {
  name         = "${local.prefix}-vm"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["tria-app"]

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = var.boot_disk_gb
      type  = "pd-standard"
    }
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
      project_id   = var.project_id
      prefix       = local.prefix
      app_hostname = var.app_hostname
      n8n_hostname = var.n8n_hostname
      acme_email   = var.acme_email
    })
  }

  allow_stopping_for_update = true

  depends_on = [
    google_secret_manager_secret_iam_member.vm_access,
    google_project_iam_member.vm_logging,
  ]
}
