#!/usr/bin/env bash
# SessionStart: guardrail canary. Agent workflows fail if this marker is missing, which proves the
# hooks actually loaded. Also records the starting fingerprint for the Stop hook. PROTECTED.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  agent_mode_active || exit 0
  mkdir -p "$STATE_DIR"
  printf '%s %s\n' "$AGENT_MODE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE_DIR/hooks-active"
  [ -f "$STATE_DIR/session-start" ] || fingerprint > "$STATE_DIR/session-start"
  exit 0
}

run_guarded main "$@"
