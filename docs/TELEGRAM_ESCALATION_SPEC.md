# Telegram Escalation Bot — Spec

peer-manager sessions can deadlock. two agents loop, neither advances.
this spec defines how escalations get routed to a human via Telegram,
how the human replies, and how that reply gets injected back into the session.

---

## design decisions

**escalation trigger:** three conditions, checked in order per round:
1. haiku returns STATUS:ESCALATE — primary signal. haiku detects that the
   agents are restating positions without new content (circular argument).
2. 5 consecutive STATUS:CONTINUE rounds — progress stall fallback. no
   DONE signals means something is stuck even if haiku didn't flag it.
3. max_rounds hit — hard cap. escalate instead of silently dying.

rationale: haiku is already the judge of each exchange. it reads the full
screen capture. the loop/deadlock pattern is detectable from content alone
("I already said X" / "I disagree with X" cycling back). adding STATUS:ESCALATE
costs one extra token in the prompt and zero new infrastructure on the bash side.
consecutive-CONTINUE is a cheap counter already implicit in the loop.

**who calls Telegram:** the Next.js web server. bash signals escalation via
a local web API call. the web server authenticates with Telegram, logs history,
and handles the async reply webhook. bash stays dumb — write file, poll file.

**session lookup:** JSON registry file at
`$NAMESPACE_ROOT/peer-escalations/registry.json`.
maps session_id → { telegram_chat_id, task, peer1, peer2, started_at }.
written by the web server at launch time when chat_id is provided.
bidirectional: also indexes chat_id → session_id for webhook routing.

---

## data layout

```
$NAMESPACE_ROOT/
  peer-escalations/
    registry.json              # session ↔ chat_id lookup table
    {session_id}/
      history.json             # array of all escalation events for this session
      reply.txt                # written by web on human reply, polled by bash
      escalation-{n}.json      # snapshot of each individual escalation
```

### registry.json schema

```json
{
  "sessions": {
    "manager-abc123": {
      "telegram_chat_id": "123456789",
      "task": "write a fibonacci function in python with tests",
      "peer1": "peer-1-20260306-143022",
      "peer2": "peer-2-20260306-143022",
      "started_at": "2026-03-06T14:30:22Z",
      "status": "active"
    }
  },
  "by_chat_id": {
    "123456789": "manager-abc123"
  }
}
```

### reply.txt

single-line or multi-line text. presence of this file = reply received.
bash polls for existence with `inotifywait` or a sleep loop.
bash deletes the file after reading it to reset for next escalation.

### history.json schema

```json
[
  {
    "id": "esc-1",
    "session_id": "manager-abc123",
    "round": 7,
    "trigger": "STATUS:ESCALATE",
    "consecutive_continues": 5,
    "peer1_last": "I already wrote the tests. you need to fix the implementation.",
    "peer2_last": "The implementation is correct. the tests are wrong.",
    "haiku_summary": "agents are in disagreement loop about correctness, no code changes in 3 rounds",
    "telegram_message_id": 42,
    "sent_at": "2026-03-06T14:38:11Z",
    "human_reply": "peer-1 is right, the ValueError case should raise not return. peer-2 fix the impl.",
    "replied_at": "2026-03-06T14:39:02Z",
    "injected_at": "2026-03-06T14:39:03Z"
  }
]
```

### escalation-{n}.json

same structure as one history entry. kept as individual files for easy
access without parsing the full history array. `n` is the escalation
sequence number within the session (1-indexed).

---

## bash changes (bin/peer-manager)

### 1. extend haiku prompt — add STATUS:ESCALATE

in `capture_and_clean`, add ESCALATE as a third status option in the prompt:

```
On the very last line, write exactly one of:
  STATUS:DONE       - agent says task is complete/finished/done
  STATUS:CONTINUE   - agent is still working or handing off
  STATUS:ESCALATE   - agents are repeating the same disagreement without
                      progress. this includes: restating prior positions,
                      saying "I already told you", "you're wrong but not
                      explaining why", or any circular argument with no
                      new code, reasoning, or action proposed.
```

add a concrete example:

