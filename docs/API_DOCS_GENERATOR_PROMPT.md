# API Documentation Generator

You are tasked with generating comprehensive API documentation for a codebase. You will create two documents:

1. **API_INDEX.md** - Complete catalog of all API routes with usage data
2. **API_AUDIT_REPORT.md** - Accuracy audit findings and action items

---

## Phase 1: Scan and Catalog Endpoints

1. Find all API route files:
   ```bash
   find web/app/api -type f -name "route.ts" | sort
   ```

2. For each route file, extract:
   - Method (GET/POST/PUT/PATCH/DELETE)
   - Path (including dynamic segments like [id])
   - What it returns / purpose (from route handler logic)
   - Data source (filesystem path, database, external API, in-memory)
   - Request parameters (query params, body fields)
   - Authentication requirements (checkAuth, RBAC, public, etc.)

3. Read each route.ts file to understand implementation:
   - Check for `export async function METHOD()` handlers
   - Look for auth middleware calls (`checkAuth()`, `requirePermission()`, etc.)
   - Identify data sources (filesystem reads, database queries, external fetches)
   - Note any side effects (audit logging, webhook firing, etc.)

---

## Phase 2: Scan Frontend for Usage

1. Search the frontend codebase for API calls:
   ```bash
   # Find fetch calls
   grep -r "fetch.*api/" web/ --include="*.ts" --include="*.tsx"

   # Find useSWR/useQuery hooks
   grep -r "useSWR\|useQuery\|useFetch" web/ --include="*.ts" --include="*.tsx"

   # Find direct API route strings
   grep -r '"/api/' web/ --include="*.ts" --include="*.tsx" | grep -v node_modules
   ```

2. For each API endpoint found, note:
   - Which component/screen uses it
   - Hook or utility that wraps it
   - File path and component name

3. Build a mapping: Endpoint → List of Screens/Components

---

## Phase 3: Generate API_INDEX.md

Create a markdown file with this structure:

```markdown
# {Project Name} API Index

Complete catalog of all API routes in the platform.

Generated: {date}

---

## Contents
- Link to each major section

---

## {Section Name} (e.g., Agents, Chains, Runs)

| Method | Path | Purpose | Data Source | Params | Auth | Used? | Screen/Component |
|--------|------|---------|-------------|--------|------|-------|------------------|
| ... | ... | ... | ... | ... | ... | Yes/No | component names |
```

### Column Definitions:

- **Method**: HTTP verb (GET/POST/PUT/PATCH/DELETE)
- **Path**: API route path
- **Purpose**: What the endpoint does (1-2 sentences)
- **Data Source**: Where data comes from (filesystem path, DB, external API, in-memory)
- **Params**: Query params, path params, or body fields (abbreviated)
- **Auth**: Authentication requirement (checkAuth, view_chains, manage_chains, public, etc.)
- **Used?**: Yes/No - whether frontend calls this endpoint
- **Screen/Component**: Which UI components use it (comma-separated, abbreviated)

### Abbreviation Rules for Component Names:

- Drop `web/` prefix
- Shorten common paths:
  - `app/(workflows)/` → (workflows)/
  - `components/` →
  - `hooks/` →
  - `lib/` →
- Shorten component names:
  - `WorkspacesPage` → workspaces page
  - `WorkspaceDetailPage` → workspace detail
  - `ConversationDetailPage` → conversations/[id]
  - `RunDetailPanel` → run detail panel
  - `ChainDetailPanel` → chain detail panel
  - `FloatingTerminalPanel` → floating terminal
  - `WorkspaceTerminal` → workspace terminal

---

## Phase 4: Audit for Accuracy

For each endpoint, verify:

1. **Documentation Accuracy**: Does the documented purpose match the code?
2. **Data Source Accuracy**: Is the data source correctly described?
3. **Auth Accuracy**: Is the auth requirement correct?
4. **Missing Endpoints**: Are there endpoints in code but not documented?
5. **Incorrect Info**: Any contradictions between docs and code?

### Categories:

- **Correct**: Everything matches
- **Incorrect**: Doc doesn't match code (specific issue noted)
- **Missing**: Exists in code but not in docs
- **Questionable**: Needs clarification (noted)

---

## Phase 5: Generate API_AUDIT_REPORT.md

Create a markdown report with:

### Executive Summary
- Total endpoints, correct count, incorrect count, missing count
- Accuracy percentage

### Critical Findings
- Missing endpoints (if any)
- Broken/conflicting documentation
- Security concerns (unauthenticated endpoints that shouldn't be)
- Data source inconsistencies
- Auth documentation issues

### Detailed Issues by Section
- Table of issues with severity (Critical/High/Medium/Low)
- Specific recommendations for fixes

### Cleanup Candidates
- Endpoints that exist but have no UI caller
- Potential deprecated endpoints
- Server-only vs frontend endpoints

### Recommendations
- High priority fixes needed
- Medium priority improvements
- Low priority nice-to-haves

---

## Output Format

Save files to:
- `docs/API_INDEX.md`
- `docs/API_AUDIT_REPORT.md`

---

## Key Checks to Perform

### Security Issues to Flag:
- Endpoints with no auth that should have it
- Endpoints exposed to public that shouldn't be
- Sensitive operations without proper permissions

### Common Issues to Look For:
- Namespace path mismatches (common in this codebase)
- Auth simplification (docs say "checkAuth" but code uses RBAC)
- Side effects not documented (audit logging, webhook firing)
- Fallback behavior not documented
- Data source paths missing namespace prefix

### Usage Patterns:
- Server-only endpoints (webhooks, internal APIs)
- Internal endpoints (called by other APIs, not frontend)
- Frontend-only endpoints
- Deprecated endpoints (replaced by newer versions)
- Future features (API exists but UI not implemented)

---

## Notes

- Be thorough but concise
- Focus on actionable findings
- Prioritize security and accuracy issues
- Group related issues together
- Provide specific file paths for issues found

---

*Run this documentation generator whenever:*
- New API endpoints are added
- Significant refactoring occurs
- Before releases
- When API documentation gets stale
