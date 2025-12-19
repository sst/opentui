#!/bin/bash
# Test script for issue #334: Kitty Graphics Protocol query leaks into tmux pane title
#
# This script verifies that the kitty graphics query doesn't corrupt tmux pane titles.
# Run this inside tmux to test.
#
# Usage: ./test-tmux-graphics-334.sh
#
# Expected results:
#   - Test 1 (Direct query): FAIL - demonstrates the bug
#   - Test 2 (DCS passthrough): PASS - demonstrates the fix
#   - Test 3 (No query): PASS - control test

set -e

SESSION_NAME="opentui-test-334-$$"
EXPECTED_TITLE="test-title"

cleanup() {
    tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
}
trap cleanup EXIT

run_test() {
    local test_name="$1"
    local query_cmd="$2"
    
    cleanup
    tmux new-session -d -s "$SESSION_NAME" -x 80 -y 24
    tmux select-pane -t "$SESSION_NAME" -T "$EXPECTED_TITLE"
    
    if [ -n "$query_cmd" ]; then
        tmux send-keys -t "$SESSION_NAME" "$query_cmd" Enter
        sleep 0.5
    fi
    
    local after_title
    after_title=$(tmux display-message -t "$SESSION_NAME" -p '#{pane_title}')
    
    if [[ "$after_title" == *"Gi=31337"* ]] || [[ "$after_title" == *"i=31337"* ]]; then
        echo "FAIL: $test_name - pane title corrupted: '$after_title'"
        return 1
    elif [[ "$after_title" != "$EXPECTED_TITLE" ]]; then
        echo "WARN: $test_name - pane title changed: '$after_title'"
        return 1
    else
        echo "PASS: $test_name"
        return 0
    fi
}

echo "=== Issue #334 Test: Kitty Graphics Query in tmux ==="
echo "tmux version: $(tmux -V)"
echo ""

echo "Test 1: Direct query (demonstrates bug)"
run_test "Direct kitty graphics query" \
    "printf '\\x1b_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\\x1b\\\\\\x1b[c'" || true

echo "Test 2: DCS passthrough wrapped query (demonstrates fix)"
run_test "DCS passthrough wrapped" \
    "printf '\\x1bPtmux;\\x1b\\x1b_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\\x1b\\x1b\\\\\\x1b\\x1b[c\\x1b\\\\'"

echo "Test 3: No query (control)"
run_test "No query" ""

echo ""
echo "If Test 1 fails and Test 2 passes, the fix is working correctly."
