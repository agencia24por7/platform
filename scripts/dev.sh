#!/bin/sh
set -eu
set -a
. ./.env
set +a
exec npx next dev --port 3000
