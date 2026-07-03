# Production Monitoring

Monitoring and observability for agent chains in production.

## Overview

Agent chains require monitoring for execution health, output quality, resource usage, and business metrics.

## Metrics

### Execution Health

**Run Success Rate:**
- Percentage of chains completing successfully
- Target: 95%+
- Calculation: successful runs / total runs

**Run Duration:**
- Track P50, P95, P99 latency percentiles
- Identify slow-running chains
- Detect performance regressions

**Agent Timing:**
- Per-agent duration breakdown
- Identify bottleneck agents
- Track agent-specific trends

**Queue Depth:**
- Scheduled runs waiting
- Backlog indicator
- Capacity planning signal

**Skipped Runs:**
- Overlap prevention rate
- Resource contention signal

### Output Quality

**Validation Metrics:**
- Schema validation pass rate
- Property-based test pass rate
- Regression detection rate

**Quality Metrics:**
- Output length distributions
- Format compliance rate
- Placeholder/incomplete content detection

**Model Behavior:**
- Token usage per agent type
- Cost per run
- Model-specific error rates

### Resource Usage

**PTY Sessions:**
- Active session count
- Session duration
- Memory usage per session

**Disk Space:**
- Event file growth rate
- Output artifact size
- Workspace storage usage

**System Resources:**
- CPU usage during chain execution
- Memory usage trends
- I/O bandwidth

## Implementation

### Metrics Collection

**Chain Runner:**
```bash
# chain-runner.sh records metrics
echo "$(date -Isec),$chain_id,$agent_id,$duration,$status" >> /var/log/mentiko/metrics.csv
```

**pty-manager:**
```bash
# Record session allocation
echo "$(date -Isec),$session_id,$agent_id,allocated" >> /var/log/mentiko/sessions.csv
```

### Monitoring Stack

**Logs:**
```bash
# System logs
journalctl -u mentiko -f

# Chain logs
tail -f namespaces/default/logs/chains.log

# PTY session logs
tail -f /var/log/pty-manager.log
```

**Metrics Files:**
- `/var/log/mentiko/metrics.csv` - Execution metrics
- `/var/log/mentiko/sessions.csv` - Session metrics
- `/var/log/mentiko/errors.log` - Error events

### Health Checks

```bash
# Health endpoint
curl http://localhost:3000/api/health

# Expected response
{
  "status": "ok",
  "version": "v0.3.10",
  "checks": {
    "pty_manager": "ok",
    "event_watcher": "ok",
    "disk_space": "ok"
  }
}
```

## Alerts

### Alert Conditions

**Critical:**
- Chain failure rate > 5%
- P99 duration > 2x baseline
- Watchdog detecting stalled runs
- Disk space > 90% full
- PTY manager not responding

**Warning:**
- Success rate drops below 95%
- P95 duration increases 50%
- Queue depth > 10
- Schema validation failures increase

**Info:**
- New chain deployed
- Model version updated
- Resource usage trends

### Alert Channels

**Email:**
```bash
# Configure email alerts in settings
mentiko alerts configure --type email --to ops@company.com
```

**Webhook:**
```bash
# Configure webhook
mentiko alerts configure --type webhook \
  --url https://hooks.company.com/mentiko
```

**Slack:**
```bash
# Configure Slack integration
mentiko alerts configure --type slack \
  --workspace https://hooks.slack.com/services/YOUR/WEBHOOK
```

## Dashboards

### Run Dashboard

**Key Metrics:**
- Runs per hour (success/fail breakdown)
- Active runs currently executing
- Queue depth over time
- P50/P95/P99 duration percentiles

**Implementation:**
```bash
# Query metrics
mentiko metrics runs --last 24h --group-by status
mentiko metrics duration --percentiles 50,95,99
```

### Agent Dashboard

**Key Metrics:**
- Most common agents by execution count
- Per-agent success rates
- Per-agent duration distribution
- Per-agent cost metrics

**Implementation:**
```bash
# Agent performance
mentiko metrics agents --last 7d --sort-by duration
```

### Resource Dashboard

**Key Metrics:**
- PTY session utilization
- Disk usage by namespace
- CPU/memory trends
- Event file growth rate

## Logging

### Log Levels

**ERROR:**
- Agent failures
- System errors
- Watchdog escalations

**WARN:**
- Schema validation failures
- Retry attempts
- Resource threshold warnings

**INFO:**
- Chain start/complete
- Agent transitions
- Normal system events

**DEBUG:**
- Detailed execution trace
- Event parsing details
- Session allocation details

### Log Locations

```
namespaces/{id}/logs/
  chains.log          # Chain execution
  agents.log           # Agent activity
  watchdog.log          # Watchdog activity
  events.log           # Event processing
```

**System logs:**
```bash
# View logs
journalctl -u mentiko -f

# Export logs
journalctl -u mentiko --since "1 hour ago" > mentiko-logs.txt
```

## Troubleshooting

### High Failure Rate

**Diagnosis:**
1. Check error logs for patterns
2. Identify specific agent failures
3. Check model availability
4. Verify workspace configuration

**Actions:**
- Fix agent prompts
- Increase timeout values
- Update model version

### Slow Chains

**Diagnosis:**
1. Check duration metrics by agent
2. Identify slowest agent
3. Check token usage trends
4. Verify workspace I/O

**Actions:**
- Optimize agent prompts
- Add caching
- Increase resource limits

### Resource Exhaustion

**Diagnosis:**
1. Check disk space usage
2. Monitor PTY session count
3. Check memory usage
4. Review event file growth

**Actions:**
- Clean up old event files
- Increase workspace storage
- Add resource limits
- Implement event archival

## Best Practices

**Alert Fatigue:**
- Set appropriate thresholds
- Use alert grouping
- Route alerts to on-call rotation
- Review and tune alerts weekly

**Data Retention:**
- Archive metrics after 90 days
- Archive logs after 30 days
- Keep event files for 7 days
- Configure automated cleanup

**Baseline Management:**
- Establish performance baselines
- Update baselines weekly
- Alert on deviations >2x from baseline
- Document seasonal patterns

## Related

- [Testing Chains](/guides/testing)
- [Self-Hosting](/guides/self-hosting)
- [Agent Chains](/concepts/agent-chains)
