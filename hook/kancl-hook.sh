#!/bin/bash
# Kancl — Claude Code hook forwarder.
# Reads the hook JSON from stdin, adds terminal info, POSTs it to the local server.
# It must never block or fail Claude: every path exits 0 quickly.

PORT="${KANCL_PORT:-4242}"
INPUT=$(cat)
[ -z "$INPUT" ] && exit 0

# Walk up the process tree to find the `claude` process (hooks run via a shell).
pid=$PPID
claude_pid=""
for _ in 1 2 3 4 5 6; do
  if [ -z "$pid" ] || [ "$pid" = "0" ] || [ "$pid" = "1" ]; then break; fi
  cmd=$(ps -o command= -p "$pid" 2>/dev/null)
  case "$cmd" in
    *claude*) claude_pid=$pid; break ;;
  esac
  pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
done
[ -z "$claude_pid" ] && claude_pid=$PPID

tty=$(ps -o tty= -p "$claude_pid" 2>/dev/null | tr -d ' ')
if [ -n "$tty" ] && [ "$tty" != "??" ]; then tty="/dev/$tty"; else tty=""; fi

esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'; }

META=$(printf '{"program":"%s","bundleId":"%s","tty":"%s","termSessionId":"%s","itermSessionId":"%s","tmuxPane":"%s","weztermPane":"%s","kittyWindowId":"%s","pid":%s}' \
  "$(esc "$TERM_PROGRAM")" "$(esc "$__CFBundleIdentifier")" "$(esc "$tty")" \
  "$(esc "$TERM_SESSION_ID")" "$(esc "$ITERM_SESSION_ID")" "$(esc "$TMUX_PANE")" \
  "$(esc "$WEZTERM_PANE")" "$(esc "$KITTY_WINDOW_ID")" "${claude_pid:-0}")

curl -s -o /dev/null --connect-timeout 0.5 --max-time 2 \
  -H 'Content-Type: application/json' \
  -X POST "http://127.0.0.1:$PORT/hook" \
  --data-binary "{\"hook\":$INPUT,\"meta\":$META}" >/dev/null 2>&1

exit 0
