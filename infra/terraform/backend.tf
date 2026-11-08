terraform {
  backend "gcs" {
    prefix = "ambiente/producao"
  }
}
