# Security Policy

This project is an Apache-2.0 open-source project and currently runs as a **public beta**. Features, APIs, and behavior may evolve while we improve stability and security.

## Supported versions

For now, the team focuses security support on currently active releases tracked by this repository (for example, the latest release and supported branch line). Older versions may not receive security fixes.

If you need a specific support commitment for production use, please verify the release status in the project’s release notes before deploying.

## Reporting security issues

If you believe you found a security issue, please report it **privately** through GitHub’s security advisory flow:

- Use the repository’s `Security` tab and choose **Report a vulnerability**.
- Do **not** include exploit details, payloads, or proof-of-concept code in public issues, pull requests, or chats.

For non-sensitive bugs (for example UI, docs, or performance regressions), use standard GitHub issues.

## What to include

Please include:

- Affected version/commit or branch
- Steps to reproduce or impact summary
- Potential impact and affected component
- Any safe logs or stack traces (redact secrets)

If the issue involves secrets or credentials, do not attach the secret value.

## Dependency and secret handling

- Keep dependencies current and remove or update packages with known vulnerabilities as soon as practical.
- Use dependency lockfiles in code review and CI/automation checks.
- Never commit secrets, tokens, private keys, or environment files.
- Store secrets through your deployment environment/secrets manager, and rotate any credential that may have been exposed.
- If you suspect a secret leak, report it as soon as possible and rotate/revoke immediately.

## Security triage

- Reports are reviewed by repository maintainers.
- We will investigate, prioritize, and coordinate fixes in the project’s private workflow.
- When fixes are released, public release notes will describe the affected versions and upgrade guidance.