```
--- SCREEN CAPTURE ---
I already fixed the ValueError issue. your test expectation is wrong.
--- END ---
(peer-2 in prior round said: "ValueError is not raised, the test is right")

YOUR OUTPUT:
I already fixed the ValueError issue. your test expectation is wrong.
STATUS:ESCALATE
```

### 2. escalation state

add to peer-manager after status file setup:

```bash
# escalation state
ESCALATION_DIR="$NAMESPACE_ROOT/peer-escalations/$managerSession"
REPLY_FILE="$ESCALATION_DIR/reply.txt"
ESC_COUNT=0
CONSECUTIVE_CONTINUES=0
mkdir -p "$ESCALATION_DIR"
```

note: `managerSession` needs to be passed in or derived. since peer-manager
is launched inside a manager pty session, pass it via env or as a flag:
`--session manager-abc123`. the launch route already knows the session name.

add `--session` flag to peer-manager arg parsing:

```bash
--session)  MANAGER_SESSION="${2:-}"; shift 2 ;;
```

update launch route to pass it:
```bash
const managerCmd = `${scriptPath} ${JSON.stringify(task)} --session ${managerSession}`;
```

### 3. escalation detection in the main loop

after each capture_and_clean call, add escalation checks:

```bash
STATUS=$(cat "$STATUS_FILE")

if [[ "$STATUS" == "ESCALATE" ]]; then
  fire_escalation "$round" "$CONSECUTIVE_CONTINUES" "$OUTPUT" "STATUS:ESCALATE"
elif [[ "$STATUS" == "CONTINUE" ]]; then
  CONSECUTIVE_CONTINUES=$((CONSECUTIVE_CONTINUES + 1))
  if [[ $CONSECUTIVE_CONTINUES -ge 5 ]]; then
    fire_escalation "$round" "$CONSECUTIVE_CONTINUES" "$OUTPUT" "STALL"
    CONSECUTIVE_CONTINUES=0
  fi
elif [[ "$STATUS" == "DONE" ]]; then
  CONSECUTIVE_CONTINUES=0
fi
```

### 4. fire_escalation function

```bash
fire_escalation() {
  local round="$1"
  local consecutive="$2"
  local last_output="$3"
  local trigger="$4"

  ESC_COUNT=$((ESC_COUNT + 1))
  log "escalation $ESC_COUNT triggered (round=$round trigger=$trigger)"

  # capture the other peer's last output from the peer-output dir
  local peer1_last peer2_last
  peer1_last=$(ls -t "$NAMESPACE_ROOT/peer-output/${PEER1}-"*.txt 2>/dev/null | head -1)
  peer2_last=$(ls -t "$NAMESPACE_ROOT/peer-output/${PEER2}-"*.txt 2>/dev/null | head -1)
  peer1_last=$(cat "$peer1_last" 2>/dev/null | tail -20 || echo "unavailable")
  peer2_last=$(cat "$peer2_last" 2>/dev/null | tail -20 || echo "unavailable")

  # call web API — web handles Telegram delivery and history logging
  local payload
  payload=$(jq -n \
    --arg session "$MANAGER_SESSION" \
    --arg esc_id "esc-${ESC_COUNT}" \
    --argjson round "$round" \
    --arg trigger "$trigger" \
    --argjson consecutive "$consecutive" \
    --arg peer1_last "$peer1_last" \
    --arg peer2_last "$peer2_last" \
    '{session_id: $session, escalation_id: $esc_id, round: $round,
      trigger: $trigger, consecutive_continues: $consecutive,
      peer1_last: $peer1_last, peer2_last: $peer2_last}')

  curl -s -X POST "http://localhost:3000/api/links/runs/${MANAGER_SESSION}/escalate" \
    -H "content-type: application/json" \
    -d "$payload" >/dev/null 2>&1 || log "warning: escalation API call failed"

  note: /api/swarm/* endpoints are deprecated, use /api/links/runs/{runId}/* instead

  # block waiting for human reply
  log "waiting for human reply (file: $REPLY_FILE)..."
  local wait=0
  local max_wait=3600  # 1 hour timeout
  while [[ ! -f "$REPLY_FILE" && $wait -lt $max_wait ]]; do
    sleep 5
    wait=$((wait + 5))
  done

  if [[ ! -f "$REPLY_FILE" ]]; then
    log "escalation timeout — resuming without human input"
    return
  fi

  # read reply, delete file, inject into both peers
  local reply
  reply=$(cat "$REPLY_FILE")
  rm -f "$REPLY_FILE"

  log "injecting human guidance: ${reply:0:80}..."
  local injection="[human guidance] $reply"
  send_to_peer "$PEER1" "$injection"
  send_to_peer "$PEER2" "$injection"
  log "guidance injected"
}
```

