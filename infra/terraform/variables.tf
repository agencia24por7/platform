variable "project_id" {
  description = "Projeto do Google Cloud dedicado a este ambiente. Use um projeto separado da produção."
  type        = string
}

variable "billing_account_id" {
  description = "Conta de faturamento, usada apenas para criar o alerta de orçamento."
  type        = string
}

variable "region" {
  description = "Região elegível ao free tier do Compute Engine."
  type        = string
  default     = "us-central1"

  validation {
    condition     = contains(["us-west1", "us-central1", "us-east1"], var.region)
    error_message = "O e2-micro sempre grátis só existe em us-west1, us-central1 e us-east1."
  }
}

variable "zone" {
  description = "Zona dentro da região."
  type        = string
  default     = "us-central1-a"
}

variable "machine_type" {
  description = "e2-micro é o único coberto pelo free tier. e2-small custa, mas tem 2 GB de RAM."
  type        = string
  default     = "e2-micro"
}

variable "environment" {
  description = "Nome curto do ambiente, usado como prefixo dos recursos."
  type        = string
  default     = "teste"
}

variable "dns_zone_name" {
  description = "Nome da zona gerenciada no Cloud DNS. Vazio desliga a criação do registro."
  type        = string
  default     = ""
}

variable "dns_zone_project" {
  description = "Projeto onde a zona DNS vive, se for diferente deste."
  type        = string
  default     = ""
}

variable "app_hostname" {
  description = "Nome completo pelo qual o app será acessado. Precisa de HTTPS: IP cru não é aceito como URI de redirecionamento do OAuth."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+\\.[a-z0-9.-]+\\.[a-z]{2,}$", var.app_hostname))
    error_message = "Informe um nome completo, como tria.suaempresa.com.br."
  }
}

variable "n8n_hostname" {
  description = "Nome para a interface do n8n. Vazio mantém o n8n acessível apenas por túnel."
  type        = string
  default     = ""
}

variable "acme_email" {
  description = "E-mail usado pelo Let's Encrypt para avisos de expiração de certificado."
  type        = string
}

variable "budget_amount_usd" {
  description = "Teto mensal do alerta de orçamento, em dólares."
  type        = number
  default     = 10
}

variable "budget_notification_emails" {
  description = "Quem recebe o alerta de orçamento."
  type        = list(string)
  default     = []
}

variable "boot_disk_gb" {
  description = "O free tier cobre 30 GB-mês de disco padrão."
  type        = number
  default     = 30

  validation {
    condition     = var.boot_disk_gb <= 30
    error_message = "Acima de 30 GB o disco deixa de ser coberto pelo free tier."
  }
}
