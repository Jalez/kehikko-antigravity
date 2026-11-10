#!/bin/sh
#
# What a session this module started runs before each shell command (`run_command`) and before it
# starts subagents (`invoke_subagent`): asks this module what becomes of the call (protocol 2.61.0,
# see `guard` in context.ts) and prints what the CLI is to do.
#
#   /bin/sh guard.sh PreToolUse
#
# A PreToolUse hook in the session's own folder (`.agents/hooks.json`, matcher GUARD_MATCHER in
# skills.ts), beside context.sh and the same `kehikot/token`, `kehikot/origin` and
# `kehikot/registration`. The CLI's hooks reference: the answer's `decision` is required; `deny`
# "hard blocks execution immediately", with a `reason` "shown to the agent or to you"; `overwrite`
# holds "replacement arguments merged (shallow top-level merge) into `toolCall.args` before
# execution". So:
#
#   - a guarded command is run through the module's command instead (`overwrite: { CommandLine }`,
#     `decision: allow`) or refused with the module's reason (`decision: deny`);
#   - a subagent's brief is opened with what a subagent is told on the kehikko
#     (`overwrite: { Subagents }`, each `Prompt` opened with `subagentNotes`).
#
#   - Unlike context.sh, the hook's input leaves this script: the call is what is decided on. It goes
#     on a pipe to this module's own server on this computer, never on a command line, and the module
#     keeps none of it.
#   - The token goes to curl on a file descriptor, never on a command line.
#   - Loopback only, no proxy.
#   - It never fails the call for want of an answer: three seconds at most, every outcome is exit 0,
#     and anything that is not this module's answer is `{"decision":"allow"}` ("proceed, deferring to
#     the next hook or default policy") — the call then runs as written.
#   - `KEHIKOT_DIRECT` set in the session's own environment is said (`direct=1`): it passes every guard.

event=${1-}
nothing() {
  printf '%s\n' '{"decision":"allow"}'
  exit 0
}
[ "$event" = PreToolUse ] || nothing

here=$(/usr/bin/dirname "$0")/kehikot
token=$(/bin/cat "$here/token" 2>/dev/null)
origin=$(/bin/cat "$here/origin" 2>/dev/null)
case $token in '' | *[!A-Za-z0-9_-]*) nothing ;; esac
[ ${#token} -le 64 ] || nothing

curl=/usr/bin/curl
sed=/usr/bin/sed
[ -x "$curl" ] && [ -x "$sed" ] || nothing

input=$(/usr/bin/head -c 262144 2>/dev/null)
session=$(printf '%s' "$input" | /usr/bin/tr -d '\n\r' | "$sed" -n 's/.*"conversationId" *: *"\([0-9a-f-]\{36\}\)".*/\1/p')
case $session in '' | *[!0-9a-f-]*) nothing ;; esac

direct=0
case ${KEHIKOT_DIRECT-} in '' | 0) ;; *) direct=1 ;; esac

ask() {
  case $1 in http://127.0.0.1:[0-9]*) ;; *) return 1 ;; esac
  printf '%s' "$input" |
    "$curl" -q --config /dev/fd/3 --silent --fail --max-time 3 --connect-timeout 1 --noproxy '*' \
      --header 'content-type: application/json' --data-binary @- \
      "$1/api/guard?session=$session&direct=$direct" 2>/dev/null 3<<EOF
header = "x-module-ticket: $token"
EOF
}

said=$(ask "$origin")
asked=$?
# No answer from there: the module may have moved to another port since this session started, and its
# registration says where. An answer with nothing in it (204) is an answer.
if [ "$asked" -ne 0 ] && [ -f "$here/registration" ]; then
  reg=$(/bin/cat "$here/registration" 2>/dev/null)
  if [ -f "$reg" ]; then
    url=$("$sed" -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(http:\/\/127\.0\.0\.1:[0-9]*\)".*/\1/p' "$reg" | /usr/bin/head -n 1)
    [ -n "$url" ] && [ "$url" != "$origin" ] && said=$(ask "$url")
  fi
fi

case $said in '{"decision":'*) printf '%s\n' "$said" ;; *) nothing ;; esac
exit 0
