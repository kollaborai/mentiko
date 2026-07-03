# Testing Chains

Testing strategies for agent chains.

## Overview

Agent chains require different testing approaches than traditional software due to non-deterministic LLM outputs. Testing focuses on structure validation, property-based checks, and end-to-end validation.

## Challenges

**Non-Determinism:**
- Same prompt can produce different outputs
- Model updates change behavior
- Context affects responses

**Testing Anti-Patterns:**
- Exact string matching - fails with natural language variation
- Snapshot testing - fragile with model updates
- Mocking LLM - defeats testing purpose

## Strategies

### Schema Validation

Validate output structure rather than exact content.

**JSON Schema:**
```json
{
  "type": "object",
  "properties": {
    "title": {"type": "string"},
    "sections": {"type": "array"},
    "word_count": {"type": "number"}
  },
  "required": ["title", "sections"]
}
```

**Test:**
```python
import jsonschema

def validate_agent_output(output):
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "sections": {"type": "array"},
            "word_count": {"type": "number"}
        },
        "required": ["title", "sections"]
    }
    
    parsed = json.loads(output)
    jsonschema.validate(parsed, schema)
```

### Property-Based Testing

Test output properties instead of exact values.

**Properties to Check:**
- Contains expected sections (introduction, body, conclusion)
- Meets length constraints (word count, character count)
- Uses expected format (markdown, JSON)
- No forbidden patterns (PII, profanity)

**Example:**
```python
def test_summary_properties(summary):
    assert "summary" in summary.lower()
    assert len(summary.split()) > 100  # Minimum length
    assert "TODO" not in summary  # No placeholders
    assert len(summary) < 5000  # Maximum length
```

### Regression Tests

Catch unexpected behavior changes by comparing against known-good outputs.

**Approach:**
1. Run chain with fixed input
2. Store output as regression baseline
3. On subsequent runs, compare for structural similarity
4. Alert if output deviates significantly

**Implementation:**
```bash
# Run chain and capture output
mentiko run chains/research.json --topic "AI trends" \
  > /runs/latest/output.md

# Compare with baseline
diff -u /runs/baseline/output.md /runs/latest/output.md

# Check similarity score
similarity_score=$(compare_output \
  /runs/baseline/output.md \
  /runs/latest/output.md)

if [ "$similarity_score" -lt 0.8 ]; then
  echo "Regression detected"
fi
```

### End-to-End Validation

Test entire chain execution with real inputs.

**Test Cases:**
- Chain completes without errors
- All agents execute in correct order
- Event emissions match triggers
- Output files created in expected locations
- Watchdog detects stalled runs

**Implementation:**
```python
def test_e2e_chain_execution():
    # Run chain
    run_id = mentiko.run("chains/test.json", topic="test")
    
    # Verify execution
    events = mentiko.list_events(run_id)
    assert "research:complete" in events
    assert "summary:complete" in events
    assert "chain:complete" in events
    
    # Verify outputs
    assert os.path.exists(f"/runs/{run_id}/researcher/output.md")
    assert os.path.exists(f"/runs/{run_id}/summarizer/output.md")
```

### Prompt Regression Tests

Test that prompts still produce expected output types.

**Approach:**
- Store successful prompt-output pairs
- Re-run prompts periodically
- Validate output still meets schema
- Flag prompts that produce failures

## Debugging

### Inspect Events

```bash
# List all events from run
ls namespaces/default/events/*.event

# Read specific event
cat namespaces/default/events/researcher-complete.event

# Find failed events
grep '"status":"failed"' namespaces/default/events/*.event
```

### Check Agent Output

```bash
# View agent output
cat /runs/{run_id}/agent/output.md

# Check for errors
grep -i "error" /runs/{run_id}/agent/output.md
```

### PTY Session Logs

```bash
# View PTY session activity
pty-manager status --session "$session_id"

# View session output
pty-manager read --session "$session_id"
```

## Test Organization

### Directory Structure

```
tests/
├── unit/              # Schema validation tests
├── integration/       # End-to-end chain tests
├── regression/        # Regression baselines
└── fixtures/          # Test inputs and baselines
```

### Test Data

**Fixtures:**
- Sample chain definitions
- Test input prompts
- Expected output schemas
- Regression baselines

**CI Integration:**
```bash
# Run all tests
npm test

# Run specific test suite
npm test -- integration

# Update regression baselines
npm test -- regression --update-baseline
```

## Common Issues

**Flaky Tests:**
- Non-deterministic LLM output
- Fix: Use property-based tests instead of exact matching
- Add retry logic with backoff

**Slow Tests:**
- Chain execution takes time
- Fix: Use mock fixtures for rapid iteration, real chains for validation
- Parallelize independent tests

**Environment Differences:**
- Tests pass locally but fail in CI
- Fix: Containerize test environment, isolate dependencies

## Best Practices

**Design for Testability:**
- Structure outputs for validation (JSON, markdown)
- Use consistent naming conventions
- Include test identifiers in outputs

**Test Granularity:**
- Test agent outputs independently
- Test event emission separately from chain execution
- Test workspace operations separately

**Continuous Testing:**
- Run tests on chain definition changes
- Run regression tests on model updates
- Test in production-like environment

## Related

- [Agent Chains](/concepts/agent-chains)
- [Events](/reference/events)
- [Production Monitoring](/guides/production)
- [Troubleshooting](/guides/self-hosting#troubleshooting)
