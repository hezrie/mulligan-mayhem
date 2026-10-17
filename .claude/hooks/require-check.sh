#!/usr/bin/env bash
# Stop (worker only): the worker may not finish with code that `npm run check` hasn't passed on.
# Allowed to stop if nothing changed (e.g. a plan-only run), if the last passing check ran on
# exactly the current files, or if the worker escalated. PROTECTED.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  [ "${AGENT_MODE:-}" = "worker" ] || exit 0
  cat >/dev/null # stdin unused

  [ -f "$STATE_DIR/escalated" ] && exit 0
  now="$(fingerprint)"
  [ -f "$STATE_DIR/session-start" ] && [ "$now" = "$(cat "$STATE_DIR/session-start")" ] && exit 0
  [ -f "$STATE_DIR/check-pass" ] && [ "$now" = "$(cat "$STATE_DIR/check-pass")" ] && exit 0

  echo "run npm run check and fix failures, or escalate" >&2
  echo "(npm run check has not passed on the current files; to escalate: npx tsx scripts/agent/escalate.ts \"<reason>\")" >&2
  exit 2
}

run_guarded main "$@"
