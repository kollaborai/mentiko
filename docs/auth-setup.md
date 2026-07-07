# auth setup

mentiko uses better-auth for authentication with multi-tenant support.
For production, set `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` so sessions stay valid across deployment domains.

## overview

better-auth integration provides:
- email/password authentication
- oauth providers (github, google)
- multi-tenant organization isolation
- workspace-scoped access control
- password reset and email verification

## database

better-auth uses sqlite by default:
- location: ~/.mentiko/data/auth.db
- created automatically on first run
- stores users, sessions, organizations, members
- data root is `~/.mentiko`; auth data does not live in `web/data/`.

for production:
- set DATABASE_URL to postgresql connection string
- see production-deployment.md for setup

## signup flow

1. navigate to http://localhost:3200
2. choose "sign up" or "create first account"
3. enter name, email, and a password with at least 12 characters
4. the first user becomes owner/admin of the default workspace
5. successful signup signs you in, redirects to the dashboard, and opens the setup wizard
6. use the same email and password for future sign-ins

## login

email/password:
  - navigate to /login
  - enter email and password
  - session cookie set (7 days)

oauth (github/google):
  - click "continue with github/google"
  - authorize with provider
  - account linked to existing or new org

## environment variables

variable              required  default                    description
DATABASE_URL          no        file:~/.mentiko/data/auth.db    better-auth sqlite db
BETTER_AUTH_SECRET    no        auto-generated           secret for session tokens
BETTER_AUTH_URL       no        http://localhost:3200     canonical url of app

development:
  - DATABASE_URL not required (uses sqlite by default)
  - BETTER_AUTH_SECRET auto-generated
  - BETTER_AUTH_URL defaults to localhost

production:
  - set DATABASE_URL to postgresql connection
  - set strong BETTER_AUTH_SECRET
  - set BETTER_AUTH_URL to production domain

## api authentication

better-auth session cookies are used for web ui api calls.

for programmatic access:
  - use session cookie from login response
  - internal service integrations should use dedicated service secrets (documented in deployment/security docs)

## password reset

1. navigate to /forgot-password
2. enter email address
3. check email for reset link
4. click link, enter new password
5. login with new password

requires email configuration for production.

## email verification

new users must verify email:
1. signup triggers verification email
2. click link in email
3. account verified, full access

can be disabled in development.

## organization model

multi-tenant architecture:
- users can belong to multiple organizations
- namespaces are the tenant/billing boundary
- each namespace can contain multiple organizations
- each organization has isolated org-scoped data inside its namespace
- members have roles: owner, admin, member, guest

role permissions:
  owner  - full control, billing, delete org
  admin  - manage members, settings, chains
  member - create chains, view org data
  guest  - view-only access

## public paths

these paths don't require authentication:
/                      - landing page
/login                 - login page
/signup                - signup page
/forgot-password       - password reset
/api/auth/*           - auth endpoints

## security considerations

- use https in production (secure cookies require it)
- set strong BETTER_AUTH_SECRET (32+ chars)
- rotate secrets periodically
- use environment variables for secrets
- enable 2fa when available (future)

## example: .env.local file

web/.env.local:

```
DATABASE_URL="file:~/.mentiko/data/auth.db"
BETTER_AUTH_SECRET="your-super-secret-key-32-chars-min"
BETTER_AUTH_URL="http://localhost:3200"
```

## example: production env

```
DATABASE_URL="postgresql://user:pass@host:5432/mentiko"
BETTER_AUTH_SECRET="production-secret-key-from-secrets-manager"
BETTER_AUTH_URL="https://mentiko.com"
```

## troubleshooting

signup not working?
  1. check ~/.mentiko/data/auth.db exists or DATABASE_URL set
  2. verify better-auth installed: npm list better-auth
  3. check console for errors
  4. try clearing browser cookies

oauth not working?
  1. verify GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET set
  2. check callback url matches GitHub app settings
  3. same for google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)

database errors?
  1. ensure ~/.mentiko/data directory exists
  2. check write permissions
  3. for postgres, verify connection string is valid

## legacy auth

Legacy single-password auth has been removed. Use Better Auth sessions for web UI and API login.
Use Better Auth session authentication from `/login` for humans and keep internal
service auth on dedicated service-side credentials.

## references

- better-auth docs: https://www.better-auth.com
- better-auth work session: memory/better-auth-work-session.md
- production deployment: memory/production-deployment.md
