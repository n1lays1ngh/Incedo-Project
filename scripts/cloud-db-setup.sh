#!/usr/bin/env bash
# Applies EF migrations to Neon and seeds the first Admin + synthetic demo users.
# Run after ./scripts/aws-setup.sh, and again after any new migration. Safe to re-run.
# Uses your local AWS login to read SSM; nothing secret is printed or stored in git.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
export AWS_PAGER=""
REGION="${REGION:-ap-southeast-1}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"

# The .NET AWS SDK does not read every CLI login type (e.g. "aws login"), so hand it the
# CLI's current temporary credentials through environment variables for this run only.
eval "$(aws configure export-credentials --format env)"

ssm() { aws ssm get-parameter --name "$1" --with-decryption --query Parameter.Value --output text; }

MIGRATE="$(ssm /bank-portal-ops/ConnectionStrings/Migrate)"
ADMIN_EMAIL="$(ssm /bank-portal-ops/Seed/AdminEmail)"
ADMIN_PASSWORD="$(ssm /bank-portal-ops/Seed/AdminPassword)"
DEMO_PASSWORD="$(ssm /bank-portal-ops/Seed/DemoPassword)"

cd "$ROOT/api"
dotnet tool restore >/dev/null
dotnet tool run dotnet-ef database update --project Bank.Infrastructure --startup-project Bank.Api --connection "$MIGRATE"

# Production settings come from SSM (/bank-portal/), exactly as the Lambda sees them,
# so PAN/Aadhaar in the seeded profile are encrypted with the deployed key.
ASPNETCORE_ENVIRONMENT=Production Ssm__Path=/bank-portal/ \
  Seed__AdminEmail="$ADMIN_EMAIL" Seed__AdminPassword="$ADMIN_PASSWORD" Seed__DemoPassword="$DEMO_PASSWORD" \
  dotnet run --project Bank.Api --no-launch-profile -- --seed

umask 077
cat >"$ROOT/.dev/cloud-credentials.txt" <<EOF
Deployed synthetic accounts (git-ignored)
$ADMIN_EMAIL     $ADMIN_PASSWORD
officer@demo.test   $DEMO_PASSWORD
agent@demo.test     $DEMO_PASSWORD
customer@demo.test  $DEMO_PASSWORD
EOF
echo "Neon migrated and seeded. Sign-in details: .dev/cloud-credentials.txt"
