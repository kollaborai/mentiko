# Smoke Test Suite

Post-deployment smoke tests for the mentiko platform. Run locally or in
CI to verify basic functionality after deployments.

## Quick Start

```bash
# Test local dev server
./scripts/smoke-test.sh

# Test a staging/QA environment
SMOKE_BASE_URL=https://<your-qa-host> ./scripts/smoke-test.sh

# Test production
SMOKE_BASE_URL=https://<your-prod-host> ./scripts/smoke-test.sh

# Advanced version with Puppeteer UI tests
SMOKE_BASE_URL=https://<your-qa-host> node scripts/smoke-test-advanced.mjs
```

## What Gets Tested

| Test | Description | Expected |
|------|-------------|----------|
| Health Check | `/api/health` endpoint | Status: healthy/degraded, database connected |
| API Envelope | Response structure validation | `{success, data, requestId}` present |
| Auth Required | Protected endpoints return 401/302 | `/api/workspaces`, `/api/chains` etc. |
| UI Pages | Page loads without 500 errors | /chains, /agents, /runs, /settings |
| Console Errors | Browser console has no errors | JavaScript runs without issues |
| Terminal Token | WS terminal endpoint available | Returns token or 503 (not running) |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| SMOKE_BASE_URL | `http://localhost:3000` | Target URL to test |
| SMOKE_EMAIL | (none — set for your env) | Login email |
| SMOKE_PASSWORD | (none — set for your env) | Login password |
| SMOKE_OUTPUT_DIR | `./smoke-test-results` | Results directory |
| SMOKE_TIMEOUT | `85` | Max runtime in seconds |
| SMOKE_HEADLESS | `true` | Run headless mode |
| SMOKE_SCREENSHOTS | `true` | Save screenshots |

## Output

Tests produce:

```
smoke-test-results/
  summary.json              # Overall results
  api__health.json          # Health endpoint response
  api_workspaces.json       # Workspace API response
  home.png                  # Home page screenshot
  chains.png                # Chains page screenshot
  agents.png                # Agents page screenshot
  runs.png                  # Runs page screenshot
  settings.png              # Settings page screenshot
```

## CI/CD Integration

### GitHub Actions

Manual dispatch:
```bash
gh workflow run smoke-test.yml -f environment=qa
```

Scheduled: Every hour

On push: Runs on main branch PRs

### Multi-Tenant Integration

If you run the platform as multi-tenant, run smoke tests against each
tenant URL after deployment:

```bash
SMOKE_BASE_URL=https://${tenant_slug}.<your-domain> \
node scripts/smoke-test-advanced.mjs
```

## Performance Target

All tests must complete in **under 90 seconds**.

## Extending Tests

To add a new test:

1. Add function to `scripts/smoke-test-advanced.mjs`
2. Call it from `runTests()` array
3. Use `recordPass()`, `recordFail()`, `recordWarn()` helpers

Example:

```javascript
async function testNewFeature() {
    const response = await apiGet('/new-feature');
    if (response.status === 200) {
        recordPass('New Feature', { status: response.status });
    } else {
        recordFail('New Feature', { status: response.status });
    }
}
```

## Troubleshooting

**Tests timeout**: Check if server is responsive, increase `SMOKE_TIMEOUT`

**Puppeteer fails**: Ensure Chrome dependencies installed, or set `SMOKE_HEADLESS=false`

**Auth tests fail**: Verify test credentials are valid for target environment

**Health check degraded**: Check `/api/health` response for failing service
