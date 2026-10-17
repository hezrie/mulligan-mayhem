#!/usr/bin/env bash
# Stop (worker only): the worker may not finish with code that `npm run check` hasn't passed on.
# Allowed to stop if the worker escalated, or if everything is committed and either nothing changed
# (e.g. a plan-only run) or the last passing check ran on exactly the current files. PROTECTED.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  [ "${AGENT_MODE:-}" = "worker" ] || exit 0
  cat >/dev/null # stdin unused

  [ -f "$STATE_DIR/escalated" ] && exit 0
  # Only commits are shipped (as a git bundle), so every change must be committed: a check that
  # passed on uncommitted or untracked files proves nothing about what gets pushed.
  dirty="$(git -C "$PROJECT_DIR" status --porcelain --untracked-files=all)" || block "git status failed"
  if [ -n "$dirty" ]; then
    echo "commit every change before stopping (git add, then git commit); uncommitted files are not shipped:" >&2
    printf '%s\n' "$dirty" | sed -n '1,10p' >&2
    exit 2
  fi
  now="$(fingerprint)"
  [ -f "$STATE_DIR/session-start" ] && [ "$now" = "$(cat "$STATE_DIR/session-start")" ] && exit 0
  [ -f "$STATE_DIR/check-pass" ] && [ "$now" = "$(cat "$STATE_DIR/check-pass")" ] && exit 0

  echo "run npm run check and fix failures, or escalate" >&2
  echo "(npm run check has not passed on the current files; to escalate: npx tsx scripts/agent/escalate.ts \"<reason>\")" >&2
  exit 2
}

run_guarded main "$@"
