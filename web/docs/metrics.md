# Metrics

Usage analytics and performance metrics for chain executions and agent performance.

---

## Overview

Metrics provide visibility into chain executions, agent performance, resource usage, and system health. Track success rates, execution times, token usage, and webhook delivery to identify bottlenecks and optimize workflows.

---

## Key Features

### Execution Statistics

- **Total runs** - All-time execution count
- **Success rate** - Percentage of completed runs vs failed
- **Average duration** - Mean execution time per run
- **Status breakdown** - Runs by status (completed, failed, running, pending, stopped, timeout)

### Agent Performance

- **Total agents** - Number of agents executed across all runs
- **Agent status distribution** - Agents by status
- **Execution timers** - Per-agent timing data (count, avg, min, max)

### Time-Series Data

- **Token usage (7d)** - Input, output, and total tokens consumed in the last 7 days
- **System uptime** - Server uptime in milliseconds
- **Auto-refresh** - Metrics update every 30 seconds

### Filtering and Grouping

- **Runs by chain** - Execution count grouped by chain name
- **Status distribution** - Visual pie chart of run statuses
- **Webhook metrics** - Delivery success rate with counts (delivered, failed, pending)
- **Workspace filtering** - Filter metrics by workspace context

---

## Usage

### Viewing Metrics

Navigate to `/metrics` in the web interface or use the API:

```bash
curl http://localhost:3000/api/metrics
```

Response includes all metrics:

```json
{
  "runs": {
    "total": 150,
    "by_status": { "completed": 120, "failed": 20, "running": 5, "pending": 5 },
    "by_chain": { "research-agent": 45, "code-review": 30, "deploy-bot": 75 },
    "success_rate": 80.0,
    "avg_duration_ms": 45000
  },
  "agents": {
    "total": 450,
    "by_status": { "completed": 400, "failed": 30, "running": 20 }
  },
  "webhooks": {
    "total": 50,
    "delivered": 45,
    "failed": 3,
    "pending": 2,
    "success_rate": 90.0
  },
  "tokens": {
    "total_7d": 1250000,
    "input_7d": 850000,
    "output_7d": 400000
  },
  "system": {
    "uptime_ms": 90000000,
    "timestamp": "2026-03-16T10:30:00Z"
  }
}
```

### Prometheus Format

Export metrics in Prometheus format for external monitoring:

```bash
curl http://localhost:3000/api/metrics?format=prometheus
```

Response:

```
# mentiko metrics
# generated 2026-03-16T10:30:00Z

# HELP mentiko_runs_total Total number of runs
# TYPE mentiko_runs_total gauge
mentiko_runs_total 150

# HELP mentiko_runs_success_rate Success rate percentage
# TYPE mentiko_runs_success_rate gauge
mentiko_runs_success_rate 80.0

mentiko_runs_by_status{status="completed"} 120
mentiko_runs_by_status{status="failed"} 20

# HELP mentiko_webhooks_success_rate Webhook success rate percentage
# TYPE mentiko_webhooks_success_rate gauge
mentiko_webhooks_success_rate 90.0
```

### Analyzing Performance Trends

Metrics dashboard visualizes:

1. **Runs by Chain** - Horizontal bar chart showing execution frequency
2. **Status Distribution** - Pie chart with color-coded statuses
3. **Webhook Success Rate** - Circular progress gauge with breakdown
4. **Recent Runs** - Timeline of latest executions with status indicators

### Identifying Bottlenecks

Look for these patterns:

- **High failure rate** (>20%) - Check chain configuration, agent prompts, or API quotas
- **Long avg duration** - Agent timeout settings, model selection, or complex chains
- **Webhook failures** - Endpoint availability, payload size, or network issues
- **Token spikes** - Prompt optimization needed or excessive tool use

---

## Examples

### Analyze Chain Success Rate Over Time

```bash
# Get current metrics
curl -s http://localhost:3000/api/metrics | jq '.runs.success_rate'
# Output: 80.0

# Check by chain to find underperforming workflows
curl -s http://localhost:3000/api/metrics | jq '.runs.by_chain'
# Output:
# {
#   "research-agent": 45,
#   "code-review": 30,
#   "deploy-bot": 75
# }

# Cross-reference with status breakdown
curl -s http://localhost:3000/api/metrics | jq '.runs.by_status'
# Output:
# {
#   "completed": 120,
#   "failed": 20,
#   "running": 5,
#   "pending": 5
# }
```

**Analysis:** 80% success rate with 150 total runs. `deploy-bot` has the most executions (75). 20 runs failed - investigate failed runs in `/runs` to identify root cause.

### Compare Agent Execution Times

```bash
# Get execution timers
curl -s http://localhost:3000/api/metrics | jq '.execution_times'
# Output:
# {
#   "research-agent": {
#     "count": 100,
#     "total_ms": 4500000,
#     "avg_ms": 45000,
#     "min_ms": 15000,
#     "max_ms": 120000
#   },
#   "coding-agent": {
#     "count": 50,
#     "total_ms": 1000000,
#     "avg_ms": 20000,
#     "min_ms": 10000,
#     "max_ms": 45000
#   }
# }
```

