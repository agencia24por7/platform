# Cofre de tokens das conexões (ADR 0032).
#
# O app guarda o segredo de longa duração de cada conexão (refresh token do Google, token de
# longa duração da Meta, chave de API) cifrado por envelope na tabela
# integrations.connection_tokens: uma chave de dados AES-256 por registro, embrulhada por esta
# chave do KMS com AAD = conexão + plataforma + finalidade. O KMS nunca vê o token, só a chave de
# dados; o Postgres nunca vê nada em claro.
#
# A localização é a região da VM: o startup deriva o nome da chave a partir da zona da instância
# (files/startup.sh.tftpl), então anel e chave seguem a convenção fixa abaixo.

locals {
  tokens_key_ring_name = "${local.prefix}-tokens"
  tokens_key_name      = "conexoes"
}

resource "google_kms_key_ring" "tokens" {
  name     = local.tokens_key_ring_name
  location = var.region

  depends_on = [google_project_service.required]
}

resource "google_kms_crypto_key" "tokens" {
  name     = local.tokens_key_name
  key_ring = google_kms_key_ring.tokens.id
  purpose  = "ENCRYPT_DECRYPT"

  # 90 dias. Versões antigas continuam decifrando; o app grava a versão usada em kms_key_version
  # e um job de recifragem (fase 2) migra os registros antes de qualquer desativação de versão.
  rotation_period = "7776000s"

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }

  labels = {
    ambiente = var.environment
    uso      = "cofre-de-tokens"
  }

  # Destruir a chave torna irrecuperável todo token guardado: só por decisão explícita, fora do plano.
  lifecycle {
    prevent_destroy = true
  }
}

# Privilégio mínimo: a VM cifra e decifra só com esta chave. Nada de papel no projeto nem no anel.
resource "google_kms_crypto_key_iam_member" "vm_tokens" {
  crypto_key_id = google_kms_crypto_key.tokens.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.vm.email}"
}

# Cada Encrypt/Decrypt vira um log de Data Access: quem decifrou, quando, com qual versão.
resource "google_project_iam_audit_config" "cloudkms_access" {
  project = var.project_id
  service = "cloudkms.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
  audit_log_config {
    log_type = "ADMIN_READ"
  }
}

output "tokens_kms_key" {
  description = "Chave do cofre de tokens. Chega ao app como TOKENS_KMS_KEY (derivada no startup pela região da VM)."
  value       = google_kms_crypto_key.tokens.id
}
