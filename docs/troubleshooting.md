# Troubleshooting Guide

common issues and solutions.

---

cli issues

mentiko: command not found

  cause: not in PATH or not installed

  solutions:
    # install globally
    npm install -g mentiko

    # or add to PATH (if cloned)
    export PATH="$PWD/bin:$PATH"
    echo 'export PATH="$PWD/bin:$PATH"' >> ~/.bashrc

    # verify installation
    which mentiko

---

permission denied: bin/mentiko

  cause: script not executable

  solution:
    chmod +x bin/mentiko

---

pty-manager sessions not found

  cause: pty-manager not running or not in PATH

  solutions:
    # check pty-manager works
    bin/p list

    # verify bin/ is in PATH
    export PATH="$PWD/bin:$PATH"

    # list sessions manually
    p list

---

agent launches but immediately exits

  cause: invalid AI CLI or missing spec

  solutions:
    # verify your AI CLI works
    claude --version
    # or
    claude --version

    # check spec file exists
    cat agents/specs/my-agent.agent.md

    # try launching manually
    p create test "claude 'say hello'"

---

agent hangs forever

  cause: agent waiting for input or stuck

  solutions:
    # peek at the session
    mentiko peek <session-name>

    # send a nudge
    mentiko send <session-name> "please continue"

    # kill the session
    p destroy <session-name>

---

event not triggering next agent

  cause: event file not written or wrong event name

  solutions:
    # check the actual resolved event directory
    echo "$EVENTS_DIR"
    mentiko events --unprocessed

    # read event file
    cat "$EVENTS_DIR"/*.event

    # check next agent's triggers in the active chain json
    jq '.agents[] | {id, triggers, emits}' <chain.json>

    # manually trigger (inside an agent session, source defaults to $MENTIKO_AGENT_ID)
    mentiko emit <event-name> [source]

---

event file format not recognized

  cause: parser doesn't recognize format

  solution: the universal parser handles most formats, but verify:
    - file ends in .event, .md, or .json
    - contains "event:" or "event" key
    - event name doesn't have special chars

  if all else fails, verify the canonical emitter:
    EVENTS_DIR=agents/events MENTIKO_RUN_ID=<run-id> MENTIKO_AGENT_ID=<agent-id> mentiko emit my-event

---

web ui issues

web ui won't start

  cause: missing dependencies or port in use

  solutions:
    # check node version (must be 18+)
    node --version

    # clean install
    cd web
    rm -rf node_modules package-lock.json
    npm install

    # try different port
    WEB_PORT=3001 npm run dev

---

auth errors (401 unauthorized)

  cause: no valid Better Auth session for the request

  solutions:
    # open /login and sign in (email/password or OAuth)
    # then retry the request

    # verify auth env is set correctly in production
    echo $BETTER_AUTH_SECRET
    echo $BETTER_AUTH_URL

    # confirm session status
    curl -s http://localhost:3000/api/auth/me

---

chains not loading

  cause: wrong directory or permissions

  solutions:
    # check chain directory
    ls namespaces/default/chains/

    # verify chain.json format
    cat namespaces/default/chains/*/chain.json | jq .

    # check logs
    cd web && npm run dev 2>&1 | grep error

---

api returns 500 errors

  cause: backend script failing

  solutions:
    # check mentiko binary works
    cd .. && ./bin/mentiko list

    # check root path is correct
    echo $MENTIKO_ROOT

    # test endpoint directly
    curl http://localhost:3000/api/health

---

real-time updates not working

  cause: event stream not connected

  solutions:
    # check sse endpoint
    curl http://localhost:3000/api/events/stream

    # verify browser supports eventsource
    # check console for errors

---

agent issues

agent not following instructions

  cause: prompt too vague or agent confused

  solutions:
    # make prompts specific
    prompt: "write exactly 3 bullet points about X"
    # not: "tell me about X"

    # use playbooks with numbered steps
    playbooks:
      1-read:
        - read file A
        - summarize in 1 sentence
      2-write:
        - write summary to output.md

    # add context files
    context:
      read_first:
        - docs/brief.md
        - examples/good-output.md

---

agent in infinite loop

  cause: agent repeating same action

  solutions:
    # add success metrics to spec
    success-metrics:
      - output.md exists and is > 100 chars

    # set max_rounds in config
    config:
      max_rounds: 5

    # use monitor to detect and kill
    mentiko launch spec.agent.md --monitor

