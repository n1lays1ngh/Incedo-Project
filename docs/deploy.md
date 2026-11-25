# Deploying Bank Portal

Free-tier deployment: API on AWS Lambda (function URL), database on Neon, documents in S3, email via SES,
web on Vercel. Secrets live in SSM Parameter Store and never in git.

Do the steps in order. Steps 1–2 need you in a browser. Scripts do the rest.

## 1. Accounts (once)

- **AWS:** create an account and turn on a monthly budget alert (Billing → Budgets → "Zero spend budget").
  Create an IAM user or SSO login for yourself, then on your Mac:
  ```bash
  brew install awscli
  ```
  ```bash
  aws configure
  ```
  Use region `ap-southeast-1` (Singapore), the same region as the Neon project.
- **Neon:** create a project in AWS `ap-southeast-1` and a database `bank_portal`.
  From **Connect**, choose the **.NET** format and copy two strings:
  the **pooled** one (host contains `-pooler`) and the **direct** one (pooling off).
- **GitHub:** push this repo to `main`.
- **Vercel:** sign in with GitHub. The import happens in step 5.

## 2. AWS resources

```bash
SES_FROM=you@example.com ./scripts/aws-setup.sh
```

It asks once for the two Neon strings (input hidden) and creates:

| Resource | Details |
|---|---|
| S3 bucket `bank-portal-kyc-<account>-<region>` | Private, Block Public Access on, CORS for the web origin |
| SSM `/bank-portal/*` | Connection string, JWT key, PII key, bucket, SES sender, CORS origins (read by Lambda) |
| SSM `/bank-portal-ops/*` | Direct connection string and seed passwords (Lambda cannot read these) |
| IAM role `bank-api-lambda` | Only S3 get/put on the bucket, SES send, SSM read of `/bank-portal/*`, KMS decrypt for SSM, logs |
| Lambda `bank-api` | .NET 10, arm64, 1024 MB, 30 s, public function URL, function-URL CORS off |
| SES identity | Sends a verification link to `SES_FROM`. Click it. |
| IAM role `bank-api-github-deploy` | Assumable only by GitHub Actions on this repo's `main`, can only update this function's code |

Outputs go to `.dev/cloud.env` (git-ignored).

SES starts in sandbox, so it only emails verified addresses. To test signup with other inboxes:
`SES_VERIFY="tester@example.com" SES_FROM=you@example.com ./scripts/aws-setup.sh`.

## 3. Database

```bash
./scripts/cloud-db-setup.sh
```

Applies migrations to Neon through the direct connection and seeds the Admin plus synthetic demo users.
Sign-in details are written to `.dev/cloud-credentials.txt`. Re-run after every new migration.

Check: open `<API_URL>health` from `.dev/cloud.env`. It should return `{"status":"ok"}`.

## 4. GitHub Actions

In the repo: **Settings → Secrets and variables → Actions → Variables**, add:

- `AWS_DEPLOY_ROLE_ARN` from `.dev/cloud.env`
- `AWS_REGION`, `ap-southeast-1`

These are not secrets. From now on, every push to `main` that touches `api/` runs the tests and deploys the Lambda.

## 5. Vercel

**Add New → Project →** import this repo.

- Root Directory: `web`
- Framework: Vite (detected)
- Environment variable `VITE_API_URL` = `API_URL` from `.dev/cloud.env`, without the trailing `/`

Deploy, then copy the production domain, for example `https://bank-portal.vercel.app`.

## 6. Allow the web domain

```bash
SES_FROM=you@example.com WEB_ORIGIN=https://bank-portal.vercel.app ./scripts/aws-setup.sh
```

This updates the API's CORS origins and the bucket CORS rule, then restarts the Lambda so it reloads settings.
Vercel preview URLs are not allowed. Test on the production domain.

## 7. Smoke test on the live URLs

1. Log in as each demo user from `.dev/cloud-credentials.txt`.
2. As the customer, upload a file from `demo-data/`. This exercises the presigned S3 upload and CORS.
3. As the officer, open the document. That checks the presigned view link and the audit entry.
4. Register with a verified address and confirm the OTP email arrives.

## Troubleshooting

- **CORS error in the browser:** the domain in step 6 must match exactly, with no trailing slash.
- **500 on every call:** check CloudWatch logs for `/aws/lambda/bank-api`. A missing SSM value names the setting.
- **Upload fails with 403:** the presigned link expired after 5 minutes, or the file type or size differs from what was declared.
- **No email:** the recipient is not verified while SES is in sandbox.
