# Docs Coverage (Release Readiness)

## Completed in this slice

- `docs/ENV_VARS.md` now documents `AUDIT_S3_ENDPOINT`, `AUDIT_REMOTE_URL`, `AUDIT_REMOTE_ACCESS_KEY`, and `AUDIT_REMOTE_SECRET_KEY`.
- `docs/PAGE_INDEX.md` now tracks `/settings/audit` and the doc routes linked from app pages:
  - `/docs/audit`
  - `/docs/environment`
  - `/docs/deployment`
  - `/docs/marketplace`
  - `/docs/links`
- `docs/PAGE_INDEX.md` now includes `/marketplace` route pages so route/docs alignment is explicit.
- In-app docs now cover audit logs, deployment checks, environment variables, marketplace, and links.
- Settings now has a dedicated `/settings/audit` audit trail surface.

## Remaining non-blocking gaps

- `docs` section status still does not enumerate all `/docs/*` pages already present under `web/app/docs`; this is informational and non-blocking for release, but should be cleaned up in a later sweep.
- `docs/PAGE_INDEX.md` still has older historical route names such as `/templates/marketplace` and `/agents/marketplace`; the current marketplace implementation lives under `/marketplace/*`.
