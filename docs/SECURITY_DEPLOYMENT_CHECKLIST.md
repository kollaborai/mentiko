# Security Deployment Checklist

## Pre-Deployment Tasks

### 1. Database Migration: linux_username Column
**Status:** ⏳ PENDING

```sql
-- Run in production database
ALTER TABLE "user" ADD COLUMN linux_username TEXT;

-- Review and populate (manual process)
-- Pattern: mentiko_{user_id} or custom linux username
UPDATE "user" SET linux_username = 'mentiko_' || id WHERE linux_username IS NULL;
```

**Verification:**
```sql
SELECT id, email, linux_username FROM "user" WHERE linux_username IS NULL;
-- Should return 0 rows
```

---

### 2. Enable PTY Spawn Enforcement
**Status:** ⏳ PENDING

**File:** `web/app/api/terminal/spawn/route.ts`

**Change lines 49-54 from:**
```typescript
const isVps = process.env.NODE_ENV === "production";
if (isVps && !linuxUser) {
  // TODO: enforce once linuxUsername is populated for all users
  // for now, allow with warning for backwards compatibility
  console.warn(`[terminal/spawn] VPS spawn without linuxUsername for user ${sessionUser.id}. This will be enforced in future.`);
}
```

**To:**
```typescript
const isVps = process.env.NODE_ENV === "production";
if (isVps && !linuxUser) {
  throw new BadRequest("linuxUsername is required for PTY spawn on VPS", {
    field: "linuxUsername",
  });
}
```

**Test after deployment:**
```bash
MENTIKO_BASE_URL=https://<your-prod-host> ./lib/infra/test-pty-spawn-enforcement.sh
```

---

### 3. Infrastructure Hardening on VPS
**Status:** ⏳ PENDING

**On the host running the platform container:**

```bash
# SSH into the VPS
ssh <your-ssh-user>@<your-vps>

# Navigate to the mentiko platform checkout
cd /opt/mentiko

# Run hardening (dry run first)
sudo ./lib/infra/vps-security-hardening.sh

# Review output, then apply
sudo ./lib/infra/vps-security-hardening.sh --apply

# Run verification tests
sudo ./lib/infra/test-security-hardening.sh
```

**Expected test results:**
- ✅ ptrace_scope >= 1
- ✅ sudoers file exists and syntax valid
- ✅ ASLR = 2 (full)
- ✅ core dumps disabled
- ✅ mentiko user exists
- ✅ pty-manager permissions 700
- ✅ ws-token permissions 600

**What gets configured:**
1. Ptrace scope shield (`kernel.yama.ptrace_scope=1`)
2. Sudoers restriction (`/etc/sudoers.d/mentiko`)
3. Full ASLR (`kernel.randomize_va_space=2`)
4. Core dumps disabled (`kernel.core_pattern=|/bin/false`)

---

## Post-Deployment Verification

### 1. Test WebSocket Terminal
- Login as test user
- Open terminal in UI
- Verify token generation works
- Verify PTY spawn succeeds
- Verify output streaming works

### 2. Test Workspace Isolation
- Create workspace with restricted members
- Login as non-member user
- Verify 403 Forbidden on workspace access
- Verify cannot view, update, delete workspace
- Verify cannot access workspace logs, setup

### 3. Test PTY Spawn Enforcement
- Try spawning PTY without linuxUsername in production
- Verify 400 BadRequest with field: linuxUsername
- Verify spawn succeeds with linuxUsername

### 4. Test Multi-User Isolation
- Create two users in same org
- Create workspace with only user1 in members
- Verify user2 cannot access workspace
- Verify user1 can access workspace
- Verify PTY sessions run as correct linux user

---

## Rollback Plan

If issues occur after deployment:

1. **PTY spawn enforcement blocking users:**
   - Revert spawn/route.ts change
   - Users can spawn without linuxUsername (warning only)

2. **Infrastructure hardening breaks services:**
   - Revert sysctl changes:
     ```bash
     sudo sysctl -w kernel.yama.ptrace_scope=0
     sudo sysctl -w kernel.randomize_va_space=1
     echo "core" > /proc/sys/kernel/core_pattern
     ```
   - Remove sudoers file:
     ```bash
     sudo rm /etc/sudoers.d/mentiko
     ```

3. **Workspace access control blocking legitimate access:**
   - Check workspace members array is populated correctly
   - Verify user.id matches members list
   - Temporary fallback: add user to workspace members array

---

## Status Summary

| Task | Status | Priority |
|------|--------|----------|
| linux_username migration | ⏳ Pending | HIGH |
| PTY spawn enforcement | ⏳ Pending | HIGH |
| Infrastructure hardening | ⏳ Pending | HIGH |
| WebSocket terminal tests | ✅ Ready | MEDIUM |
| Workspace isolation tests | ✅ Ready | MEDIUM |

**Overall Status:** ⏳ AWAITING DEPLOYMENT

**Estimated Time:** 1-2 hours (including migration, testing, verification)

**Risk Level:** Medium (rollback procedures documented)
