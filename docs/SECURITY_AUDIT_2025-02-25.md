# mentiko security audit

**date:** 2025-02-25
**scope:** full codebase (bash scripts + typescript web ui)
**issues found:** 60 total

---

## summary by severity

| severity | count | status |
|----------|-------|--------|
| critical | 6 | fix immediately |
| high | 18 | fix this week |
| medium | 24 | fix next sprint |
| low | 12 | technical debt |

---

## critical (fix immediately)

### 1. lib/webhook-sender.sh:146
**type:** command injection
**issue:** `eval "$curl_cmd"` - curl command built from user input
```bash
eval "$curl_cmd"
```
**impact:** attacker can execute arbitrary commands via webhook url/headers
**fix:**
```bash
# use jq to build json, curl with explicit args
curl -s -X POST "$url" \
  -H "Content-Type: application/json" \
  -d "$payload_json"
```

### 2. lib/webhook-sender.sh:121-130
**type:** command injection
**issue:** curl_cmd string concatenation then eval'd
```bash
curl_cmd="curl -s -X POST ${url} ${headers}"
```
**impact:** url/headers fully controlled by attacker
**fix:** build json with jq, pass url/headers as separate arguments to curl

### 3. lib/chain-runner.sh:142
**type:** command injection
**issue:** `$(ssh_prefix)` - unquoted command substitution
```bash
local ssh_prefix=$(ssh_prefix)
```
**impact:** ssh_user/ssh_host injectable via environment variables
**fix:**
```bash
local ssh_prefix
ssh_prefix=$(ssh_prefix) || return 1
```

### 4. lib/chain-runner.sh:158
**type:** command injection
**issue:** user-controlled vars in ssh command
```bash
$(ssh_prefix) -t "cd '$SSH_PATH' && $cmd"
```
**impact:** SSH_PATH and cmd are user-controlled
**fix:** quote and validate all variables, use whitelist for allowed commands

### 5. web/app/api/auth/login/route.ts:44
**type:** command injection
**issue:** execAsync with ip/user in command string
```typescript
const cmd = `cd "${AGENT_CHAIN_ROOT}" && source lib/config.sh && source lib/audit-log.sh 2>/dev/null && audit-log-auth "${event}" "${user}" "${ip}" "${status}" ${detailsPart}`;
await execAsync(cmd, { env: { ...process.env, AUDIT_SOURCE: "web", AUDIT_IP: ip } })
```
**impact:** x-forwarded-for header can inject commands
**fix:** validate/sanitize ip before using in command

### 6. web/app/api/chains/run/route.ts:26
**type:** command injection
**issue:** metadata from chain.json used in shell command
```typescript
const cmd = `cd "${config.root}" && source lib/config.sh && source lib/audit-log.sh 2>/dev/null && audit-log "${eventType}" "${description}" ${metadataPairs}`;
```
**impact:** chain name/values can inject into audit-log command
**fix:** escape all metadata values before shell use

---

## high severity

### 7. lib/chain-runner.sh:173
**type:** crash potential
**issue:** `sed "s/^${PROJECT_NAME}-//"` - PROJECT_NAME may be empty
**fix:** `"${PROJECT_NAME:-}-"`

### 8. lib/chain-runner-complete.sh:187
**type:** crash potential
**issue:** sed with empty CHAIN_SESSION_PREFIX
**fix:** `"${CHAIN_SESSION_PREFIX:-chain}-"`

### 9. lib/error-handling.sh:71
**type:** data corruption
**issue:** sed on STATE_FILE without validation
**impact:** can corrupt state if regex fails to match
**fix:** validate before sed, use temp file + atomic mv

### 10. lib/metrics.sh:46
**type:** platform incompatibility
**issue:** `date +%s%N` - nanoseconds not supported on macOS
**impact:** breaks all timing functions on mac
**fix:**
```bash
if [[ "$(uname)" == "Darwin" ]]; then
  date +%s000000000
else
  date +%s%N
fi
```

### 11. lib/metrics.sh:101
**type:** platform incompatibility
**issue:** md5sum not available on macOS
**fix:** use `md5` on mac, `md5sum` on linux

### 12. lib/integrations.sh:105
**type:** xss potential
**issue:** issue_payload built with string concatenation
**fix:** use jq to build json

