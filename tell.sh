#!/bin/sh
#
# What a session's program runs to say what it is doing: one word to this
# module's own server, over loopback, and nothing else.
#
#   /bin/sh tell.sh <event>
#
# It is run by the Antigravity CLI as one of the hooks this module gives the
# session in its own folder (`.agents/hooks.json`, see `hooksJson` in
# program.ts and "Told, not read" in live.ts), and it is written to be the
# least a thing run from inside somebody's agent can be:
#
#   - It says the EVENT'S NAME, which is this script's own argument, the RUN,
#     which this module put in the environment when it started the pty, and the
#     conversation's id, which the CLI hands every hook as `conversationId`.
#     Of what the CLI supplies on standard input — the prompt (`lastUserInput`),
#     the tool's input, the model's name — nothing else is read, carried,
#     stored or shown.
#   - Nothing is interpolated into a command. The values come from this
#     module's own environment and the id is checked for its exact spelling;
#     the secret never appears on a command line: it goes to curl on a pipe, so
#     `ps` does not show it.
#   - It can only ever speak to this computer. Only a port number is taken
#     from the environment, digits or nothing, and no proxy is used.
#   - It never holds the program up and never changes what it does: two
#     seconds at most, every outcome is exit 0, and what it prints is the
#     answer that lets the CLI go on as it would have — `{"decision":"allow"}`
#     before a tool ("proceed, deferring to the next hook or default policy"),
#     `{"decision":"stop"}` at a stop (anything but "continue" lets it stop),
#     `{}` otherwise. Nothing is injected.
#
# A server that is gone, a curl that is missing, a variable that is absent:
# all the same, silently nothing. The session then has no state from its
# hooks (its OSC 7501 reports still say it).

event=${1-}

answer() {
  case $event in
    AskUser) printf '%s\n' '{"decision":"allow"}' ;;
    Stop) printf '%s\n' '{"decision":"stop"}' ;;
    *) printf '%s\n' '{}' ;;
  esac
  exit 0
}

port=${KEHIKOT_TELL_PORT-}
secret=${KEHIKOT_TELL_SECRET-}
session=${KEHIKOT_TELL_SESSION-}

case $event in '' | *[!A-Za-z]*) event=; answer ;; esac
case $port in '' | *[!0-9]*) answer ;; esac
case $secret in '' | *[!0-9a-f]*) answer ;; esac
case $session in '' | *[!0-9a-f-]*) answer ;; esac
[ ${#port} -le 5 ] && [ ${#secret} -le 128 ] && [ ${#session} -le 64 ] && [ ${#event} -le 40 ] || answer

# By its full name, so that nothing a project puts on PATH is run in its place.
curl=/usr/bin/curl
sed=/usr/bin/sed
[ -x "$curl" ] && [ -x "$sed" ] || answer

# The hook's input is one JSON object. Inside its strings a quote is escaped, so a quoted key
# followed by a colon is only ever a real key: the prompt cannot fake one. Only the id leaves.
thread=
if [ ! -t 0 ]; then
  input=$(/usr/bin/head -c 262144 2>/dev/null | /usr/bin/tr -d '\n\r')
  thread=$(printf '%s' "$input" | "$sed" -n 's/.*"conversationId" *: *"\([0-9a-f-]\{36\}\)".*/\1/p')
  case $thread in *[!0-9a-f-]*) thread= ;; esac
fi
extra=
[ -n "$thread" ] && extra="&thread=$thread"

printf 'header = "x-module-ticket: %s"\n' "$secret" |
  "$curl" -q --config - --silent --max-time 2 --connect-timeout 1 --noproxy '*' --output /dev/null \
    --request POST "http://127.0.0.1:$port/api/state?event=$event&session=$session$extra" >/dev/null 2>&1

answer
