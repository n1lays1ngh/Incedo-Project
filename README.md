# Bank Portal

A banking web app for savings account and loan applications, with customer, officer, support agent, and admin roles.
The AI support assistant is a separate module and is not built yet.

## Stack

React + TypeScript (Vite), ASP.NET Core on .NET 10, EF Core, and PostgreSQL.
Production targets are Vercel, AWS Lambda, Neon, S3, and SES.

## Local setup

Requires the .NET 10 SDK, Node 22, and Homebrew `postgresql@17`.

```bash
./scripts/dev-setup.sh
```

This starts a local database on port 5433, generates secrets into `dotnet user-secrets`, applies migrations, and seeds synthetic users.
Sign-in details are written to `.dev/seed-credentials.txt`, which git ignores.

## Run

```bash
./scripts/dev-api.sh
```

```bash
npm --prefix web run dev
```

- Web: http://localhost:5173
- API docs: http://localhost:5080/swagger

Locally, S3 and SES are replaced by development-only adapters.
Uploads go to `api/Bank.Api/.dev/storage`, and emails, including signup codes, go to `api/Bank.Api/.dev/outbox.log`.
The API refuses to start with these adapters outside Development.

## Tests

```bash
dotnet test api/Bank.sln
```

## Deploy

See [docs/deploy.md](docs/deploy.md). Two scripts create the AWS resources and prepare the Neon database. GitHub Actions deploys the API on every push to `main`, and Vercel deploys the web app.

## Adding the AI module

Add `POST /agent/tickets/{id}/analyze`, the `AiSuggestions` table, and the `IDecisionModel` and `ILlmClient` interfaces.
The ticket module, agent console, and human-approved reply flow are already in place.
