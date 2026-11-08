resource "google_monitoring_notification_channel" "budget" {
  for_each = toset(var.budget_notification_emails)

  display_name = "Orçamento ${var.environment} · ${each.value}"
  type         = "email"

  labels = {
    email_address = each.value
  }

  depends_on = [google_project_service.required]
}

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account_id
  display_name    = "${local.prefix}-orcamento"

  budget_filter {
    projects = ["projects/${data.google_project.current.number}"]
  }

  amount {
    specified_amount {
      units = tostring(var.budget_amount)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]

    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  all_updates_rule {
    monitoring_notification_channels = [for channel in google_monitoring_notification_channel.budget : channel.id]
    disable_default_iam_recipients   = false
  }

  depends_on = [google_project_service.required]
}

data "google_project" "current" {
  project_id = var.project_id
}
