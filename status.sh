#!/bin/sh
#
# A session's status line: what the Antigravity CLI runs to draw one, with its
# session state as JSON on standard input, at most every 300 ms (the docs'
# "Customize the status line"). It is given to a session this module started,
# for that one process (`--settings <file>`: settings for this session only,
# never saved), and it prints NOTHING — `stack_with_default` keeps the CLI's
# own status line on screen. What it does is tell this module's server how full
# the conversation's context is, and which conversation it is.
#
#   /bin/sh status.sh
#
#   - Of the many fields the CLI hands it, these leave this script and nothing
#     else: the conversation's id, the agent's state, whether a permission
#     prompt is up, the share of the context window in use and its size, the
#     tokens of the last request, the model's name, the list-price cost
#     estimate, and the conversation's title (which the module shows as its
#     label). The account's email, the folder, the transcript's path, the quota
#     are never read out of it.
#   - Said only when something changed since the last time (kept beside this
#     script, 0600): no request at all while nothing moves.
#   - The secret goes to curl on a pipe, never on a command line; only a port
#     number is taken from the environment, and no proxy is used.
#   - Never more than two seconds, every outcome exit 0, nothing printed.

port=${KEHIKOT_TELL_PORT-}
secret=${KEHIKOT_TELL_SECRET-}
session=${KEHIKOT_TELL_SESSION-}
case $port in '' | *[!0-9]*) exit 0 ;; esac
case $secret in '' | *[!0-9a-f]*) exit 0 ;; esac
case $session in '' | *[!0-9a-f-]*) exit 0 ;; esac
[ ${#port} -le 5 ] && [ ${#secret} -le 128 ] && [ ${#session} -le 64 ] || exit 0

curl=/usr/bin/curl
sed=/usr/bin/sed
[ -x "$curl" ] && [ -x "$sed" ] || exit 0
[ -t 0 ] && exit 0

input=$(/usr/bin/head -c 262144 2>/dev/null | /usr/bin/tr -d '\n\r')

# One field: a quoted key, a colon, and its value up to the next comma or brace. Inside the
# CLI's strings a quote is escaped, so a quoted key followed by a colon is only ever a real key.
num() { printf '%s' "$input" | "$sed" -n "s/.*\"$1\" *: *\(-\{0,1\}[0-9][0-9.eE+-]\{0,24\}\).*/\1/p"; }
word() { printf '%s' "$input" | "$sed" -n "s/.*\"$1\" *: *\"\([A-Za-z0-9_.:\/ ()-]\{0,80\}\)\".*/\1/p"; }
text() {
  # A string's inside, escapes kept: an escaped backslash and an escaped quote are set aside first,
  # so the value ends at the first quote that is really its end (BSD sed has no alternation).
  printf '%s' "$input" | "$sed" -e 's/\\\\/@@b@@/g' -e 's/\\"/@@q@@/g' |
    "$sed" -n "s/.*\"$1\" *: *\"\([^\"]\{0,255\}\)\".*/\1/p" | "$sed" -e 's/@@q@@/\\"/g' -e 's/@@b@@/\\\\/g'
}

thread=$(word conversation_id)
case $thread in '' | *[!0-9a-f-]*) exit 0 ;; esac
[ ${#thread} -eq 36 ] || exit 0
state=$(word agent_state)
case $state in *[!a-z_]*) state= ;; esac
asking=0
case $input in *'"tool_confirmation_pending":true'* | *'"tool_confirmation_pending": true'*) asking=1 ;; esac
used=$(num used_percentage)
size=$(num context_window_size)
input_tokens=$(num input_tokens)
cache_read=$(num cache_read_input_tokens)
cache_write=$(num cache_creation_input_tokens)
output_tokens=$(num output_tokens)
cost=$(num total_usd)
model=$(word display_name)
title=$(text conversation_title)

line="$thread|$state|$asking|$used|$size|$input_tokens|$cache_read|$cache_write|$output_tokens|$cost|$model|$title"
here=$(/usr/bin/dirname "$0")/kehikot
last=$(/bin/cat "$here/status.last" 2>/dev/null)
[ "$line" = "$last" ] && exit 0
(umask 077 && printf '%s' "$line" >"$here/status.last") 2>/dev/null

printf 'header = "x-module-ticket: %s"\n' "$secret" |
  "$curl" -q --config - --silent --max-time 2 --connect-timeout 1 --noproxy '*' --output /dev/null \
    --request POST -G \
    --data-urlencode "session=$session" --data-urlencode "thread=$thread" --data-urlencode "state=$state" \
    --data-urlencode "asking=$asking" --data-urlencode "used=$used" --data-urlencode "size=$size" \
    --data-urlencode "input=$input_tokens" --data-urlencode "cacheRead=$cache_read" --data-urlencode "cacheWrite=$cache_write" \
    --data-urlencode "output=$output_tokens" --data-urlencode "cost=$cost" --data-urlencode "model=$model" \
    --data-urlencode "title=$title" \
    "http://127.0.0.1:$port/api/status" >/dev/null 2>&1

exit 0
