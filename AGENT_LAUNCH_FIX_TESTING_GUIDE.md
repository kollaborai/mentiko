# Agent Launch Reliability Fix - Testing Guide

## Status
✅ Implementation complete and tested
✅ Integration into chain-runner.sh complete
✅ Ready for production testing

## What Was Fixed

**Root Cause**: Agents were marked "running" before CLI was verified ready, causing watchdog to detect stalled agents and mark them "stopped".

**Solution**: Enhanced agent launch with proper state progression and CLI readiness verification.

## Testing Instructions

### 1. Test with Previously Failing Chains

Test the chain that was failing before:
```bash
cd /Users/malmazan/dev/platform/mentiko
./bin/mentiko run ~/.mentiko/namespaces/default/chains/ambient-fs-code-review-fix-chain/chain.json
```

**Expected Results**:
- ✅ Agent 1 (code-review-analyst) should complete successfully
- ✅ Agent 2 (bug-fix-implementer) should progress through "launching" → "starting" → "running"
- ✅ No more agents stuck in "stopped" state
- ✅ All 4 agents should complete successfully

### 2. Monitor Agent States

Watch the agent state transitions:
```bash
# Watch run state
watch -n 2 'cat ~/.mentiko/namespaces/default/runs/run-*/run.json | jq -r ".[] | select(.chain == \"ambient-fs-code-review-fix-chain\") | {status: .status, agents: [.agents[] | {id: .id, status: .status}]}"'
```

**Expected State Progression**:
1. Agent created: `"launching"`
2. CLI starting: `"starting"`  
3. CLI verified ready: `"running"`
4. Agent work complete: `"complete"`

### 3. Check for Proper Error Handling

Test with a chain that has authentication issues:
- Should detect auth prompts early
- Should mark agent as "blocked" not "stopped"
- Should provide clear error messages

### 4. Verify Watchdog Behavior

Confirm watchdog no longer marks healthy agents as "stopped":
- Agents that are truly "running" should stay "running"
- Only actually stalled agents should be marked "stopped"

## Success Criteria

✅ **No more agents stuck in "stopped" state after successful launch**
✅ **Clear error messages for authentication issues**
✅ **Accurate agent states in run.json**
✅ **Reliable multi-agent chain execution**
✅ **Watchdog only detects actually stalled agents**

## Monitoring

Check system logs for state transitions:
```bash
tail -f ~/.mentiko/namespaces/default/logs/system.jsonl | grep "agent-launch"
```

Look for proper state transitions:
- `"state: launching - Creating PTY session"`
- `"state: starting - Launching CLI"`
- `"state: running - CLI verified ready, agent running"`

## Rollback Plan

If issues occur, rollback is simple:
```bash
cd /Users/malmazan/dev/platform/mentiko/lib
cp chain-runner.sh.backup chain-runner.sh
```

## Next Steps After Testing

If testing is successful:
1. Deploy to production
2. Monitor chain execution reliability
3. Collect metrics on success rates
4. Proceed with go-live

## Known Limitations

- Timeout settings (30-60s) may need adjustment for slower systems
- Some CLI types may need additional readiness patterns
- Edge cases may require additional error handling

## Contact

If issues arise during testing, check:
1. System logs: `~/.mentiko/namespaces/default/logs/system.jsonl`
2. Run states: `~/.mentiko/namespaces/default/runs/*/run.json`
3. PTY sessions: `./bin/p list`
