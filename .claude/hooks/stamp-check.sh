#!/usr/bin/env bash
# Called by `npm run check`: `start` records the files' fingerprint before checking; `pass`
# promotes it once every check succeeded. The Stop hook compares against it. PROTECTED.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  mkdir -p "$STATE_DIR"
  case "${1:-}" in
    start) fingerprint > "$STATE_DIR/check-start" ;;
    pass) cp "$STATE_DIR/check-start" "$STATE_DIR/check-pass" ;;
    *) echo "usage: stamp-check.sh start|pass" >&2; exit 2 ;;
  esac
}

run_guarded main "$@"
