#!/usr/bin/env bash
# PreToolUse (Bash): blocks dangerous or out-of-bounds shell commands for agents. PROTECTED.
# Best-effort by nature (a shell is Turing-complete). The hard walls are: the agent's token
# can't push or merge, CI `agent-guard`, CODEOWNERS, and the bot App's lack of workflow scope.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  agent_mode_active || exit 0
  require_jq
  set -f # never glob-expand words from the command inside this hook

  cmd="$(cat | jq -r '.tool_input.command // empty')" || block "unreadable hook input"
  [ -n "$cmd" ] || exit 0
  # The checks below pipe the command into grep. Above the smallest pipe buffer (16 KiB on macOS)
  # an early grep -q match can SIGPIPE the writer and read as "no match", so huge commands are
  # refused outright: fail closed.
  [ "$(printf '%s' "$cmd" | LC_ALL=C wc -c | tr -d ' ')" -le 12000 ] \
    || block "command is too long for the guardrail to check (over 12000 bytes); split it up"

  # Escalating must always work. Exactly one plain quoted argument: no quotes, $ or backticks
  # inside it, so nothing can be chained or substituted. Single-line only: grep matches line by
  # line, so a second line could otherwise ride along unchecked.
  case "$cmd" in
    *$'\n'* | *$'\r'*) ;;
    *)
      if printf '%s' "$cmd" | grep -Eq '^[[:space:]]*npx[[:space:]]+tsx[[:space:]]+scripts/agent/escalate\.ts[[:space:]]+("[^"$`\\]*"|'"'"'[^'"'"']*'"'"')[[:space:]]*$'; then
        exit 0
      fi
      ;;
  esac

  # Secrets are off-limits entirely.
  if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_])\.env($|[^[:alnum:]_])|(^|[^[:alnum:]_])secrets/'; then
    block "reading or touching .env files or secrets/ is not allowed"
  fi
  if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])(curl|wget)($|[^[:alnum:]_-])'; then
    block "network downloads (curl/wget) are not allowed"
  fi

  GIT_OPTS='([[:space:]]+(-C[[:space:]]+[^[:space:]]+|--?[[:alnum:]][^[:space:]]*))*'
  BUILD_DIRS='^(\./)?(dist|dist-e2e|coverage|test-results|playwright-report|blob-report)(/|$)'

  # Quoted heredoc bodies (<<'EOF' … EOF, e.g. a commit message) are literal data: never commands,
  # never paths. fd duplications (2>&1) and /dev/null redirects write nothing.
  scan="$(printf '%s\n' "$cmd" | strip_quoted_heredocs \
    | sed -E 's/[0-9]*>&[0-9-]+//g; s/&>>?[[:space:]]*\/dev\/null//g; s/[0-9]*>>?[[:space:]]*\/dev\/null//g')"

  # Split into simple commands on ; && || | ( ) $( and backticks, then check each one.
  segments="$(printf '%s\n' "$scan" | sed -E 's/(&&|\|\||;|\||\$\(|`|\(|\))/\
  /g')"
  while IFS= read -r seg; do
    seg="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//; s/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)+//; s/^(sudo|command|env|exec)[[:space:]]+//')"
    [ -n "$seg" ] || continue

    if printf '%s' "$seg" | grep -Eq "^git${GIT_OPTS}[[:space:]]+push([[:space:]]|$)"; then
      if printf '%s' "$seg" | grep -Eq '(--force|[[:space:]]-f([[:space:]]|$)|--force-with-lease)'; then
        block "force-pushing is never allowed"
      fi
      block "git push is done by the workflow, never by the agent (and never to main)"
    fi
    if printf '%s' "$seg" | grep -Eq "^git${GIT_OPTS}[[:space:]]+config([[:space:]]|$)|^git[[:space:]]+-c[[:space:]]"; then
      block "changing git config is not allowed"
    fi
    # The workflow prepared the branch. Moving to another branch or commit would swap the rules
    # (hooks, CLAUDE.md) under the running agent.
    if printf '%s' "$seg" | grep -Eq "^git${GIT_OPTS}[[:space:]]+switch([[:space:]]|$)"; then
      block "switching branches is not allowed: the workflow prepared your branch"
    fi
    if printf '%s' "$seg" | grep -Eq "^git${GIT_OPTS}[[:space:]]+checkout([[:space:]]|$)" \
      && ! printf '%s' "$seg" | grep -Eq "^git${GIT_OPTS}[[:space:]]+checkout[[:space:]]+(HEAD[[:space:]]+)?--([[:space:]]|$)"; then
      block "checking out another branch or commit is not allowed; to discard edits use: git checkout -- <paths>"
    fi
    if printf '%s' "$seg" | grep -Eq "^git${GIT_OPTS}[[:space:]]+restore([[:space:]]|$)" \
      && printf '%s' "$seg" | grep -Eq '(^|[[:space:]])(--source|-s)([=[:space:]]|$)|(^|[[:space:]])-s[^[:space:]]'; then
      block "restoring files from another commit is not allowed; to discard edits use: git restore <paths>"
    fi
    if printf '%s' "$seg" | grep -Eq "^git${GIT_OPTS}[[:space:]]+reset([[:space:]]|$)" \
      && printf '%s' "$seg" | grep -Eq '(^|[[:space:]])--(hard|merge|keep)([[:space:]]|$)'; then
      for word in $seg; do
        case "$word" in
          git | reset | -* | HEAD | HEAD~* | HEAD^*) ;;
          *) block "git reset --hard may only move within your own commits (HEAD, HEAD~N), not to: $word" ;;
        esac
      done
    fi
    if printf '%s' "$seg" | grep -Eq '^gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
      block "merging is done by the merger workflow, never by the agent"
    fi
    if printf '%s' "$seg" | grep -Eq '^gh[[:space:]]+(api|secret|variable|workflow|auth|repo|release|ruleset)([[:space:]]|$)'; then
      block "this gh command is not available to agents (use gh issue/pr view|comment)"
    fi
    if printf '%s' "$seg" | grep -Eq '^find[[:space:]]' \
      && printf '%s' "$seg" | grep -Eq '(^|[[:space:]])-(exec|execdir|ok|okdir|delete|fprint|fprintf|fls)([[:space:]]|$)'; then
      block "find may only search (no -exec/-delete); use the Glob and Grep tools"
    fi
    if printf '%s' "$seg" | grep -Eq '^npm[[:space:]]+(publish|install|i|add|uninstall|remove|rm|un|update|up|link)([[:space:]]|$)'; then
      block "changing dependencies or publishing is not allowed (package.json is protected): escalate"
    fi
    if printf '%s' "$seg" | grep -Eq '^npm[[:space:]]+run[[:space:]]+replay:record([[:space:]]|$)' \
      && printf '%s' "$seg" | grep -Eq '(^|[[:space:]])--update([[:space:]]|$)' && [ "${AGENT_ALLOW_GOLDEN:-0}" != "1" ]; then
      block "re-recording golden replays requires the physics-change label"
    fi
    if printf '%s' "$seg" | grep -Eq '^rm[[:space:]]'; then
      recursive=0
      targets=""
      for word in $seg; do
        case "$word" in
          rm) ;;
          --recursive) recursive=1 ;;
          --*) ;;
          -*) case "$word" in *[rR]*) recursive=1 ;; esac ;;
          *) targets="$targets $word" ;;
        esac
      done
      if [ "$recursive" = 1 ]; then
        for t in $targets; do
          t="${t%\"}"; t="${t#\"}"; t="${t%\'}"; t="${t#\'}"
          printf '%s' "$t" | grep -Eq "$BUILD_DIRS" || block "rm -r is only allowed inside build outputs (dist/, coverage/, test-results/, …), not: $t"
        done
      fi
    fi
  done <<< "$segments"

  # Shell writes into protected or golden paths: a write-ish operator plus a protected token.
  if printf '%s' "$scan" | grep -Eq '>|(^|[^[:alnum:]_-])(tee|sed[[:space:]]+-i|perl[[:space:]]+-[[:alnum:]]*i|mv|cp|rm|touch|truncate|ln|chmod|install|dd|git[[:space:]]+(checkout|restore|rm|mv|apply|am))([^[:alnum:]_-]|$)'; then
    tokens="$(printf '%s\n' "$scan" | tr -s " \t\"'=<>|;&()\`" '\n' | sed -E 's#^\./##' | grep -v '^$' || true)"
    rels="$(printf '%s\n' "$tokens" | while IFS= read -r tok; do
      case "$tok" in
        ('$PWD'/* | '${PWD}'/*) tok="$PROJECT_DIR/${tok#*/}" ;;
        ('~'/*) tok="$HOME/${tok#*/}" ;;
      esac
      case "$tok" in
        ('$?' | '$!' | '$#' | '$$' | '$-' | '${PIPESTATUS['*) ;; # exit codes and the like: never paths
        (*'$'*) printf '%s\n' "@dynamic:$tok" ;; # backticks were already split out above
        (*) r="$(to_rel "$tok")"; case "$r" in (@outside:*) ;; (*) printf '%s\n' "$r" ;; esac ;;
      esac
    done)"
    if printf '%s\n' "$rels" | grep -q '^@dynamic:'; then
      block "shell writes with variable or substituted paths are not allowed; write explicit paths"
    fi
    if [ -n "$rels" ]; then
      hit="$( (printf '%s\n' "$rels" | matching_paths protectedPaths; printf '%s\n' "$rels" | matching_paths workspaceProtectedPaths) | sed -n '1p')"
      [ -z "$hit" ] || block "shell write touching protected path $hit"
      if [ "${AGENT_ALLOW_GOLDEN:-0}" != "1" ]; then
        hit="$(printf '%s\n' "$rels" | matching_paths goldenPaths | sed -n '1p')"
        [ -z "$hit" ] || block "shell write touching golden replay $hit (use the Write tool for new replays)"
      fi
    fi
  fi
  exit 0
}

run_guarded main "$@"
