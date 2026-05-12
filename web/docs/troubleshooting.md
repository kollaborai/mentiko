# Troubleshooting Guide

Common issues, error codes, and solutions.

---

## Quick Diagnosis

### Health Check

First, verify the system is running:

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{"status":"ok","version":"1.0.0"}
```

### Log Locations

| Environment | Log Location |
|-------------|--------------|
| Local dev | Console output |
| Docker | `docker logs mentiko` |
| Systemd | `journalctl -u mentiko` |
| Cloud | Provider's logging service |

---

## Authentication Issues

### "Unauthorized" (401)

**Symptoms:**
- API calls return 401
- Requests redirect to login when session is missing
- Session expires immediately

**Causes & Solutions:**

1. **No active Better Auth session**
   ```bash
   # Sign in at /login (email/password or OAuth)
   # then retry request
   ```

2. **Auth env not configured**
   ```bash
   # Verify production auth vars
   echo $BETTER_AUTH_SECRET
   echo $BETTER_AUTH_URL
   ```

3. **Cookie issues**
   - Clear browser cookies
   - Check browser is accepting cookies
   - Try incognito/private mode

4. **Session check**
   ```bash
   # Verify current session
   curl -s http://localhost:3000/api/auth/me
   ```

### "Session expired"

**Cause:** Session lifetime (7 days default)

**Solution:** Re-login

---

## Chain Issues

### "Failed to generate chain"

**Symptoms:**
- AI generation returns error
- `rawOutput` field shows unparsable text

**Causes & Solutions:**

1. **Missing ANTHROPIC_API_KEY**
   ```bash
   # Add to .env
   ANTHROPIC_API_KEY=sk-ant-...
   ```

2. **Invalid API key**
   - Verify key is valid
   - Check account has credits
   - Regenerate if needed

3. **API rate limit**
   - Wait a few minutes
   - Reduce request frequency

4. **Ambiguous prompt**
   - Be more specific in your description
   - Use example prompts as reference

### "Invalid chain" (Validation errors)

**Common validation codes:**

| Code | Meaning | Fix |
|------|---------|-----|
| `NO_TRIGGERS` | Agent has no triggers | Add `"triggers": ["manual-start"]` |
| `NO_ENTRY_POINT` | No agent can start | Add `manual-start` to first agent |
| `CIRCULAR_DEPENDENCY` | A -> B -> A | Redesign agent flow |
| `INVALID_TARGET` | Branch points to nothing | Fix agent ID in branch |
| `MISSING_SPEC_FILE` | Referenced file missing | Create file or remove reference |

**Example: Fix NO_TRIGGERS**
```json
{
  "agents": [
    {
      "id": "researcher",
      "name": "Researcher",
      "triggers": ["manual-start"],  // ADD THIS
      "emits": "research-complete"
    }
  ]
}
```

### "Failed to save chain"

**Causes:**

1. **Permission denied**
   ```bash
   # Check directory permissions
   ls -la /opt/mentiko/namespaces/default/chains

   # Fix permissions
   chmod 755 /opt/mentiko/namespaces/default/chains
   ```

2. **Disk full**
   ```bash
   # Check disk space
   df -h

   # Clean up old runs if needed
   rm -rf /opt/mentiko/agents/runs/run-old-*
   ```

3. **Invalid JSON**
   - Use JSON validator
   - Check for trailing commas
   - Verify all quotes are matched

---

## Run Issues

### "Failed to start chain"

**Causes:**

1. **Chain file not found**
   ```bash
   # Verify chain exists
   ls /opt/mentiko/namespaces/default/chains/your-chain/chain.json

   # Re-save chain from UI
   ```

2. **CLI not found**
   ```bash
   # Check AGENT_CHAIN_BIN path
   which mentiko

   # Install CLI if missing
   npm install -g @your-org/mentiko
   ```

3. **Missing `manual-start` trigger**
   - At least one agent needs `manual-start` in triggers

### Run stuck in "running" state

**Symptoms:**
- Run shows as running but no progress
- Agents stay in "pending" status

**Causes:**

1. **CLI process hung**
   ```bash
   # Find and kill process
   ps aux | grep mentiko
   kill -9 <PID>

   # Mark run as failed in run.json
   # Edit /opt/mentiko/agents/runs/run-XXX/run.json
   # Change "status": "running" to "status": "cancelled"
   ```

2. **Waiting for event that never fires**
   - Check agent triggers/emits match
   - Verify branch configuration
   - Check validation warnings

3. **Agent timeout not configured**
   ```json
   {
     "agents": [
       {
         "id": "worker",
         "timeout": 300000  // 5 minutes in ms
       }
     ]
   }
   ```

### "Agent failed" during run

**Symptoms:**
- One agent shows error status
- Run stops or continues depending on config

**Diagnosis:**

1. **Check terminal output**
   - Go to run page
   - Click Terminal tab
   - Select the failed agent's session
   - Look for error messages

2. **Check run.json**
   ```bash
   cat /opt/mentiko/agents/runs/run-XXX/run.json
   ```

3. **Common causes:**
   - API rate limits
   - Invalid prompts
   - Missing context files
   - Network issues

---

## Template Issues

### "Template not found"

**Causes:**

1. **Template ID wrong**
   - Use exact template ID from marketplace
   - Case-sensitive

2. **Template file missing**
   ```bash
   # Verify template exists
   ls /opt/mentiko/templates/your-template/

   # Reinstall templates
   cd /opt/mentiko
   ./scripts/install-templates.sh
   ```

### Marketplace shows no templates

**Diagnosis:**
```bash
# Check templates directory
ls /opt/mentiko/templates/

