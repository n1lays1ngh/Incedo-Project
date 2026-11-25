#!/usr/bin/env bash
# One-time local setup: database on port 5433, generated secrets, migrations, and synthetic seed users.
# Safe to run again. Existing secrets and users are kept.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
PGBIN=/opt/homebrew/opt/postgresql@17/bin
PGDATA=/opt/homebrew/var/postgresql@17
PGPORT_LOCAL=5433
CONNECTION="Host=127.0.0.1;Port=$PGPORT_LOCAL;Database=bank_portal;Username=$(whoami)"
API="$ROOT/api/Bank.Api"
CREDS="$ROOT/.dev/seed-credentials.txt"

if ! "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  LC_ALL=en_US.UTF-8 "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT_LOCAL -c listen_addresses=127.0.0.1" -l "$PGDATA/server.log" -w start >/dev/null
fi
if ! "$PGBIN/psql" -w -h 127.0.0.1 -p "$PGPORT_LOCAL" -d postgres -tAc "select 1 from pg_database where datname='bank_portal'" | grep -q 1; then
  "$PGBIN/createdb" -w -h 127.0.0.1 -p "$PGPORT_LOCAL" bank_portal
fi

cd "$ROOT/api"
existing="$(dotnet user-secrets list --project Bank.Api 2>/dev/null || true)"
set_secret() { dotnet user-secrets set "$1" "$2" --project Bank.Api >/dev/null; }
has_secret() { grep -q "^$1 = " <<<"$existing"; }

has_secret "ConnectionStrings:Default" || set_secret "ConnectionStrings:Default" "$CONNECTION"
has_secret "Jwt:Key" || set_secret "Jwt:Key" "$(openssl rand -base64 48)"
has_secret "Crypto:PiiKey" || set_secret "Crypto:PiiKey" "$(openssl rand -base64 32)"

mkdir -p "$ROOT/.dev"
if [ ! -f "$CREDS" ]; then
  DEMO_PASSWORD="Demo$(openssl rand -hex 6)1"
  ADMIN_PASSWORD="Admin$(openssl rand -hex 6)1"
  set_secret "Seed:AdminEmail" "admin@demo.test"
  set_secret "Seed:AdminPassword" "$ADMIN_PASSWORD"
  set_secret "Seed:DemoPassword" "$DEMO_PASSWORD"
  umask 077
  cat >"$CREDS" <<EOF
Local synthetic accounts (git-ignored)
admin@demo.test     $ADMIN_PASSWORD
officer@demo.test   $DEMO_PASSWORD
agent@demo.test     $DEMO_PASSWORD
customer@demo.test  $DEMO_PASSWORD
EOF
fi

dotnet tool restore >/dev/null
dotnet tool run dotnet-ef database update --project Bank.Infrastructure --startup-project Bank.Api --connection "$CONNECTION"
ASPNETCORE_ENVIRONMENT=Development dotnet run --project Bank.Api --no-launch-profile -- --seed

[ -f "$ROOT/web/.env.local" ] || echo "VITE_API_URL=http://localhost:5080" >"$ROOT/web/.env.local"
echo "Setup complete. Sign-in details: $CREDS"
