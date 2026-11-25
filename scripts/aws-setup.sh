#!/usr/bin/env bash
# One-time (and re-runnable) AWS setup for the Bank Portal API.
#
# Creates or updates: private KYC bucket + CORS, SSM parameters, the Lambda role (least privilege),
# the Lambda function + public function URL, the SES sender identity, and the GitHub OIDC deploy role.
#
# Usage:
#   SES_FROM=you@example.com ./scripts/aws-setup.sh
#   SES_FROM=you@example.com WEB_ORIGIN=https://your-app.vercel.app ./scripts/aws-setup.sh   # after Vercel exists
#
# Optional: REGION (default ap-southeast-1, same as the Neon project), SES_VERIFY="a@x.com b@y.com"
# (extra addresses to verify while SES is in sandbox).
# Neon connection strings are asked for interactively the first time and never echoed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.dotnet:$PATH" DOTNET_ROOT="$HOME/.dotnet" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
export AWS_PAGER=""

REGION="${REGION:-ap-southeast-1}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"
FUNCTION=bank-api
LAMBDA_ROLE=bank-api-lambda
DEPLOY_ROLE=bank-api-github-deploy
SSM_APP=/bank-portal         # read by the Lambda at startup
SSM_OPS=/bank-portal-ops     # migration + seed secrets, NOT readable by the Lambda
: "${SES_FROM:?Set SES_FROM to the email address that sends OTP and status emails}"
WEB_ORIGIN="${WEB_ORIGIN:-}"

command -v aws >/dev/null || { echo "Install the AWS CLI first: brew install awscli"; exit 1; }
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="bank-portal-kyc-$ACCOUNT-$REGION"
REPO="$(git -C "$ROOT" remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
mkdir -p "$ROOT/.dev"
echo "Account $ACCOUNT, region $REGION, bucket $BUCKET, GitHub repo $REPO"

ORIGINS="http://localhost:5173"
[ -n "$WEB_ORIGIN" ] && ORIGINS="${WEB_ORIGIN%/},$ORIGINS"

# ---------- S3: private bucket, block public access, CORS for browser uploads ----------
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$REGION" = us-east-1 ]; then
    aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
CORS_ORIGINS="$(printf '"%s",' ${ORIGINS//,/ } | sed 's/,$//')"
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "{
  \"CORSRules\": [{ \"AllowedOrigins\": [$CORS_ORIGINS], \"AllowedMethods\": [\"PUT\", \"GET\"],
                    \"AllowedHeaders\": [\"Content-Type\"], \"MaxAgeSeconds\": 600 }]}"
echo "S3 bucket ready"

# ---------- SSM parameters ----------
param_exists() { aws ssm get-parameter --name "$1" >/dev/null 2>&1; }
put_string() { aws ssm put-parameter --name "$1" --type String --value "$2" --overwrite >/dev/null; }
put_secret() { aws ssm put-parameter --name "$1" --type SecureString --value "$2" --overwrite >/dev/null; }
secret_once() { param_exists "$1" || put_secret "$1" "$2"; }
ask_secret() { # name, prompt
  if ! param_exists "$1"; then
    local value
    read -r -s -p "$2: " value; echo
    case "$value" in postgres://*|postgresql://*)
      echo "Use the .NET format from Neon's Connect dialog (Host=...;Database=...), not a postgres:// URL."; exit 1;; esac
    [ -n "$value" ] || { echo "Value required"; exit 1; }
    put_secret "$1" "$value"
  fi
}

ask_secret "$SSM_APP/ConnectionStrings/Default" "Neon POOLED connection string (.NET format)"
ask_secret "$SSM_OPS/ConnectionStrings/Migrate" "Neon DIRECT connection string (.NET format)"
secret_once "$SSM_APP/Jwt/Key" "$(openssl rand -base64 48)"
secret_once "$SSM_APP/Crypto/PiiKey" "$(openssl rand -base64 32)"
put_string "$SSM_APP/Aws/Region" "$REGION"
put_string "$SSM_APP/Aws/KycBucket" "$BUCKET"
put_string "$SSM_APP/Aws/SesFrom" "$SES_FROM"
put_string "$SSM_APP/Cors/AllowedOrigins" "$ORIGINS"

if ! param_exists "$SSM_OPS/Seed/AdminPassword"; then
  put_string "$SSM_OPS/Seed/AdminEmail" "admin@demo.test"
  put_secret "$SSM_OPS/Seed/AdminPassword" "Admin$(openssl rand -hex 8)1"
  put_secret "$SSM_OPS/Seed/DemoPassword" "Demo$(openssl rand -hex 8)1"
fi
echo "SSM parameters ready"

# ---------- Lambda execution role (least privilege) ----------
if ! aws iam get-role --role-name "$LAMBDA_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$LAMBDA_ROLE" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{ "Effect": "Allow", "Principal": { "Service": "lambda.amazonaws.com" }, "Action": "sts:AssumeRole" }]}' >/dev/null
  NEW_ROLE=1