# Check API
curl http://localhost:3000/api/templates/list
```

**Fix:**
- Reinstall templates
- Check file permissions
- Verify TENANT_CONFIG_DIR

---

## Performance Issues

### Slow chain generation

**Symptoms:**
- Generation takes >30 seconds

**Causes:**

1. **Slow API response**
   - Check Anthropic API status
   - Try simpler prompt

2. **Network latency**
   - Check internet connection
   - Consider regional API endpoints

### Slow run execution

**Diagnosis:**
```bash
# Check system resources
top
df -h
```

**Optimizations:**

1. **Use parallel agents**
   ```json
   {
     "branches": {
       "research-complete": ["writer-a", "writer-b", "writer-c"]
     }
   }
   ```

2. **Reduce prompt size**
   - Use context files for large data
   - Reference instead of embed

3. **Increase timeout**
   ```json
   {
     "config": {
       "default_timeout": 300000  // 5 minutes
     }
   }
   ```

### High memory usage

**Symptoms:**
- OOM crashes
- Slow performance

**Solutions:**

1. **Clear old runs**
   ```bash
   # Delete runs older than 7 days
   find /opt/mentiko/agents/runs -name "run-*" -mtime +7 -exec rm -rf {} \;
   ```

2. **Reduce agent count in chain**
   - Split into smaller chains
   - Run sequentially

3. **Increase container memory**
   ```yaml
   # docker-compose.yml
   services:
     web:
       deploy:
         resources:
           limits:
             memory: 2G
   ```

---

## Network Issues

### SSE stream disconnects

**Symptoms:**
- Live updates stop mid-run
- "offline" indicator

**Causes:**

1. **Reverse proxy timeout**
   ```nginx
   # nginx.conf
   location /api/events/stream {
       proxy_read_timeout 3600s;
       proxy_send_timeout 3600s;
   }
   ```

2. **Load balancer idle timeout**
   - Configure keep-alive
   - Increase idle timeout

3. **Client network issues**
   - Check internet connection
   - Try different network

### Webhook not delivered

**Diagnosis:**
```bash
# Check webhook URL is reachable
curl -X POST https://your-server.com/webhook \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

**Common issues:**

1. **URL wrong or unreachable**
   - Verify URL is correct
   - Check server is running
   - Verify firewall allows incoming

2. **SSL certificate issues**
   - Use valid certificates
   - Don't use self-signed in production

3. **Timeout**
   - Webhook handler must respond in <30s
   - Use async processing if needed

---

## Docker Issues

### Container exits immediately

**Diagnosis:**
```bash
docker logs mentiko
```

**Common causes:**

1. **Port already in use**
   ```bash
   # Find process using port 3000
   lsof -i :3000

   # Kill process or change port
   ```

2. **Missing environment variables**
   ```bash
   # Check .env file exists
   ls .env

   # Verify variables
   docker-compose config
   ```

3. **Volume mount issues**
   ```bash
   # Check directories exist
   ls -la ./chains ./agents

   # Fix permissions
   chmod 755 ./chains ./agents
   ```

### Can't access from host

**Check:**
```bash
# Verify container is running
docker ps

# Check port mapping
docker port mentiko

# Test from inside container
docker exec mentiko curl http://localhost:3000/api/health
```

---

## Getting Help

### Before requesting support:

1. Gather information:
   ```bash
   # System info
   uname -a
   node --version
   npm --version

   # App version
   curl http://localhost:3000/api/health

   # Recent logs
   tail -100 /path/to/logs
   ```

2. Reproduce the issue:
   - Note exact steps
   - Record error messages
   - Screenshot if visual

3. Check existing issues:
   - GitHub issues
   - Documentation
   - FAQ

### Debug mode

Enable for more detailed logs:

```bash
# .env
DEBUG=1
VERBOSE_LOGGING=1
```

### Support channels:

- GitHub Issues: https://github.com/your-org/mentiko/issues
- Documentation: https://docs.mentiko.dev
- Discord: https://discord.gg/mentiko

---

## Error Code Reference

| HTTP Code | Meaning | Common Cause |
|-----------|---------|--------------|
| 400 | Bad Request | Invalid JSON, missing fields |
| 401 | Unauthorized | Missing or invalid session |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Internal bug, check logs |
| 503 | Service Unavailable | Overloaded, maintenance |

### Validation Error Codes

See `/api/chains/validate` response codes in API Reference.

### Run Status Codes

| Status | Meaning |
|--------|---------|
| `pending` | Waiting to start |
| `running` | Currently executing |
| `completed` | Finished successfully |
| `failed` | Error occurred |
| `cancelled` | Stopped by user |
