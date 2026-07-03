# Secrets Management

Secure credential storage and injection for agent chains.

## Overview

Mentiko provides an encrypted secrets vault for storing API keys, tokens, and other sensitive credentials that agents need at runtime.

## Storage

**Location:** `namespaces/{id}/secrets/` (org-scoped)

**Encryption:** AES-256-GCM with per-namespace keys

**Structure:**
```
secrets/
  .vault-key           # encryption key (never committed)
  openai-api-key       # encrypted secret
  github-token         # encrypted secret
  stripe-secret        # encrypted secret
```

## Usage in Chains

Reference secrets in chain.json using `{SECRET:name}` syntax:

```json
{
  "agents": [{
    "id": "agent-1",
    "env": {
      "OPENAI_API_KEY": "{SECRET:openai-api-key}"
    }
  }]
}
```

**Resolution:**
1. Chain runner reads secret from vault
2. Decrypts using namespace key
3. Injects into agent environment
4. Never logs or exposes in output

## CLI Commands

**List secrets:**
```bash
mentiko secrets list
```

**Add secret:**
```bash
mentiko secrets add openai-api-key
# prompts for value (never echoes)
```

**Remove secret:**
```bash
mentiko secrets remove openai-api-key
```

## Security Model

**Key points:**
- Secrets encrypted at rest
- Never logged in plain text
- Scoped to org (not shared across namespaces)
- Audit trail of secret access

**Best practices:**
- Rotate keys regularly
- Use principle of least privilege
- Never commit `.vault-key`
- Backup encrypted secrets separately

**TODO:** Key rotation workflow, secret versioning, audit logging
