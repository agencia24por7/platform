resource "google_compute_network" "main" {
  name                    = "${local.prefix}-vpc"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "main" {
  name                     = "${local.prefix}-subnet"
  ip_cidr_range            = "10.10.0.0/24"
  region                   = var.region
  network                  = google_compute_network.main.id
  private_ip_google_access = true
}

resource "google_compute_address" "app" {
  name         = "${local.prefix}-ip"
  region       = var.region
  address_type = "EXTERNAL"
  description  = "IP estável para o nome público do app. Necessário porque o Google não aceita IP cru como URI de redirecionamento, e porque a saída para a Graph API do Meta não passa por Private Google Access."
}

resource "google_compute_firewall" "web" {
  name        = "${local.prefix}-allow-web"
  network     = google_compute_network.main.name
  description = "Único caminho público: 80 e 443, atendidos pelo proxy reverso."

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["tria-app"]
}

resource "google_compute_firewall" "iap_ssh" {
  name        = "${local.prefix}-allow-iap-ssh"
  network     = google_compute_network.main.name
  description = "SSH apenas pelo range do IAP. Nenhum serviço da pilha publica porta no host: o acesso passa pelo proxy, que exige sessão."

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["tria-app"]
}

resource "google_compute_firewall" "deny_all_ingress" {
  name        = "${local.prefix}-deny-ingress"
  network     = google_compute_network.main.name
  description = "Fecha o resto da entrada de forma explícita, com prioridade mais baixa que as regras acima."
  priority    = 65000
  direction   = "INGRESS"

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
}
