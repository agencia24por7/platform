locals {
  prefix = "tria-${var.environment}"

  required_apis = [
    "compute.googleapis.com",
    "secretmanager.googleapis.com",
    "iap.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "billingbudgets.googleapis.com",
    "oslogin.googleapis.com",
    "bigquery.googleapis.com",
    "businessprofileperformance.googleapis.com",
    "mybusinessaccountmanagement.googleapis.com",
    "mybusinessbusinessinformation.googleapis.com",
    "googleads.googleapis.com",
    "analyticsdata.googleapis.com",
    "analyticsadmin.googleapis.com",
    "searchconsole.googleapis.com",
    "youtube.googleapis.com",
    "youtubeanalytics.googleapis.com",
    "tagmanager.googleapis.com",
    "storage.googleapis.com",
    "cloudkms.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each = toset(local.required_apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