fi
SSM_KEY_ARN="$(aws kms describe-key --key-id alias/aws/ssm --query KeyMetadata.Arn --output text)"
aws iam put-role-policy --role-name "$LAMBDA_ROLE" --policy-name bank-api --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    { \"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\"], \"Resource\": \"arn:aws:s3:::$BUCKET/*\" },
    { \"Effect\": \"Allow\", \"Action\": \"ses:SendEmail\", \"Resource\": \"*\" },
    { \"Effect\": \"Allow\", \"Action\": [\"ssm:GetParameter\", \"ssm:GetParameters\", \"ssm:GetParametersByPath\"],
      \"Resource\": [\"arn:aws:ssm:$REGION:$ACCOUNT:parameter$SSM_APP\", \"arn:aws:ssm:$REGION:$ACCOUNT:parameter$SSM_APP/*\"] },
    { \"Effect\": \"Allow\", \"Action\": \"kms:Decrypt\", \"Resource\": \"$SSM_KEY_ARN\" },
    { \"Effect\": \"Allow\", \"Action\": [\"logs:CreateLogGroup\", \"logs:CreateLogStream\", \"logs:PutLogEvents\"],
      \"Resource\": \"arn:aws:logs:$REGION:$ACCOUNT:log-group:/aws/lambda/$FUNCTION:*\" }
  ]}"
ROLE_ARN="arn:aws:iam::$ACCOUNT:role/$LAMBDA_ROLE"
[ -n "${NEW_ROLE:-}" ] && { echo "Waiting for the new IAM role to propagate..."; sleep 15; }
echo "Lambda role ready"

# ---------- Lambda function ----------
ZIP="$ROOT/.dev/bank-api.zip"
(cd "$ROOT/api" && dotnet tool restore >/dev/null && \
  dotnet lambda package --project-location Bank.Api --output-package "$ZIP" >/dev/null)
ENV_VARS="Variables={Ssm__Path=$SSM_APP/,CONFIG_STAMP=$(date +%s)}"
if ! aws lambda get-function --function-name "$FUNCTION" >/dev/null 2>&1; then
  aws lambda create-function --function-name "$FUNCTION" --runtime dotnet10 --architectures arm64 \
    --handler Bank.Api --role "$ROLE_ARN" --memory-size 1024 --timeout 30 \
    --zip-file "fileb://$ZIP" --environment "$ENV_VARS" >/dev/null
  aws lambda wait function-active-v2 --function-name "$FUNCTION"
else
  aws lambda update-function-code --function-name "$FUNCTION" --zip-file "fileb://$ZIP" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$FUNCTION"
  # A new CONFIG_STAMP forces fresh instances, so changed SSM values (e.g. CORS origins) are picked up.
  aws lambda update-function-configuration --function-name "$FUNCTION" --environment "$ENV_VARS" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$FUNCTION"
fi

# Public function URL. CORS stays OFF here: ASP.NET handles it, and both would send duplicate headers.
if ! aws lambda get-function-url-config --function-name "$FUNCTION" >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name "$FUNCTION" --auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$FUNCTION" --statement-id public-url \
    --action lambda:InvokeFunctionUrl --principal "*" --function-url-auth-type NONE >/dev/null
  aws lambda add-permission --function-name "$FUNCTION" --statement-id public-url-invoke \
    --action lambda:InvokeFunction --principal "*" --invoked-via-function-url >/dev/null
fi
API_URL="$(aws lambda get-function-url-config --function-name "$FUNCTION" --query FunctionUrl --output text)"
echo "Lambda ready at $API_URL"

# ---------- SES (sandbox: sender and every recipient must be verified) ----------
for address in $SES_FROM ${SES_VERIFY:-}; do
  if ! aws sesv2 get-email-identity --email-identity "$address" >/dev/null 2>&1; then
    aws sesv2 create-email-identity --email-identity "$address" >/dev/null
    echo "SES sent a verification link to $address. Click it before testing emails."
  fi
done

# ---------- GitHub Actions deploy role (OIDC, no stored AWS keys) ----------
OIDC_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
fi
TRUST="{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{ \"Effect\": \"Allow\", \"Principal\": { \"Federated\": \"$OIDC_ARN\" },
    \"Action\": \"sts:AssumeRoleWithWebIdentity\",
    \"Condition\": {
      \"StringEquals\": { \"token.actions.githubusercontent.com:aud\": \"sts.amazonaws.com\",
                         \"token.actions.githubusercontent.com:sub\": \"repo:$REPO:ref:refs/heads/main\" } } }]}"
if aws iam get-role --role-name "$DEPLOY_ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$DEPLOY_ROLE" --policy-document "$TRUST"
else
  aws iam create-role --role-name "$DEPLOY_ROLE" --assume-role-policy-document "$TRUST" >/dev/null
fi
aws iam put-role-policy --role-name "$DEPLOY_ROLE" --policy-name deploy-bank-api --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{ \"Effect\": \"Allow\",
    \"Action\": [\"lambda:UpdateFunctionCode\", \"lambda:GetFunction\", \"lambda:GetFunctionConfiguration\"],
    \"Resource\": \"arn:aws:lambda:$REGION:$ACCOUNT:function:$FUNCTION\" }]}"

cat >"$ROOT/.dev/cloud.env" <<EOF
API_URL=$API_URL
AWS_REGION=$REGION
AWS_DEPLOY_ROLE_ARN=arn:aws:iam::$ACCOUNT:role/$DEPLOY_ROLE
KYC_BUCKET=$BUCKET
EOF

echo
echo "Done. Values for the next steps are in .dev/cloud.env:"
cat "$ROOT/.dev/cloud.env"
echo "Next: ./scripts/cloud-db-setup.sh (migrate + seed Neon), then GitHub variables, then Vercel."
