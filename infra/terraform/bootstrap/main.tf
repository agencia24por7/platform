terraform {
  required_version = ">= 1.9.0"

  backend "gcs" {
    prefix = "bootstrap"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" { type = string }
variable "region" { type = string }
variable "github_repository" {
  description = "No formato dono/repositorio. Só este repositório consegue assumir qualquer identidade."
  type        = string
}

variable "protected_environment" {
  description = "Nome do environment do GitHub exigido para assumir as identidades privilegiadas. Ele precisa ter aprovação manual configurada."
  type        = string
  default     = "producao"
}

locals {
  apis = [
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "iap.googleapis.com",
  ]
}

resource "google_project_service" "bootstrap" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

resource "google_storage_bucket" "state" {
  name                        = "${var.project_id}-tfstate"
  location                    = "US"
  force_destroy               = false
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 20
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_artifact_registry_repository" "app" {
  repository_id = "tria"
  location      = var.region
  format        = "DOCKER"
  description   = "Imagens do app"

  cleanup_policies {
    id     = "apagar-antigas"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "604800s"
    }
  }

  cleanup_policies {
    id     = "manter-recentes"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  depends_on = [google_project_service.bootstrap]
}

resource "google_artifact_registry_repository" "app_orla" {
  repository_id = "orla"
  location      = var.region
  format        = "DOCKER"
  description   = "Imagens do app (ex-tria)"

  cleanup_policies {
    id     = "apagar-antigas"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "604800s"
    }
  }

  cleanup_policies {
    id     = "manter-recentes"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  depends_on = [google_project_service.bootstrap]
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "Identidade federada: nenhuma chave de service account é criada ou guardada."
  depends_on                = [google_project_service.bootstrap]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.ref"         = "assertion.ref"
    "attribute.environment" = "assertion.environment"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "terraform" {
  account_id   = "tria-terraform"
  display_name = "Terraform via GitHub Actions"
  description  = "Aplica a infraestrutura. Só pode ser assumida por execução no ambiente protegido."
}

resource "google_service_account" "planner" {
  account_id   = "tria-terraform-plan"
  display_name = "Terraform plan em pull request"
  description  = "Somente leitura. Serve aos planos de pull request, que rodam sem aprovação."
}

resource "google_service_account" "deployer" {
  account_id   = "tria-deployer"
  display_name = "Deploy do app via GitHub Actions"
  description  = "Publica imagem e reinicia a pilha. Não administra infraestrutura."
}

resource "google_project_iam_member" "terraform" {
  for_each = toset([
    "roles/compute.admin",
    "roles/iam.serviceAccountAdmin",
    "roles/iam.serviceAccountUser",
    "roles/secretmanager.admin",
    "roles/resourcemanager.projectIamAdmin",
    "roles/serviceusage.serviceUsageAdmin",
    "roles/monitoring.notificationChannelEditor",
    "roles/dns.admin",
    "roles/bigquery.admin",
    "roles/storage.admin",
    "roles/cloudkms.admin",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.terraform.email}"
}

resource "google_project_iam_member" "planner" {
  for_each = toset(["roles/viewer", "roles/iam.securityReviewer"])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.planner.email}"
}

resource "google_project_iam_member" "deployer" {
  for_each = toset([
    "roles/artifactregistry.writer",
    "roles/iap.tunnelResourceAccessor",
    "roles/compute.osAdminLogin",
    "roles/compute.viewer",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_storage_bucket_iam_member" "terraform_state" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.terraform.email}"
}

resource "google_storage_bucket_iam_member" "planner_state" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.planner.email}"
}

resource "google_storage_bucket_iam_member" "planner_lock" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.planner.email}"

  condition {
    title       = "apenas arquivos de lock"
    description = "O plano de pull request precisa escrever o lock do Terraform, e nada alem disso."
    expression  = "resource.name.endsWith(\".tflock\")"
  }
}

resource "google_service_account_iam_member" "terraform_wif" {
  service_account_id = google_service_account.terraform.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${var.protected_environment}"
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${var.protected_environment}"
}

resource "google_service_account_iam_member" "planner_wif" {
  service_account_id = google_service_account.planner.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

output "workload_identity_provider" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "Valor do segredo WIF_PROVIDER no GitHub."
}

output "terraform_service_account" {
  value       = google_service_account.terraform.email
  description = "Segredo TF_SERVICE_ACCOUNT. Só funciona em job com environment protegido."
}

output "planner_service_account" {
  value       = google_service_account.planner.email
  description = "Segredo TF_PLAN_SERVICE_ACCOUNT. Somente leitura, usado nos planos de pull request."
}

output "deployer_service_account" {
  value = google_service_account.deployer.email
}

output "state_bucket" {
  value = google_storage_bucket.state.name
}

output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}
