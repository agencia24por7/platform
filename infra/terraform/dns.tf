locals {
  manage_dns  = var.dns_zone_name != ""
  dns_project = var.dns_zone_project != "" ? var.dns_zone_project : var.project_id
}

resource "google_dns_record_set" "app" {
  count = local.manage_dns ? 1 : 0

  project      = local.dns_project
  managed_zone = var.dns_zone_name
  name         = "${var.app_hostname}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_address.app.address]
}

locals {
  caa_autoridades_do_caddy = [
    "0 issue \"letsencrypt.org\"",
    "0 issue \"sectigo.com\"",
    "0 issuewild \";\"",
  ]
}

resource "google_dns_record_set" "app_caa" {
  count = local.manage_dns ? 1 : 0

  project      = local.dns_project
  managed_zone = var.dns_zone_name
  name         = "${var.app_hostname}."
  type         = "CAA"
  ttl          = 3600
  rrdatas      = local.caa_autoridades_do_caddy
}

resource "google_dns_record_set" "n8n_caa" {
  count = local.manage_dns && var.n8n_hostname != "" ? 1 : 0

  project      = local.dns_project
  managed_zone = var.dns_zone_name
  name         = "${var.n8n_hostname}."
  type         = "CAA"
  ttl          = 3600
  rrdatas      = local.caa_autoridades_do_caddy
}

resource "google_dns_record_set" "n8n" {
  count = local.manage_dns && var.n8n_hostname != "" ? 1 : 0

  project      = local.dns_project
  managed_zone = var.dns_zone_name
  name         = "${var.n8n_hostname}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_address.app.address]
}
