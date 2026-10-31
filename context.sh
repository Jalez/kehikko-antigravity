#!/bin/sh
#
# What a session this module started runs at its start and before each model
# call, to be told where it is: its place, the modules on its kehikko and the
# skills loaded for it (see context.ts).
#
#   /bin/sh context.sh <SessionStart|PreInvocation>
#
# It is one of the hooks this module gives an Antigravity session in its own
# folder (`.agents/hooks.json`; the folder is a workspace root of the session,
# `--add-dir`), beside `kehikot/token`, `kehikot/origin` and
# `kehikot/registration`, which this module wrote there 0600 for this one
# session. What a SessionStart or PreInvocation hook prints as `injectSteps`
# is added to the conversation; a `systemMessage` step "persists in the
# conversation trajectory across turns" (the CLI's own hooks reference). That
# is the whole point of it, so unlike tell.sh this one prints what this
# module's own server answers — only when it is that answer — and `{}`
# otherwise, which changes nothing.
#
#   - Of what the CLI hands it, one thing leaves this script: the
#     conversation's id, checked for its exact spelling. The prompt
#     (`lastUserInput`) is never read out of it, sent, stored or shown.
#   - The token goes to curl on a pipe, never on a command line.
#   - It speaks only to this computer: the origin is checked to be loopback,
#     and no proxy is used.
#   - It never holds the session up for long and never fails it: four seconds
#     at most, every outcome is exit 0.

event=${1-}
nothing() {
  printf '%s\n' '{}'
  exit 0
}
case $event in SessionStart | PreInvocation) ;; *) nothing ;; esac

here=$(/usr/bin/dirname "$0")/kehikot
token=$(/bin/cat "$here/token" 2>/dev/null)
origin=$(/bin/cat "$here/origin" 2>/dev/null)
case $token in '' | *[!A-Za-z0-9_-]*) nothing ;; esac
[ ${#token} -le 64 ] || nothing

curl=/usr/bin/curl
sed=/usr/bin/sed
[ -x "$curl" ] && [ -x "$sed" ] || nothing

# The hook's input is one JSON object. Inside its strings a quote is escaped, so a quoted
# key followed by a colon is only ever a real key (the prompt cannot fake one).
input=$(/usr/bin/head -c 262144 2>/dev/null | /usr/bin/tr -d '\n\r')
session=$(printf '%s' "$input" | "$sed" -n 's/.*"conversationId" *: *"\([0-9a-f-]\{36\}\)".*/\1/p')
case $session in '' | *[!0-9a-f-]*) nothing ;; esac

ask() {
  case $1 in http://127.0.0.1:[0-9]*) ;; *) return 1 ;; esac
  printf 'header = "x-module-ticket: %s"\n' "$token" |
    "$curl" -q --config - --silent --fail --max-time 4 --connect-timeout 1 --noproxy '*' \
      --request POST "$1/api/context?event=$event&session=$session" 2>/dev/null
}

said=$(ask "$origin")
asked=$?
# No answer from there (nothing listening, or something else answering): the module may have moved
# to another port since this session started, and its registration says where. An answer with
# nothing in it is an answer.
if [ "$asked" -ne 0 ] && [ -f "$here/registration" ]; then
  reg=$(/bin/cat "$here/registration" 2>/dev/null)
  if [ -f "$reg" ]; then
    url=$("$sed" -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(http:\/\/127\.0\.0\.1:[0-9]*\)".*/\1/p' "$reg" | /usr/bin/head -n 1)
    [ -n "$url" ] && [ "$url" != "$origin" ] && said=$(ask "$url")
  fi
fi

case $said in '{"injectSteps":'*) printf '%s\n' "$said" ;; *) nothing ;; esac
exit 0