### 5. max_rounds escalation (hard cap)

replace the current silent `log "hit max rounds"` at the end:

```bash
if [[ $round -ge $MAX_ROUNDS ]]; then
  log "hit max rounds ($MAX_ROUNDS) — escalating"
  fire_escalation "$round" "$CONSECUTIVE_CONTINUES" "" "MAX_ROUNDS"
  # if human replies, continue for additional rounds
  if [[ -f "$REPLY_FILE" ]]; then
    MAX_ROUNDS=$((MAX_ROUNDS + 10))
    log "human replied, extending to $MAX_ROUNDS rounds"
    # loop continues naturally via while condition not yet written
    # refactor: convert to while true + explicit break on DONE/max
  fi
fi
```

---

## web API routes

note: /api/swarm/* endpoints are deprecated. use /api/links/runs/{runId}/* instead.

### POST /api/links/runs — extend existing

add optional `telegram_chat_id` to request body.
when present, register the session in the registry.

request body addition:
```json
{
  "task": "write a fibonacci function",
  "telegram_chat_id": "123456789"
}
```

new logic in route handler:
```typescript
if (telegram_chat_id) {
  await registerEscalationSession({
    session_id: managerSession,
    telegram_chat_id,
    task,
    started_at: new Date().toISOString(),
  });
}
```

`registerEscalationSession` reads registry.json, upserts the entry,
writes back atomically.

---

### POST /api/links/runs/{runId}/escalate

called by bash when escalation fires. web sends Telegram message and logs history.

request body:
```typescript
interface EscalateRequest {
  escalation_id: string;         // "esc-1"
  round: number;
  trigger: "STATUS:ESCALATE" | "STALL" | "MAX_ROUNDS";
  consecutive_continues: number;
  peer1_last: string;            // raw last output from peer-1
  peer2_last: string;            // raw last output from peer-2
}
```

response:
```typescript
interface EscalateResponse {
  ok: boolean;
  telegram_sent: boolean;
  telegram_message_id?: number;
  chat_id?: string;
  error?: string;
}
```

handler logic:
1. look up session in registry → get chat_id. if not registered → ok:true, telegram_sent:false.
2. call haiku to generate summary from peer1_last + peer2_last (see message format below).
3. send Telegram message via Bot API.
4. write escalation-{n}.json and append to history.json.
5. return message_id for cross-reference.

---

### POST /api/telegram/webhook

receives all incoming messages from Telegram. Telegram sends a POST here
whenever the bot receives a message.

request body (Telegram Update object, relevant fields):
```typescript
interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; };
    chat: { id: number; };
    text?: string;
    reply_to_message?: { message_id: number; };
  };
}
```

handler logic:
1. verify `X-Telegram-Bot-Api-Secret-Token` header matches `TELEGRAM_WEBHOOK_SECRET`.
2. extract chat_id from `message.chat.id`.
3. look up session_id from registry `by_chat_id[chat_id]`. if not found → 200 (ignore).
4. read text from `message.text`. strip leading `/reply` if present (optional command prefix).
5. write text to `$NAMESPACE_ROOT/peer-escalations/{session_id}/reply.txt`.
6. update history.json: set `human_reply`, `replied_at` on the most recent open escalation.
7. send Telegram acknowledgement: "got it — injecting into session {session_id[:8]}".
8. return 200.

security note: the webhook secret header is the only auth. do not expose this
endpoint without it. set in env: `TELEGRAM_WEBHOOK_SECRET`.

---

### POST /api/links/runs/{runId}/reply — manual web UI injection

for replying from the web UI instead of Telegram.
same effect as writing reply.txt but triggered from the escalation pane.

request body:
```typescript
{ reply: string; escalation_id?: string; }
```

handler logic:
1. validate session exists.
2. write `$NAMESPACE_ROOT/peer-escalations/{session}/reply.txt`.
3. update history.json same as webhook handler.
4. if a Telegram chat is registered for this session, send acknowledgement message.
5. return ok.

---

### GET /api/links/runs/{runId}/escalations

returns escalation history for the session. used by the UI escalation pane.

response:
```typescript
interface EscalationsResponse {
  session_id: string;
  escalations: EscalationEvent[];
  pending: boolean;          // true if reply.txt does not exist but last event has no reply
  telegram_connected: boolean;
}
```

---

## Telegram message format

### alert message (sent on escalation)

```
[mentiko escalation]
session: manager-abc123
round: 7 of 20
trigger: loop detected

task:
write a fibonacci function in python with tests

peer-1 says:
I already fixed the ValueError issue. your test expectation is wrong.

peer-2 says:
The implementation is correct. ValueError is not raised, the test is right.

summary:
agents disagree on whether ValueError should be raised or returned.
no code changes in the last 3 rounds. neither agent is proposing a new action.

reply with guidance to unblock them.
use /reply <your message> or just reply directly to this message.
```

the summary line is generated by a haiku call:
```
prompt: given these two agent positions, write one sentence explaining
the core disagreement and why they are stuck. be specific.
peer-1: <peer1_last>
peer-2: <peer2_last>
```

message is sent with `parse_mode: undefined` (plain text, no markdown).
telegram message_id is stored in the escalation record.

### acknowledgement message (sent after human replies)

```
got it. injecting guidance into session manager-abc123...
```

sent immediately when reply.txt is written, before injection completes.

---

## Telegram bot setup

### create bot

1. message @BotFather on Telegram.
2. `/newbot` → follow prompts → get `BOT_TOKEN`.
3. add to env: `TELEGRAM_BOT_TOKEN=<token>`.

### register webhook

run once after deployment (or after domain change):

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "content-type: application/json" \
  -d '{
    "url": "https://mentiko.com/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message"]
  }'
```

for local dev, use ngrok or cloudflare tunnel:
```bash
# ngrok example
ngrok http 3000
# then register: https://<ngrok-id>.ngrok.io/api/telegram/webhook
```

add script at `scripts/register-telegram-webhook.sh` that reads env and
runs the curl command. run this in deploy pipeline after env is set.

### env vars

```
TELEGRAM_BOT_TOKEN          bot token from @BotFather (required for Telegram)
TELEGRAM_WEBHOOK_SECRET     arbitrary secret for webhook verification (required)
```

both optional at the system level — if not set, Telegram features are
disabled gracefully. bash fires the escalation API call, web returns
`telegram_sent: false`, bash still blocks on reply.txt (web UI can still inject).

---

## Telegram API wrapper (web/lib/notifications/telegram.ts)

```typescript
// web/lib/notifications/telegram.ts
const BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function sendMessage(chat_id: string, text: string): Promise<number | null> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  const res = await fetch(`${BASE}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, text }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.result?.message_id ?? null;
}
```

---

## escalation registry helpers (web/lib/system/peer-escalations.ts)

```typescript
// web/lib/system/peer-escalations.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { NAMESPACE_ROOT } from "./config";
import path from "path";

const REGISTRY_DIR = path.join(NAMESPACE_ROOT, "peer-escalations");
const REGISTRY_PATH = path.join(REGISTRY_DIR, "registry.json");

interface SessionEntry {
  telegram_chat_id?: string;
  task: string;
  peer1?: string;
  peer2?: string;
  started_at: string;
  status: "active" | "completed";
}

interface Registry {
  sessions: Record<string, SessionEntry>;
  by_chat_id: Record<string, string>;
}

export function readRegistry(): Registry {
  mkdirSync(REGISTRY_DIR, { recursive: true });
  if (!existsSync(REGISTRY_PATH)) return { sessions: {}, by_chat_id: {} };
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
}

export function writeRegistry(registry: Registry): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

export function registerSession(session_id: string, entry: SessionEntry): void {
  const reg = readRegistry();
  reg.sessions[session_id] = entry;
  if (entry.telegram_chat_id) {
    reg.by_chat_id[entry.telegram_chat_id] = session_id;
  }
  writeRegistry(reg);
}

export function getSessionByChatId(chat_id: string): string | null {
  const reg = readRegistry();
  return reg.by_chat_id[chat_id] ?? null;
}

export function getSessionEntry(session_id: string): SessionEntry | null {
  const reg = readRegistry();
  return reg.sessions[session_id] ?? null;
}

export function escalationDir(session_id: string): string {
  return path.join(REGISTRY_DIR, session_id);
}

export function replyFile(session_id: string): string {
  return path.join(escalationDir(session_id), "reply.txt");
}

export function historyFile(session_id: string): string {
  return path.join(escalationDir(session_id), "history.json");
}

export function appendHistory(session_id: string, event: object): void {
  const file = historyFile(session_id);
  mkdirSync(path.dirname(file), { recursive: true });
  const existing = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf-8"))
    : [];
  existing.push(event);
  writeFileSync(file, JSON.stringify(existing, null, 2));
}

export function updateLastHistoryEntry(
  session_id: string,
  updates: Record<string, unknown>
): void {
  const file = historyFile(session_id);
  if (!existsSync(file)) return;
  const history = JSON.parse(readFileSync(file, "utf-8"));
  if (history.length === 0) return;
  Object.assign(history[history.length - 1], updates);
  writeFileSync(file, JSON.stringify(history, null, 2));
}
```

---

## file tree — new files

```
web/
  app/api/
    telegram/
      webhook/
        route.ts              # POST — receive Telegram messages
    links/
      runs/
        [runId]/
          escalate/
            route.ts          # POST — bash → web escalation signal
          reply/
            route.ts          # POST — web UI reply injection
          escalations/
            route.ts          # GET — history for UI
    swarm/ (deprecated)
      [session]/
        escalate/route.ts     # — use /api/links/runs/{runId}/escalate
        reply/route.ts        # — use /api/links/runs/{runId}/reply
        escalations/route.ts  # — use /api/links/runs/{runId}/escalations
  lib/
    telegram.ts               # sendMessage wrapper
    peer-escalations.ts       # registry + history helpers

bin/
  peer-manager                # modified (STATUS:ESCALATE + fire_escalation)

docs/
  TELEGRAM_ESCALATION_SPEC.md # this file
```

---

## UI integration (escalation pane)

the existing escalation pane in `peer-split-view.tsx` currently renders a
`TerminalPanel` for the manager session. that stays as-is for manager logs.

extend `PeerSplitView` to also show escalation state:

- poll `GET /api/links/runs/{managerSession}/escalations` every 3s.
- if `pending: true`, show an amber banner: "waiting for your reply".
- show a text input in the escalation pane for web-based replies.
- on submit, call `POST /api/links/runs/{managerSession}/reply`.
- show history below the input (collapsible, most recent first).
- if `telegram_connected: true`, show "also connected via Telegram @{chat_id[:6]}".

note: /api/swarm/* endpoints are deprecated, use /api/links/runs/{runId}/* instead.

---

## summary of trigger conditions

| trigger          | condition                                      | action             |
|------------------|------------------------------------------------|--------------------|
| STATUS:ESCALATE  | haiku detects circular argument in output      | fire immediately   |
| STALL            | 5 consecutive STATUS:CONTINUE rounds           | fire, reset count  |
| MAX_ROUNDS       | round counter hits max_rounds                  | fire, offer extend |

escalation fires at most once per 3 rounds to prevent spam
(add `LAST_ESC_ROUND` guard: if `round - LAST_ESC_ROUND < 3`, skip Telegram,
still block on reply.txt if already pending).
