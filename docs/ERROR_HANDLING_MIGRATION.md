# Error Handling Migration Spec

## Problem
Old inconsistent error patterns:
```typescript
return NextResponse.json({ error: "message" }, { status: 404 });
return NextResponse.json({ error: {...} }, { status: 400 });
throw new Error("leaks stack");
```

## Solution
New typed error classes with consistent shape:
```typescript
throw new NotFound("Plugin", id);
throw new BadRequest("name required", { field: "name" });
throw new Conflict("Workspace already exists");
```

## Migration Pattern

### Step 1: Add imports (top of file)
```typescript
import { NotFound, BadRequest, Conflict, Unauthorized, Forbidden, ValidationError, RateLimitExceeded, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
```

### Step 2: Wrap handler with withErrorHandling
```typescript
// before
export async function GET(request: NextRequest) {
  // ...
}

// after
export const GET = withErrorHandling(async (request: NextRequest, _context: { params: Promise<Record<string, string>> }) => {
  // ...
});
```

### Step 3: Convert error returns to throws
```typescript
// before
if (!plugin) {
  return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
}

// after
if (!plugin) {
  throw new NotFound("Plugin", id);
}
```

### Step 4: Convert validation errors
```typescript
// before
if (!name) {
  return NextResponse.json({ error: "name required" }, { status: 400 });
}

// after
if (!name) {
  throw new BadRequest("name required", { field: "name" });
}
```

### Step 5: Convert success responses
```typescript
// before
return NextResponse.json({ data: result });

// after
return apiSuccess({ data: result });
```

### Step 6: Remove outer try/catch blocks
```typescript
// before
export async function POST(request: NextRequest) {
  try {
    // ... logic
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

// after
export const POST = withErrorHandling(async (request: NextRequest) => {
  // ... logic (no try/catch needed)
  return apiSuccess({ success: true });
});
```

## Error Class Reference

| Class | Code | Status | Usage |
|-------|------|--------|-------|
| BadRequest | BAD_REQUEST | 400 | Invalid input, validation errors |
| Unauthorized | UNAUTHORIZED | 401 | Not authenticated |
| Forbidden | FORBIDDEN | 403 | No permission |
| NotFound | NOT_FOUND | 404 | Resource missing |
| Conflict | CONFLICT | 409 | Duplicate, state conflict |
| ValidationError | VALIDATION_ERROR | 422 | Schema validation |
| RateLimitExceeded | RATE_LIMIT_EXCEEDED | 429 | Rate limit |
| InternalServerError | INTERNAL_SERVER_ERROR | 500 | Server error |

## Edge Cases

### requirePermission early returns
```typescript
// KEEP these, don't convert
const perm = await requirePermission(request, "manage_chains");
if (perm) return perm;
```

### Nested try/catch for non-critical errors
```typescript
// KEEP inner try/catch for non-critical operations
try {
  await bdUpdate(taskId, { status: "running" });
} catch {
  // non-critical: don't fail request
}
```

### Rate limiting with details
```typescript
// before
return NextResponse.json(
  { error: `Limit reached (${limit} active)` },
  { status: 429 }
);

// after
throw new RateLimitExceeded(
  `Concurrent run limit reached (${limit} active). Try again later.`,
  { activeCount, limit }
);
```

## Verification Checklist

After migrating a file:
1. ✓ tsc passes (no type errors)
2. ✓ grep for `return NextResponse.json({ error:` returns nothing
3. ✓ grep for `}, { status: ` returns nothing (except maybe in comments)
4. ✓ all handlers wrapped with withErrorHandling
5. ✓ error classes imported from @/lib/api-errors
6. ✓ apiSuccess imported from @/lib/api-response

## Common Patterns

### 404 with identifier
```typescript
throw new NotFound("Plugin", id);
// -> { code: "NOT_FOUND", message: "Plugin not found", details: { resource: "Plugin", id: "plugin-123" } }
```

### 400 with field details
```typescript
throw new BadRequest("name required", { field: "name" });
// -> { code: "BAD_REQUEST", message: "name required", details: { field: "name" } }
```

### 409 with context
```typescript
throw new Conflict("Chain already exists", { name: chainName });
// -> { code: "CONFLICT", message: "Chain already exists", details: { name: "my-chain" } }
```

### 422 with validation details
```typescript
throw new ValidationError("Invalid chain config", { errors: ["missing agents"] });
// -> { code: "VALIDATION_ERROR", message: "Invalid chain config", details: { errors: [...] } }
```

## Testing

After migration, test the endpoint:
```bash
curl http://localhost:3000/api/endpoint
```

Expected response shape:
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "details": { "resource": "Thing", "id": "123" }
  },
  "requestId": "req_abc123"
}
```

## Files NOT to migrate

- Middleware files (middleware.ts, auth middleware)
- Non-API route files
- Files that don't use NextResponse.json
- Test files

## Summary

1. Add imports (api-errors, api-response)
2. Wrap handler with withErrorHandling
3. Convert error returns to throws
4. Convert validation errors
5. Convert success responses to apiSuccess
6. Remove outer try/catch blocks
7. Keep requirePermission early returns
8. Keep inner try/catch for non-critical ops
9. Verify with tsc + grep

That's it.
