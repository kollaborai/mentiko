# Schedules

Cron-based chain execution with retries and error handling.

## Overview

Schedules enable automated, recurring chain execution based on cron expressions.

## Configuration

**Schedule file:** `schedules/{name}.json`

```json
{
  "name": "daily-report",
  "schedule": "0 9 * * *",
  "timezone": "America/New_York",
  "chain": "daily-summary",
  "enabled": true,
  "retry_policy": {
    "max_retries": 3,
    "backoff": "exponential",
    "timeout": 300
  }
}
```

## Cron Syntax

Standard 5-field cron expression:

```
* * * * *
│ │ │ │ │
│ │ │ │ └─ Day of week (0-6, 0 = Sunday)
│ │ │ └─── Month (1-12)
│ │ └───── Day of month (1-31)
│ └─────── Hour (0-23)
└───────── Minute (0-59)
```

**Examples:**
- `0 9 * * *` - Daily at 9 AM
- `*/30 * * * *` - Every 30 minutes
- `0 0 * * 0` - Weekly on Sunday midnight
- `0 9 * * 1-5` - Weekdays at 9 AM

## Timezones

All schedules use the configured timezone:

```json
{
  "timezone": "UTC"
}
```

**Common timezones:**
- `UTC` - Universal Coordinated Time
- `America/New_York` - Eastern Time
- `America/Los_Angeles` - Pacific Time
- `Europe/London` - London Time

## Retry Policy

**Exponential backoff (default):**
```json
{
  "max_retries": 3,
  "backoff": "exponential",
  "initial_delay": 60,
  "max_delay": 3600
}
```

**Fixed delay:**
```json
{
  "max_retries": 5,
  "backoff": "fixed",
  "delay": 120
}
```

**No retries:**
```json
{
  "max_retries": 0
}
```

## Timeout

**Per-chain timeout:**
```json
{
  "timeout": 300
}
```

If a chain exceeds the timeout, it's marked as failed and retry policy applies.

## Error Handling

**Failure modes:**
- Agent crashes → retry next scheduled execution
- Chain timeout → mark as failed, apply retry policy
- Schedule miss → skip (no backfill)

**Notifications:**
- Configure webhook for failure alerts
- Set up email notifications for critical schedules

## Management

**List schedules:**
```bash
mentiko schedules list
```

**Create schedule:**
```bash
mentiko schedules create daily-report.json
```

**Enable/disable:**
```bash
mentiko schedules disable daily-report
mentiko schedules enable daily-report
```

**Delete:**
```bash
mentiko schedules delete daily-report
```

## Best Practices

- Use UTC for timezone-independent schedules
- Set appropriate timeouts to prevent stuck chains
- Configure retry policy for external API calls
- Monitor execution logs for patterns
- Test cron expressions at [crontab.guru](https://crontab.guru)

**TODO:** Schedule history, execution metrics, backfill support