**Analysis:** `research-agent` avg 45s vs `coding-agent` avg 20s. Max time 120s indicates some runs hit timeouts. Consider adjusting `timeout` settings or optimizing prompts.

### Monitor Webhook Delivery

```bash
# Check webhook health
curl -s http://localhost:3000/api/metrics | jq '.webhooks'
# Output:
# {
#   "total": 50,
#   "delivered": 45,
#   "failed": 3,
#   "pending": 2,
#   "success_rate": 90.0
# }
```

**Analysis:** 90% delivery rate is good. 3 failures need investigation - check endpoint logs. 2 pending indicates retries in progress.

### Track Token Usage Trends

```bash
# Monitor 7-day token consumption
curl -s http://localhost:3000/api/metrics | jq '.tokens'
# Output:
# {
#   "total_7d": 1250000,
#   "input_7d": 850000,
#   "output_7d": 400000
# }
```

**Analysis:** 1.25M tokens in 7 days. Input dominates (68%) - prompts are verbose. Consider reducing context or using cheaper models for sub-tasks.

---

## Dashboard Components

### Stat Cards

Top row shows key metrics at a glance:

- **Total Runs** - All-time execution count
- **Success Rate** - Percentage with target (80%)
- **Avg Duration** - Mean execution time (formatted: 45s, 1m 23s)
- **Total Agents** - Agent executions across all runs
- **Tokens (7d)** - Token usage with input/output breakdown

### Charts

- **Runs by Chain** - Horizontal bar chart, top 8 chains
- **Status Distribution** - Pie chart with color-coded statuses
- **Webhook Success Rate** - Circular gauge with delivered/failed/pending counts
- **Recent Runs** - Timeline of last 10 runs with status dots

---

## Status Colors

| Status | Color | Hex |
|--------|-------|-----|
| completed | green | #22c55e |
| failed | red | #ef4444 |
| running | blue | #3b82f6 |
| pending | gray | #6b7280 |
| stopped | orange | #f59e0b |
| timeout | dark red | #dc2626 |

---

## API Endpoints

### Get Metrics

```http
GET /api/metrics
```

Query Parameters:
- `format` (optional) - "json" (default) or "prometheus"

Response: JSON with all metrics or Prometheus text format

### Get Runs

```http
GET /api/runs?limit=10
```

Response: Recent runs for timeline view

---

## Data Sources

Metrics are collected from:

1. **Run files** - `~/.mentiko/namespaces/{id}/runs/run-*/run.json`
2. **Agent artifacts** - `artifacts/*-conversations.json` for token usage
3. **Webhook state** - `~/.mentiko_webhooks/*.json` for delivery stats
4. **Metrics files** - `~/.mentiko-metrics/` for timers/counters/gauges
5. **System uptime** - `process.uptime()` for server health

---

## Troubleshooting

### "No metrics available"

**Cause:** No runs executed yet or metrics directory missing.

**Solution:**
```bash
# Check runs directory
ls ~/.mentiko/namespaces/default/runs/

# Run a test chain
cd $MENTIKO_CODE_ROOT
./bin/mentiko run /path/to/chain.json
```

### Token usage showing 0

**Cause:** No runs in the last 7 days or conversations not captured.

**Solution:**
```bash
# Check for conversation artifacts
find ~/.mentiko/namespaces/default/runs -name "*-conversations.json"

# Verify run timestamps are within 7 days
ls -lt ~/.mentiko/namespaces/default/runs/
```

### Webhook metrics inaccurate

**Cause:** State files in old location or webhook integration disabled.

**Solution:**
```bash
# Check webhook state directory
ls ~/.mentiko_webhooks/

# Verify webhooks enabled in chain config
jq '.webhooks' ~/.mentiko/namespaces/default/chains/my-chain/chain.json
```

### Prometheus format not working

**Cause:** Invalid query parameter or Content-Type header issue.

**Solution:**
```bash
# Use correct format parameter
curl "http://localhost:3000/api/metrics?format=prometheus"

# Verify Content-Type header
curl -I "http://localhost:3000/api/metrics?format=prometheus"
# Should show: Content-Type: text/plain; version=0.0.4
```

---

## Best Practices

### Monitoring

- Set up Prometheus scraping every 30 seconds
- Alert on success rate dropping below 80%
- Monitor token usage for cost optimization
- Track webhook delivery for external integrations

### Performance Optimization

- **High avg duration** - Review agent timeout settings
- **Low success rate** - Check chain validation and error handling
- **Token spikes** - Optimize prompts or use smaller models
- **Webhook failures** - Verify endpoint availability and retry logic

### Data Retention

- Metrics are real-time, no historical storage
- Run files persist indefinitely in `runs/` directory
- Token usage limited to 7-day rolling window
- Webhook state files accumulate until cleanup

---

## Related

- [User Guide](./user-guide.md) - Chain execution and monitoring
- [API Reference](./api-reference.md) - Complete API documentation
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions
