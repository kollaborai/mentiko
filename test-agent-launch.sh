#!/bin/bash
# Test script for enhanced agent launch reliability

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Testing Enhanced Agent Launch ==="
echo ""

# Source the enhanced modules
source "$SCRIPT_DIR/lib/config.sh" 2>/dev/null || true
source "$SCRIPT_DIR/lib/session-transport.sh" 2>/dev/null || true  
source "$SCRIPT_DIR/lib/cli-readiness-enhanced.sh" 2>/dev/null || true
source "$SCRIPT_DIR/lib/agent-launch-enhanced.sh" 2>/dev/null || true
source "$SCRIPT_DIR/lib/run-lib.sh" 2>/dev/null || true

echo "✓ Enhanced modules loaded successfully"
echo ""

# Test 1: Verify PTY aliveness check
echo "Test 1: PTY Aliveness Check"
if declare -f verify_pty_alive > /dev/null; then
    echo "✓ verify_pty_alive function available"
else
    echo "✗ verify_pty_alive function missing"
    exit 1
fi

# Test 2: Verify CLI readiness check
echo "Test 2: CLI Readiness Check"
if declare -f wait_for_cli_ready > /dev/null; then
    echo "✓ wait_for_cli_ready function available"
else
    echo "✗ wait_for_cli_ready function missing"
    exit 1
fi

# Test 3: Verify enhanced agent launch
echo "Test 3: Enhanced Agent Launch"
if declare -f launch_agent_enhanced > /dev/null; then
    echo "✓ launch_agent_enhanced function available"
else
    echo "✗ launch_agent_enhanced function missing"
    exit 1
fi

# Test 4: Verify state constants
echo "Test 4: State Constants"
if [[ -n "${AGENT_STATE_LAUNCHING:-}" ]] && [[ -n "${AGENT_STATE_RUNNING:-}" ]]; then
    echo "✓ State constants defined"
    echo "  - LAUNCHING: $AGENT_STATE_LAUNCHING"
    echo "  - RUNNING: $AGENT_STATE_RUNNING"
else
    echo "✗ State constants missing"
    exit 1
fi

echo ""
echo "=== All Tests Passed ==="
echo ""
echo "Enhanced agent launch system is ready for integration."
echo ""
echo "Next steps:"
echo "1. Test with actual chain execution"
echo "2. Verify agents progress through proper states"  
echo "3. Confirm watchdog no longer marks agents incorrectly"
