#!/usr/bin/env bash
# Starts the local database if needed, then runs the API on http://localhost:5080.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
PGBIN=/opt/homebrew/opt/postgresql@17/bin
PGDATA=/opt/homebrew/var/postgresql@17

if ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  LC_ALL=en_US.UTF-8 "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p 5433 -c listen_addresses=127.0.0.1" -l "$PGDATA/server.log" -w start >/dev/null
fi

cd "$ROOT/api"
exec dotnet run --project Bank.Api --launch-profile http
