#!/usr/bin/env bash
# Shared helpers for the agent guardrail hooks. PROTECTED.
#
# Hooks enforce ONLY when AGENT_MODE is set (worker | reviewer | refiner | digest), so the owner's
# interactive sessions are never blocked. They fail CLOSED: any internal error exits 2 (block),
# because Claude Code treats other non-zero exits as non-blocking.
# Must stay compatible with bash 3.2 (macOS) and bash 5 (GitHub runners).

set -Euo pipefail
trap 'echo "guardrail hook failed unexpectedly (line $LINENO); blocking for safety" >&2; exit 2' ERR

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$HOOK_DIR/../.." && pwd)}"
STATE_DIR="${AGENT_STATE_DIR:-$PROJECT_DIR/.agent/.state}"
CONFIG="$PROJECT_DIR/agent.config.json"

agent_mode_active() { [ -n "${AGENT_MODE:-}" ]; }

# Runs a hook's main function in a subshell and maps EVERY non-zero exit to 2. Even a bug in a
# hook (a syntax error, an unexpected failure) then blocks instead of silently allowing.
run_guarded() {
  local rc
  # Not inside an `||`/`&&` list: there bash would silently disable the ERR trap for the whole
  # subshell, and a failing command in the hook would fall through to "allow".
  trap - ERR
  (
    trap 'echo "guardrail hook failed unexpectedly (line $LINENO); blocking for safety" >&2; exit 2' ERR
    "$@"
  )
  rc=$?
  [ "$rc" -eq 0 ] && exit 0
  exit 2
}

block() {
  echo "BLOCKED by guardrail: $1" >&2
  echo "If this is genuinely required, stop and escalate: npx tsx scripts/agent/escalate.ts \"<reason>\"" >&2
  exit 2
}

require_jq() { command -v jq >/dev/null 2>&1 || block "jq is required by the guardrail hooks"; }

# Same glob semantics as scripts/agent/protected.ts: anchored, ** = anything, * = anything but '/'.
JQ_GLOB='def g2r: gsub("(?<c>[.+?^${}()|\\[\\]\\\\])"; "\\\(.c)") | gsub("\\*\\*"; "\u0001") | gsub("\\*"; "[^/]*") | gsub("\u0001"; ".*") | "^" + . + "$";'

# Prints each repo-relative path (one per line on stdin) that matches the given config list.
matching_paths() { # $1 = protectedPaths | goldenPaths
  jq -R . | jq -s . | jq -r --slurpfile cfg "$CONFIG" --arg key "$1" "$JQ_GLOB"'
    .[] as $p | select(any(($cfg[0][$key] // error("agent.config.json has no \($key)"))[]; . as $g | $p | test($g | g2r))) | $p'
}

# Each lookup is assigned (never tested inline as "$(...)"), so a failing jq blocks instead of
# reading as "no match".
is_protected() {
  local hits
  hits="$(printf '%s\n' "$1" | matching_paths protectedPaths)" || block "could not evaluate protectedPaths"
  [ -z "$hits" ] || return 0
  hits="$(printf '%s\n' "$1" | matching_paths workspaceProtectedPaths)" || block "could not evaluate workspaceProtectedPaths"
  [ -n "$hits" ]
}
is_golden() {
  local hits
  hits="$(printf '%s\n' "$1" | matching_paths goldenPaths)" || block "could not evaluate goldenPaths"
  [ -n "$hits" ]
}

# Collapses '.' and '..' in an absolute path (purely lexical; bash 3.2 compatible).
lexical_normalize() {
  local IFS='/' seg
  local -a parts out
  read -ra parts <<< "$1"
  out=()
  for seg in "${parts[@]+"${parts[@]}"}"; do
    case "$seg" in
      '' | .) ;;
      ..) if [ "${#out[@]}" -gt 0 ]; then unset "out[$((${#out[@]} - 1))]"; fi ;;
      *) out+=("$seg") ;;
    esac
  done
  printf '/%s' "${out[@]+"${out[@]}"}"
  [ "${#out[@]}" -eq 0 ] && printf '/'
  printf '\n'
}

# Resolves symlinks in the deepest existing ancestor, so a symlink can't smuggle a write past us.
# A directory we may not enter (e.g. /root) keeps its lexical path.
physical_path() {
  local p rest="" resolved
  p="$(lexical_normalize "$1")"
  while [ ! -e "$p" ] && [ "$p" != "/" ]; do
    rest="/$(basename "$p")$rest"
    p="$(dirname "$p")"
  done
  if [ -d "$p" ]; then
    resolved="$(cd "$p" 2>/dev/null && pwd -P)" || resolved="$p"
  else
    resolved="$(cd "$(dirname "$p")" 2>/dev/null && pwd -P)/$(basename "$p")" || resolved="$p"
  fi
  printf '%s%s\n' "${resolved%/}" "$rest"
}

# Drops the bodies of quoted heredocs (<<'EOF' / <<"EOF"): their text is literal stdin data.
strip_quoted_heredocs() {
  awk '
    delim != "" { line = $0; sub(/^\t+/, "", line); if (line == delim) delim = ""; next }
    {
      print
      if (match($0, /<<-?[ \t]*'"'"'[A-Za-z_][A-Za-z0-9_]*'"'"'/) || match($0, /<<-?[ \t]*"[A-Za-z_][A-Za-z0-9_]*"/)) {
        d = substr($0, RSTART, RLENGTH)
        sub(/^<<-?[ \t]*./, "", d)
        delim = substr(d, 1, length(d) - 1)
      }
    }'
}

ROOT_PHYS="$(cd "$PROJECT_DIR" && pwd -P)"

# Prints the repo-relative path, or "@outside:<abs>" for paths outside the project.
to_rel() {
  local abs="$1"
  case "$abs" in /*) ;; *) abs="$PROJECT_DIR/$abs" ;; esac
  abs="$(physical_path "$abs")"
  case "$abs" in
    "$ROOT_PHYS") printf '.\n' ;;
    "$ROOT_PHYS"/*) printf '%s\n' "${abs#"$ROOT_PHYS"/}" ;;
    *) printf '@outside:%s\n' "$abs" ;;
  esac
}

is_temp_path() { # $1 = absolute physical path
  local t
  for t in /tmp /private/tmp /var/folders "${TMPDIR:-/nonexistent}" "${RUNNER_TEMP:-/nonexistent}"; do
    t="$(physical_path "$t")"
    case "$1" in "$t" | "$t"/*) return 0 ;; esac
  done
  return 1
}

# Does the file already exist on the base branch? (origin/main if fetched, else HEAD.)
exists_on_base() {
  local ref=HEAD
  if git -C "$PROJECT_DIR" rev-parse -q --verify origin/main >/dev/null 2>&1; then ref=origin/main; fi
  git -C "$PROJECT_DIR" cat-file -e "$ref:$1" 2>/dev/null
}

# Content fingerprint of every non-ignored file (tracked or not). Commits don't change it;
# any edit, by any tool, does.
fingerprint() {
  local root="${1:-$PROJECT_DIR}" files
  files="$(cd "$root" && git ls-files -co --exclude-standard | LC_ALL=C sort -u | while IFS= read -r f; do
    if [ -f "$f" ]; then printf '%s\n' "$f"; fi
  done)"
  if [ -z "$files" ]; then
    printf 'empty\n'
    return
  fi
  (cd "$root" && paste <(printf '%s\n' "$files") <(printf '%s\n' "$files" | git hash-object --stdin-paths) | git hash-object --stdin)
}
