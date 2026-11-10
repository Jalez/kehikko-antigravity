#!/bin/sh
#
# What a session this module started runs before each shell command (`run_command`) and before it
# starts subagents (`invoke_subagent`): asks this module what becomes of the call (protocol 2.61.0,
# see `guard` in context.ts) and prints what the CLI is to do.
#
#   /bin/sh guard.sh PreToolUse
#
# A PreToolUse hook in the session's own folder (`.agents/hooks.json`, matcher GUARD_MATCHER in
# skills.ts), beside context.sh and the same `kehikot/token`, `kehikot/stable`, `kehikot/origin` and
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
#   - Where it asks, in order: Kehikot's stable address for this module (`kehikot/stable`, the host's
#     `/m/<this module>`, which follows the module wherever it binds), what its registration names
#     now, and the origin it served on when the session started.
#   - Kehikot restarting is not a reason to skip the guards. While nothing answers (no connection, or
#     the host or this module saying it is not up or cannot know the guards yet: 502, 503, 504) it
#     asks again every second for up to 20 seconds (GUARD_TIMEOUT in skills.ts gives the hook the
#     time). Only then does the call run as written, with a `reason` telling the agent it ran
#     unguarded and how to queue heavy work itself. While Kehikot stays away (`kehikot/away`, five
#     minutes) the next calls ask once and do not wait again.
#   - Every outcome is exit 0, and anything that is not this module's answer is
#     `{"decision":"allow"}` ("proceed, deferring to the next hook or default policy") — the call
#     then runs as written.
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
stable=$(/bin/cat "$here/stable" 2>/dev/null)
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

# How long Kehikot is waited for, in seconds (KEHIKOT_GUARD_WAIT, for a test); not again while it stays away.
wait=${KEHIKOT_GUARD_WAIT-20}
case $wait in '' | *[!0-9]*) wait=20 ;; esac
[ -n "$(/usr/bin/find "$here/away" -mmin -5 2>/dev/null)" ] && wait=0

# One ask: the answer's body in $said, its HTTP status in $code (000: nothing answered); 1 for an address that is not loopback.
ask() {
  code=000
  said=
  case $1 in http://127.0.0.1:[0-9]*) ;; *) return 1 ;; esac
  out=$(printf '%s' "$input" |
    "$curl" -q --config /dev/fd/3 --silent --max-time 3 --connect-timeout 1 --noproxy '*' \
      --header 'content-type: application/json' --data-binary @- --write-out '\n%{http_code}' \
      "$1/api/guard?session=$session&direct=$direct" 2>/dev/null 3<<EOF
header = "x-module-ticket: $token"
EOF
)
  code=$(printf '%s' "$out" | /usr/bin/tail -n 1)
  said=$(printf '%s' "$out" | "$sed" '$d')
  case $code in [0-9][0-9][0-9]) ;; *) code=000 ;; esac
}

# What the module's registration names now: a module that came back on another port is followed.
registered() {
  [ -f "$here/registration" ] || return 0
  reg=$(/bin/cat "$here/registration" 2>/dev/null)
  [ -f "$reg" ] && "$sed" -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(http:\/\/127\.0\.0\.1:[0-9]*\)".*/\1/p' "$reg" | /usr/bin/head -n 1
}

start=$(/bin/date +%s)
while :; do
  away=0
  tried=
  for url in "$stable" "$(registered)" "$origin"; do
    [ -n "$url" ] || continue
    case " $tried " in *" $url "*) continue ;; esac
    tried="$tried $url"
    # Not loopback: never asked, and not counted as away.
    ask "$url" || continue
    case $code in
      200)
        /bin/rm -f "$here/away"
        case $said in '{"decision":'*) printf '%s\n' "$said" ;; *) nothing ;; esac
        exit 0
        ;;
      204)
        /bin/rm -f "$here/away"
        nothing
        ;;
      000 | 502 | 503 | 504) away=1 ;;
    esac
  done
  # Everyone asked answered, none with a guard's answer: the call runs as written.
  [ "$away" = 1 ] || nothing
  [ $(($(/bin/date +%s) - start)) -lt "$wait" ] || break
  /bin/sleep 1
done

: >"$here/away" 2>/dev/null
printf '%s\n' '{"decision":"allow","reason":"Kehikot did not answer (it may be restarting), so this call ran without the guards of the modules on your kehikko. Until it is back, run heavy work (tests, typechecks, builds, big installs) through Queue yourself: its CLI, the kehikot-queue program its wait lines name, run as `kehikot-queue run -- <command>` in the background, waits for Queue to come back and exits with the command'"'"'s exit code."}'
exit 0