### 13. lib/scheduler.sh:277
**type:** crash potential
**issue:** `date -r "$timestamp"` - expects file path on mac, timestamp on linux
**fix:** detect platform and use appropriate date command

### 14. lib/git-integration.sh:302
**type:** data loss risk
**issue:** `git reset --hard` without warning
**impact:** uncommitted work lost
**fix:** check for uncommitted changes first, warn user

### 15. web/lib/websocket.ts:442-446
**type:** react hook bug
**issue:** useEffect with empty deps, stale closure on options.runId
**fix:** add options.runId to dependency array

### 16. web/lib/api.ts:68-69
**type:** unhandled exception
**issue:** JSON.parse without try/catch
**fix:**
```typescript
try {
  return await response.json();
} catch (e) {
  throw new Error('Invalid JSON response');
}
```

### 17. web/lib/auth.ts:34
**type:** insecure storage
**issue:** password stored directly in cookie
**impact:** cookie compromise = full access
**fix:** store session token hash, not actual password

### 18. web/lib/shell.ts:35
**type:** command injection (mitigated)
**issue:** execTmux accepts arbitrary command string
**note:** has whitelist but prefix check bypassable. all sessions now use
pty-manager (bin/p). execTmux removed.
**fix:** parse command structure more strictly

### 19. web/app/api/chains/run/route.ts:106
**type:** command injection (partial)
**issue:** chainPath from user-controlled chain.name
**fix:** validate chain.name against whitelist before use

### 20. lib/chain-runner.sh:586-589
**type:** error handling
**issue:** session creation without error check (migrated from tmux to pty-manager)
**fix:** check $? after p create command

### 21. web/lib/sync-queue.ts:198
**type:** missing import
**issue:** useState used before import at line 231
**fix:** move import to top of file

### 22. web/lib/push-notifications.ts:5
**type:** missing env validation
**issue:** PUBLIC_VAPID_KEY empty = silent failure
**fix:** log warning if vapid key missing

### 23. lib/chain-runner-complete.sh:349
**type:** error handling
**issue:** mktemp without error check
**fix:** check mktemp succeeded before using file

### 24. web/app/api/agents/[session]/message/route.ts:50
**type:** incomplete validation
**issue:** escapeShellMessage doesn't handle newlines
**fix:** escape or reject newlines in messages

---

## medium severity

### 25. lib/webhook-sender.sh:64
**type:** resource leak
**issue:** temp file not cleaned on error
**fix:** use trap to ensure cleanup

### 26. lib/error-handling.sh:190-195
**type:** resource leak
**issue:** `disown $!` - orphaned processes
**fix:** track background jobs, cleanup on exit

### 27. lib/slack-integration.sh:129
**type:** xss potential
**issue:** json built via string concat
**fix:** use jq

### 28. lib/slack-integration.sh:200
**type:** resource leak
**issue:** curl without timeout
**fix:** add --max-time 30

### 29. lib/scheduler.sh:357
**type:** resource leak
**issue:** background jobs in daemon without tracking
**fix:** implement job tracking table

### 30. lib/git-integration.sh:389
**type:** data loss risk
**issue:** git stash without verification
**fix:** verify stash succeeded before proceeding

### 31. lib/chain-generator.sh:145
**type:** error swallowing
**issue:** `2>/dev/null || echo ""` hides errors
**fix:** capture stderr for logging

### 32. lib/chain-generator.sh:148
**type:** parsing fragility
**issue:** sed extraction of json from ai output
**fix:** use jq for json extraction

### 33. web/lib/state-store.ts:274
**type:** parsing bug
**issue:** version parsing assumes semver
**fix:** handle invalid versions gracefully

### 34. web/lib/state-store.ts:433
**type:** silent data loss
**issue:** notifications truncated at 200 without warning
**fix:** notify user when truncating

### 35. web/lib/event-bus.ts:496
**type:** unhandled promise rejection
**issue:** result.catch() only logs, doesn't propagate
**fix:** provide error callback option

### 36. web/lib/security.ts:113
**type:** resource leak
**issue:** setInterval in RateLimiter constructor
**fix:** add cleanup method for timer

### 37. web/lib/security.ts:128
**type:** validation bypass
**issue:** split(",")[0] on x-forwarded-for
**note:** can be spoofed, single ip assumed
**fix:** validate all ips in chain

### 38. web/lib/xss.ts:36-40
**type:** bypass potential
**issue:** tag whitelist regex allows any tag content
**fix:** use proper html sanitizer like dompurify