---

agent creates wrong output format

  cause: instructions not specific enough

  solutions:
    # give exact format example
    playbooks:
      1-write:
        - create file output.json
        - format must be:
          {"summary": "...", "details": ["...", "..."]}

    # validate output with jq
    playbooks:
      3-validate:
        - run: jq . output.json
        - if fails, fix the format

---

agent ignoring authority restrictions

  cause: not enforced (it's just documentation)

  solution: mentiko doesn't block actions. the authority section
  is for agent guidance, not enforcement. use:
    - clear prompts: "only read these files, never write"
    - file permissions: chmod a-w critical-files
    - review agent: have another agent check work

---

monitor issues

monitor not nudging stalled agents

  cause: monitor_interval too high or monitor not running

  solutions:
    # check monitor is enabled
    ps aux | grep monitor

    # reduce interval for testing
    export MENTIKO_MONITOR_INTERVAL=30

    # manually run monitor check
    cd lib && ./monitor-check.sh <session-name>

---

monitor kills agent unexpectedly

  cause: max_rounds reached or timeout

  solutions:
    # check agent rounds
    cat agents/state/*.state | grep rounds

    # increase max_rounds
    config:
      max_rounds: 100

    # disable monitor for testing
    mentiko launch spec.agent.md
    # without --monitor flag

---

integration issues

github issues not created

  cause: missing token or permissions

  solutions:
    # verify token
    echo $GITHUB_TOKEN

    # test token
    curl -H "Authorization: token $GITHUB_TOKEN" \
      https://api.github.com/user

    # check repo permissions
    # token needs "repo" scope

---

slack webhook not sending

  cause: wrong url or blocked by workspace

  solutions:
    # test webhook manually
    curl -X POST $SLACK_WEBHOOK_URL \
      -H 'Content-Type: application/json' \
      -d '{"text":"test message"}'

    # verify url in slack app settings

---

email not sending

  cause: smtp not configured or blocked

  solutions:
    # test smtp connection
    telnet smtp.gmail.com 587

    # check email config
    echo $CHAIN_EMAIL_SMTP

    # use app password if gmail
    # https://myaccount.google.com/apppasswords

---

workspace issues

ssh workspace not connecting

  cause: wrong credentials or key not loaded

  solutions:
    # test ssh manually
    ssh user@host

    # add key to ssh-agent
    ssh-add ~/.ssh/id_rsa

    # verify key in config
    cat workspace-ssh-example.json | jq .config.workspace.ssh

---

docker workspace command fails

  cause: container not running or wrong path

  solutions:
    # list containers
    docker ps

    # verify container exists
    docker inspect <container-name>

    # test command manually
    docker exec <container-name> ls /path/in/container

---

performance issues

too many pty sessions

  cause: sessions not cleaned up after completion

  solutions:
    # kill all mentiko sessions
    mentiko cleanup

    # or manually
    p list
    p destroy <session-name>

---

disk space full from events

  cause: old event files not cleaned

  solutions:
    # remove processed events
    rm agents/events/*.processed

    # archive old events
    mkdir -p agents/events/archive
    mv agents/events/*.event agents/events/archive/

---

high cpu usage

  cause: monitor checking too frequently

  solutions:
    # increase monitor interval
    export MENTIKO_MONITOR_INTERVAL=120

    # reduce concurrent agents
    export MAX_CONCURRENT_AGENTS=5

---

memory leak

  cause: node process growing or pty sessions accumulating

  solutions:
    # restart web ui
    pm2 restart mentiko

    # monitor memory
    ps aux | grep node

    # kill orphaned pty sessions
    p list
    mentiko kill-all

---

debugging

enable debug logging:

  export MENTIKO_DEBUG=1
  mentiko launch spec.agent.md

view agent output in real-time:

  p read <session-name>
  # or use mentiko peek <session-name>

check event processing:

  tail -f agents/events/*.event

view run state:

  cat agents/runs/run-*/run.json | jq .

test chain without running:

  mentiko validate chain.json

---

getting help

if issues persist:

  1. check logs:
     tail -f agents/chain.log

  2. enable debug mode
  3. run with single agent first
  4. verify each step manually
  5. open github issue with:
     - mentiko version
     - os and versions
     - exact command run
     - full error message
     - relevant config files (redact secrets)
