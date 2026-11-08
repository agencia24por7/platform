#!/bin/sh
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD ausente}"
: "${WORKER_DB_PASSWORD:?WORKER_DB_PASSWORD ausente}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --set app_password="$APP_DB_PASSWORD" --set worker_password="$WORKER_DB_PASSWORD" \
  --set db_name="$POSTGRES_DB" <<'SQL'
CREATE ROLE tria_app LOGIN PASSWORD :'app_password';
CREATE ROLE tria_worker LOGIN PASSWORD :'worker_password';

REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO tria_app, tria_worker;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER DATABASE :"db_name" SET row_security = on;
SQL
