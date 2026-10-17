#!/usr/bin/env bash
# PreToolUse (Edit|Write|MultiEdit|NotebookEdit): blocks agent edits to protected paths. PROTECTED.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  agent_mode_active || exit 0
  require_jq

  input="$(cat)"
  tool="$(printf '%s' "$input" | jq -r '.tool_name // empty')" || block "unreadable hook input"
  paths="$(printf '%s' "$input" | jq -r '
    [.tool_input.file_path, .tool_input.notebook_path, .tool_input.path, (.tool_input.edits // [] | .[].file_path)]
    | map(select(type == "string" and . != "")) | unique | .[]')" || block "unreadable hook input"
  [ -n "$paths" ] || block "$tool call without a file path"

  while IFS= read -r path; do
    rel="$(to_rel "$path")"
    case "$rel" in
      @outside:*)
        is_temp_path "${rel#@outside:}" || block "writing outside the project is not allowed: ${rel#@outside:}"
        continue
        ;;
    esac
    if [ "${AGENT_MODE}" = "digest" ] && { [ "$rel" = "CLAUDE.md" ] || [ "$rel" = ".agent/LESSONS.md" ]; }; then
      continue # the weekly digest proposes rulebook updates in a PR that the owner merges
    fi
    if is_protected "$rel"; then
      block "$rel is a protected path (see protectedPaths in agent.config.json)"
    fi
    if is_golden "$rel" && [ "${AGENT_ALLOW_GOLDEN:-0}" != "1" ]; then
      if [ "$tool" != "Write" ] || exists_on_base "$rel"; then
        block "$rel is an existing golden replay; changing it requires the physics-change label"
      fi
    fi
  done <<< "$paths"
  exit 0
}

run_guarded main "$@"
