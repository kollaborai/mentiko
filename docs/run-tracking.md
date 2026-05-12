# run tracking

each chain execution gets a unique run-id that groups all sessions together.

## how it works
when a chain starts:
  1. run-id generated (run-<timestamp>)
  2. run.json created in namespaces/{id}/runs/<run-id>/
  3. every agent session tagged with this run-id
  4. status tracked as agents start/complete

## run id format
when a chain starts:
  1. run-id generated (run-<timestamp>)
  2. run.json created in namespaces/{id}/runs/<run-id>/
  3. every agent session tagged with this run-id
  4. status tracked as agents start/complete

run id format
------------------------------------------------------------
run-1740500000

unix timestamp makes them sortable and unique.

## run.json schema
{
  "id": "run-1740500000",
  "chain": "Client Engagement Pipeline",
  "goal": "create proposal for acme corp",
  "started": "2026-02-25T10:00:00-07:00",
  "completed": "2026-02-25T11:30:00-07:00",
  "status": "completed",
  "status_message": "all agents finished",
  "sessions": [
    "client-sa-20260225-1000",
    "client-ae-20260225-1015",
    "client-pm-20260225-1030",
    "client-qa-20260225-1045"
  ],
  "agents": [
    {"id": "sa", "session": "client-sa-...", "status": "completed"},
    {"id": "ae", "session": "client-ae-...", "status": "completed"},
    {"id": "pm", "session": "client-pm-...", "status": "completed"},
    {"id": "qa", "session": "client-qa-...", "status": "completed"}
  ]
}

status values:
  running    - chain execution in progress
  completed  - all agents finished successfully
  failed     - chain aborted or error occurred

run directory structure
------------------------------------------------------------
namespaces/{id}/runs/
  run-1740500000/
    run.json          # metadata and status
    state/
      sa.state        # per-agent live status
      ae.state
      pm.state
      qa.state
  run-1740501234/
    run.json

.state files are used for live updates during execution.
final status lives in run.json.

why run tracking matters
------------------------------------------------------------
1. group sessions by execution
2. track chain-level status (not just individual agents)
3. store the goal/prompt for the run
4. provide audit trail
5. enable run history filtering in web ui

cli commands
------------------------------------------------------------
# list all runs
./bin/mentiko list

# get specific run details
cat namespaces/default/runs/run-1740500000/run.json

# cleanup old runs (manual)
find namespaces/default/runs/ -name 'run.json' -mtime +30 -delete

api endpoints
------------------------------------------------------------
# list runs
curl http://localhost:3000/api/runs

# filter by chain
curl http://localhost:3000/api/runs?chain=Client%20Engagement%20Pipeline

# filter by status
curl http://localhost:3000/api/runs?status=running

# get single run
curl http://localhost:3000/api/runs/run-1740500000

example usage
------------------------------------------------------------
start a chain with run tracking:

./bin/mentiko run namespaces/default/chains/my-chain/chain.json

output:

✔ run created: run-1740500000
▶ launching agent: first-agent
   session: chain-20260308-1200

check run status:

cat namespaces/default/runs/run-1740500000/run.json | jq .

run: run-1740500000
chain: Client Engagement Pipeline
goal: create proposal for acme corp
status: running
started: 2026-02-25T10:00:00

agents:
  ✔ sa       completed    client-sa-20260225-1000
  ▶ ae       running      client-ae-20260225-1015
  ○ pm       waiting
  ○ qa       waiting

web ui integration
------------------------------------------------------------
run page shows:
  goal tab         - enter goal, replaces {TASK} in prompts
  history tab      - past runs with status and filters
  sessions tab     - active pty sessions for this run
  messages tab     - conversations with steer input

run-id filtering:
  filter by status: running | completed | failed
  click any run to view details
  see full session list and agent statuses

troubleshooting
------------------------------------------------------------
run not showing up?

1. check namespaces/{id}/runs/ directory exists
2. verify run.json was created
3. check for parse errors in run.json

run status stuck on "running"?

1. check if agents are actually running (./bin/mentiko list)
2. sessions may have crashed without emitting completion
3. manually update status if needed:
   jq '.status = "failed"' namespaces/default/runs/run-X/run.json

old runs accumulating?

1. cleanup regularly:
   find namespaces/default/runs/ -name 'run.json' -mtime +30 -delete

2. or add to cron:
   0 2 * * * find namespaces/default/runs/ -name 'run.json' -mtime +30 -delete

integration with webhooks
------------------------------------------------------------
webhooks include run id in their payload:

{
  "event": "chain_complete",
  "run_id": "run-1740500000",
  "chain": "My Chain",
  "timestamp": "2026-02-25T10:00:00"
}

use this to correlate webhook events with run history in your systems.
