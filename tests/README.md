# mentiko tests

test structure for mentiko project.

## test organization

### unit tests (tests/)

focused unit tests for individual library functions:

- `test-run-system.sh` - tests for run-lib.sh functions
- `test-webhooks.sh` - tests for webhook-sender.sh retry logic
- `test-chain-runner.sh` - chain execution tests
- `test-runner.sh` - misc runner tests

### e2e tests (tests/e2e/)

end-to-end integration tests:

- `test-run-object.sh` - run creation and retrieval
- `test-webhook-sender.sh` - webhook delivery and retry
- `test-auth-flow.sh` - login, protected routes, session mgmt
- `test-remote-workspace.sh` - ssh/docker workspace sessions
- `test-parallel-agents.sh` - parallel agent coordination
- `test-conditional-branching.sh` - branch evaluation and selection

## running tests

### run all e2e tests
```bash
./tests/run-all-e2e.sh
```

### run specific e2e test
```bash
./tests/run-all-e2e.sh test-run-object.sh
```

### run unit tests directly
```bash
./tests/test-run-system.sh
./tests/test-webhooks.sh
```

## requirements

- bash 4+
- jq (json parsing)
- pty-manager (bin/p) for agent session tests (all workspace types)
- curl (for api/auth tests)
- nc/netcat (for webhook mock server)
- node.js 18+ (for auth flow web ui tests)

## test naming convention

- unit tests: `test-<feature>.sh`
- e2e tests: `test-<feature>.sh` (in e2e/ subdir)

## adding new tests

1. create test file in appropriate directory
2. include shebang: `#!/bin/bash`
3. use `set -euo pipefail` for error handling
4. use ✔/✖ icons for pass/fail output
5. exit 0 on success, 1 on failure
6. add to `TESTS` array in `run-all-e2e.sh` if e2e

## fixtures

test fixtures and mock data go in `tests/fixtures/`.