### 39. web/lib/api.ts:89-98
**type:** resource leak
**issue:** getReader() without cleanup on error
**fix:** use try/finally to close reader

### 40. web/lib/api-auth.ts:4-12
**type:** weak typing
**issue:** any[] spread loses type safety
**fix:** use proper generic types

### 41. web/lib/notifications-store.ts:47
**type:** corruption risk
**issue:** JSON.parse from localStorage without validation
**fix:** validate json structure before use

### 42. web/lib/sync-queue.ts:32
**type:** corruption risk
**issue:** localStorage JSON without validation
**fix:** validate queued request structure

### 43. lib/chain-runner-complete.sh:631
**type:** error handling
**issue:** scp without error check
**fix:** check scp exit code

### 44. lib/chain-runner-complete.sh:639
**type:** error handling
**issue:** docker cp without error check
**fix:** check exit code

### 45. lib/validate.sh:66-88
**type:** missing dependency
**issue:** node required but availability not checked
**fix:** check for node before attempting to use

### 46. lib/validate.sh:92
**type:** resource leak
**issue:** mktemp without trap cleanup
**fix:** add trap for cleanup

### 47. lib/metrics.sh:72
**type:** integer overflow
**issue:** duration calculation can overflow
**fix:** use bc for arbitrary precision

### 48. lib/error-handling.sh:164
**type:** crash potential
**issue:** grep on report_file without existence check
**fix:** check file exists before grep

---

## low severity

### 49. web/lib/websocket.ts:216
**type:** error swallowing
**issue:** `catch {}` ignores all errors
**fix:** log errors for debugging

### 50. web/lib/websocket.ts:300
**type:** error swallowing
**issue:** `catch {}` in listeners
**fix:** add error handler parameter

### 51. web/lib/xss.ts:4-5
**type:** redundancy
**issue:** `if (!unsafe) return ""` - empty string is harmless
**fix:** remove unnecessary check

### 52. web/lib/xss.ts:15-17
**type:** incomplete escaping
**issue:** escapeJs doesn't handle backticks
**fix:** add backtick escaping

### 53. web/lib/security.ts:217
**type:** overly restrictive
**issue:** sanitizeShellInput allows very limited charset
**fix:** expand allowed chars based on use case

### 54. web/lib/security.ts:243
**type:** path traversal incomplete
**issue:** filter(Boolean) removes "false" but not ".."
**fix:** explicitly filter ".." segments

### 55. web/lib/auth.ts:12-14
**type:** confusing logic
**issue:** legacy no-password bypass flag can evaluate true
**fix:** add explicit DEV_MODE flag

### 56. web/lib/push-notifications.ts:150
**type:** nonstandard event
**issue:** "notificationpermissionchange" not standard
**fix:** use permission api polling instead

### 57. lib/chain-generator.sh:116
**type:** brittle parsing
**issue:** jq extraction assumes exact structure
**fix:** add fallback values

### 58. lib/chain-generator.sh:119
**type:** brittle parsing
**issue:** assumes agent names are simple strings
**fix:** handle complex agent names

### 59. lib/validate.sh:22
**type:** confusing error
**issue:** "validation failed" for all errors
**fix:** provide specific error messages

### 60. lib/metrics.sh:146
**type:** brittle format
**issue:** assumes ps output format
**fix:** use ps with specified format options

---

## recommended fix order

### phase 1: critical (do now)
1. fix all eval injections (webhook-sender.sh)
2. quote all shell variables (chain-runner.sh ssh calls)
3. validate/escape api route shell inputs

### phase 2: high (this week)
1. add null defaults to bash variable expansions
2. fix platform compatibility (date, md5sum)
3. fix react useEffect dependencies
4. add try/catch around JSON.parse

### phase 3: medium (next sprint)
1. audit all resource cleanup
2. add input validation for json building
3. validate localStorage json
4. add error propagation to event bus

### phase 4: low (technical debt)
1. replace empty catch blocks with logging
2. standardize error messages
3. add shellcheck to ci pipeline

---

## prevention

1. **add shellcheck** to pre-commit hooks
2. **add eslint** with security plugins
3. **add dependency scanning** for known vulnerabilities
4. **add input validation** middleware for all api routes
5. **add rate limiting** to all auth endpoints (already partial)
6. **add audit logging** for all admin actions (partial)
