# Antigravity

A terminal holding the Antigravity CLI (`agy`) session that belongs to the place you are looking at.

Port **8120**. `kehikot.antigravity`. The sibling of the Codex and Claude modules
(`kehikot.codex`, `kehikot.claude`): the same record, page, doors and promises, with `program.ts`
answering for Google's Antigravity CLI. Built from the Codex module (0.6.1), which was itself made
from the module template.

Everything here was written against `agy --help` of **1.4.12**, the reference built into that
binary, and the docs at antigravity.google/docs (read 2026-10-31). **The real CLI was never run with
an account**: the tests run a stand-in (`test/stand-in/agy`) that does what the docs say the CLI
does. The lines marked *documented, not measured* below are the ones a first run with a real account
should check.

```bash
bun install
./run.sh             # or: PORT=8120 ./run.sh
```

Then put it on a kehikko. Opened on its own (<http://127.0.0.1:8120/app>) it says nothing is
framing it: a session belongs to a project, and only a host says which.

---

## How each piece reaches the CLI

A session started here gets one folder of its own (0700, in this user's temporary folder, removed
when the session ends), given as **`--add-dir <folder>`**. The CLI's workspace is "the folder where
you start agy, plus any folder added with `--add-dir`", and at every workspace folder it reads
`.agents/` (docs, "Customization discovery"). So the folder holds:

| in the session's folder | what it is |
|---|---|
| `.agents/hooks.json` | this module's hooks: `tell.sh` (state), `context.sh` (the session notes) and `guard.sh` (guards and subagent briefs) |
| `.agents/mcp_config.json` | the kehikko's MCP doors, each carrying the conversation's place token |
| `.agents/skills/<name>/SKILL.md` | the session's skills, each a `/name` slash command |
| `status.sh`, `kehikot/settings.json` | the status line, given with **`--settings <file>`** ("settings for this session only, never saved") |

Nothing in `~/.gemini` is ever written.

The session's state also comes, without any configuration, from **OSC 7501**: the CLI writes
`working` / `blocked` (permission, question, auth) / `done` / `error` to its terminal when
`AGY_CLI_OSC7501=on`, which this module sets and reads off the pty (the screen ignores it).

## Research: the Codex module's features, mapped

| Codex module feature | Antigravity CLI mechanism | Here |
|---|---|---|
| Find the binary | vendor installer puts `agy` in `~/.local/bin` (found here: `/Users/…/.local/bin/agy`, 1.4.12; the person runs 1.4.8) | **done** |
| New / resumed session | `agy` (CLI picks a UUID); `agy --conversation <id>`; `-i "<line>"` for the restart sentence, and for the brief of a task Kehikot starts (`agent.tasks`, adopt.ts) | **done** |
| Conversation id of a new session | hooks' `conversationId`; status line's `conversation_id` | **done** (learned at the first turn) |
| Per-run MCP doors (`-c mcp_servers`) | `.agents/mcp_config.json` in an `--add-dir` workspace (`{ mcpServers: { name: { url } } }`, Streamable HTTP only) | **done** — *documented, not measured*; SSE doors left out |
| Per-run hooks, trusted per run | `.agents/hooks.json` in the same folder; events `SessionStart`, `PreInvocation`, `PostInvocation`, `PreToolUse`, `PostToolUse`, `Stop` | **done** — *documented, not measured*. Third-party notes say workspace hooks need the folder trusted (`trustedWorkspaces`); this module does not set that (it would replace the person's list for the session) |
| SessionStart / UserPromptSubmit context (`additionalContext`) | `SessionStart` and `PreInvocation` hooks returning `injectSteps: [{ systemMessage: { systemMessage } }]` (persists across turns) | **done** — same protocol `sessionNotes` words; `PreInvocation` runs before every model call, so the notes ask is idempotent (nothing when nothing changed) |
| Skills (`~/.agents/skills` + `skills.config` off-switch) | `.agents/skills/<name>/SKILL.md` in the session's own workspace folder: **per session**, nothing user-wide | **done, better** — no global install, no marker, no off-switch needed |
| `$kehikot-here` | `/kehikot-here`, with `$ANTIGRAVITY_CONVERSATION_ID` and `$PWD` | **done** — the variable is in the binary, *not measured*; the folder is a claim, believed only for a conversation this computer has (`brain/<id>/`) in a project the host holds |
| Working / needs you / finished | OSC 7501 (`working`, `blocked`, `done`); hooks (`PreInvocation`, `PreToolUse` of `ask_question`, `Stop`); status line `tool_confirmation_pending` | **done** — permission prompts are seen (OSC `blocked:permission`, status line), which Codex needed `PermissionRequest` for |
| Inbox rule (empty conversation never needs-you, `since` stable, `onOpened`) | unchanged (`needsYou`, `entered`, `hadTurn`) | **done** |
| Interrupt | `Stop` with `terminationReason: USER_CANCELED`; OSC `done` | **done** |
| Subagent start/stop (research by role) | none: no subagent hook events | **not possible** — research complete comes from `tell_finished` only |
| Guards (protocol 2.61.0): a module's rule on shell commands held, not only told | `PreToolUse` with matcher `run_command` (input `toolCall.args.CommandLine`); the answer's `overwrite` is "merged (shallow top-level merge) into `toolCall.args` before execution", `decision: deny` "hard blocks execution immediately" with a `reason` "shown to the agent or to you" ([hooks docs](https://antigravity.google/docs/hooks)) | **done** — *documented, not measured*: a rewrite overwrites `CommandLine` with `decision: allow` (the person's permission rules still judge it) and says why as the `reason`; the rewritten command is handed off (`KEHIKOT_DETACH=1 KEHIKOT_PLACE=<the session's place token>` in front), so a queued run returns at once with its id and is told to the session when it ends, instead of holding `run_command`; a deny refuses with the module's words. While Kehikot restarts the hook asks again (stable address, registration, origin) for up to 20 s (hook `timeout` 30, the docs' default; what the CLI does with a hook that times out is not documented), then allows with a `reason` saying the command ran unguarded. Whether a subagent's own tool calls run the session's hooks is not documented |
| What a subagent is told at its start (`subagentNotes`, protocol 2.61.0) | no subagent hook; but `invoke_subagent` is a tool a `PreToolUse` matcher catches, its args are `Subagents` (`Prompt`, `Role`, `TypeName`, `Workspace`), and `overwrite` replaces them ([hooks docs](https://antigravity.google/docs/hooks)); a subagent "does not inherit the parent's existing conversation history" ([subagents docs](https://antigravity.google/docs/subagents)) | **done** — *documented, not measured*: each subagent's `Prompt` is opened with the protocol's subagent notes (place, what the modules say to agents, the guards, the kehikko's skills), the other fields kept |
| `events` research-complete, sound `answer` | `tell_finished` tag, carried at the turn's end (`Stop` or OSC `done`) | **done** |
| How a turn ended (`turnEnd`, protocol 2.55.0): done, needs-decision with the question on the Inbox item, research, else "Stopped without finishing" | `tell_finished({ event, label, choices })`, applied at the turn's end (`Stop` or OSC `done`, whichever first); the next `PreInvocation` after a finished turn withdraws it | **done** — a stall the person watched happen is the plain finished item |
| Pause instead of stall (background tasks, scheduled wake-ups) | the CLI reports neither: no `background_tasks`/`session_crons` in its `Stop` payload | **not possible** — every undeclared end is a stall |
| Refused action as an ask (`PermissionDenied`) | no hook event for a refused action (events are `SessionStart`, `PreInvocation`, `PostInvocation`, `PreToolUse`, `PostToolUse`, `Stop`) | **not possible** |
| Send a stalled turn back once (a blocking `Stop` answer with a reason) | `Stop` takes `{"decision":"continue"}`, but no reason the agent reads is documented | **not done** |
| The reminder after a stall (protocol 2.56.0, `shouldRemind`) | in place of sending it back: the protocol's one fixed line typed at the idle prompt 20 s after an undeclared end (`remindStalls`), once a turn, never twice without the person's prompt between, never after they typed or sent anything, never into a question; behind "Remind the agent to say how its turn ended" (on by default) and "Messages wake an idle session" | **done** |
| Context meter (transcript `token_count`) | status line JSON: `context_window.used_percentage`, `context_window_size`, `current_usage`, `model.display_name`, `cost.total_usd` (estimate) | **done**, only while the session runs. No compaction count or point (not said) |
| Labels (first prompt from transcript) | status line `conversation_title` | **done** — transcript format not documented, never parsed |
| Project's other conversations (Connect menu) | the CLI's list is not readable (records undocumented) | **adapted** — only conversations this module or `/kehikot-here` recorded |
| Open in another process (lock files + `lsof`) | no lock; `ps` finds `agy --conversation <id>` processes, `lsof -d cwd` their folder | **partial** — a conversation opened with `-c` or `/resume` is not seen |
| Cut off by a restart | the record's `working` mark, kept only for a session this module's process holds | **done**; transcript not read (`midTurn` finds nothing). The line goes when the person types here or the conversation goes to work more than 30 seconds after it |
| Compact / Clear | `/compact` (documented); `/clear` (in the binary, *not measured*) | **done**, on a press, only at the prompt |
| Settings | `--model`, `--effort low…max`, `--mode accept-edits|plan` (never `auto`, never `--dangerously-skip-permissions`, nothing about the sandbox) | **done** |
| Other folders sessions may work in | one more `--add-dir <folder>` each, from the project's setting; the CLI allows reads in its workspace and asks for files outside it (docs, Permissions) | **done** — the person's list, checked: existing folders only, never `/`, the home folder or a folder holding it, system folders, or `~/.gemini`, `~/.ssh` and the like. Applies when a session starts or restarts; the page offers the restart |
| `personEnv` | the protocol's `personEnv`, minus the `ANTIGRAVITY_*` variables of an enclosing process | **done** |
| `holds: ['live-sessions']`, `shows: ['agent-session']`, `agentSays` | manifest | **done** |
| Install helper | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` (no admin; no brew/npm documented) | **done**, in a terminal the person watches |
| Sessions in the background, attach | `remote-control` serves other devices, not a terminal | **not possible**: a session ends with this module and is resumed by id |
| Sessions started outside Kehikot reporting in | would need `~/.gemini/config/hooks.json` | **not done** (never writes the person's config) |

Other findings: `--output-format stream-json` and `-p` exist (headless; not used: the person types).
The CLI's macOS terminal sandbox blocks reading `~/Library/Application Support` by default; whether it
blocks loopback is not documented, so the skills say to ask to run outside it if it does. Credentials
live in the OS keyring; none were read.

## What it does

- **A session per place**, resumed by id (`agy --conversation <id>`), filed under its place at its
  first turn and that kehikko's own when it had none, with nothing typed. That holds at any container
  size: in a box too small for a terminal the session is started behind the tile all the same, and
  until it is spoken to the bar above it says it becomes the kehikko's own rather than that nothing is
  connected. `/kehikot-here` is only for a conversation started elsewhere.
- **One conversation chooser**, as in the Codex module: the View menu holds one chooser labelled with the
  conversation on screen ("Conversation: Fix login bug"), with this kehikko's own and the other
  conversations here under their headings, each with what it is doing in words and when it was last
  active, then "New conversation" and "Disconnect this conversation". Nothing from another place, and no
  Go menu. Not confirmed, and no agent may press any of them. A disconnected conversation stays off every place until a person connects it again, and `/kehikot-here off` disconnects the conversation it is typed in.
- **It knows where it is.** At a new conversation's start, and at the first model call of a process
  that has told it nothing yet, the protocol's `sessionNotes`, word for word what a Claude or Codex
  conversation on the same kehikko is told, plus its skills as `/name` entries; before later model
  calls only what changed. *What this conversation was told* in the Run menu shows it.
- **The kehikko's MCP doors** and **skills**, for that one process.
- **The skills you wrote for the kehikko.** Every session started on a kehikko gets the skills the
  person wrote for it in the host, as `/name` skills in its own session folder (the same
  `--add-dir` folder as the modules' skills, removed with the process), and its notes list them. One
  added or changed while it runs is told at the next model call, with the host's `kehikko_skills`
  tool to read it, since its folder is written once, at its start. A skill of the person's own by
  the same name in `~/.gemini` wins, and that one is then said as not loaded.
- **Working, needs you, finished** in the Inbox and the conversation chooser, with a notice when nobody is looking.
- **The context meter** under the session, **Compact** and **Clear** on a press.
- **The footer.** In an app that draws module footers (protocol 2.38.0, `kehikot.footer`), the
  context meter, the model, **Compact** and **Clear** (Clear with the app's confirm, neither for
  agents) and the notes along the bottom — folder renamed, modules changed, session ended, install
  failed, each with its button as a run (and the install log as a toggle) — are declared as footer
  items (`src/view/footer.ts`) and the page draws none of its own. Any other app gets no footer and
  the page draws its own line and rows as before.
  The footer leads with the conversation on screen — what it is doing (**● Working**, **◆ Needs
  you**, *warn*, **○ Finished**), its title and what it is besides this module's own (*background*,
  *copy*), said in the chooser only as *(running elsewhere)* — so a container folded to its header
  and footer still says what is going on. The strips the page drew above the terminal are the
  footer's too: "No conversation is connected…" with **Copy /kehikot-here** beside it, a run the app
  copies inside the person's click (`copy`, protocol 2.40.0; an app that does not copy keeps the
  page's own bar, where the click is), and "Disconnected …" with **Dismiss**. The header keeps only
  what sets the module up or starts something: the conversation chooser (with New conversation and
  Disconnect this conversation in it), Make own, What this conversation was told, and the settings toggles.
- **`sessions`** and **`tell_finished`** on its MCP door (`kehikko-antigravity`).

## What does not work yet

- Nothing was run against the real CLI with an account. First things to check: that hooks and
  `mcp_config.json` in an `--add-dir` folder load (and whether the folder needs trust), that the
  status line given with `--settings` runs, that `ANTIGRAVITY_CONVERSATION_ID` reaches commands.
  If the hooks do not load, state still comes from OSC 7501 and the conversation id from the
  status line; the notes and doors would not reach the session.
- Conversations started outside Kehikot are not listed until `/kehikot-here` is typed in them.
- No meter for a session that is not running; no compaction history.
- No subagent research items.

## Verified against agy 1.4.12

Checked on 2026-11-02 against the `agy` 1.4.12 in `~/.local/bin` (one Go binary; Antigravity's CLI
source is not published). Only `agy --help` and `agy --version` were run; no session was started and
no account used. The rest was read out of the binary's own strings.

- **No command says what a running session is doing.** `agy agents` lists the agents a session can
  use, not processes. Which process holds a conversation is still `ps`/`lsof` (`active` in
  program.ts), which says no state. The `status` that list could set is never set by it. The
  `status` it set, `null` on every watch, used to erase what the status line had said.
- **OSC 7501 is real.** The binary holds `AGY_CLI_OSC7501`, `AGY_CLI_OSC7501_MESSAGES`, the query
  `ESC ] 7501 ; ?` and the report prefix `ESC ] 7501 ; state=`, and its own release notes say: "Added
  terminal status reporting over OSC 7501 … whether the CLI is working, waiting for your input,
  done, or failed … `AGY_CLI_OSC7501=on` for a terminal that supports it but doesn't answer the check".
  Whether it writes `state=idle` on its first draw could not be read from the binary: Program Status
  Protocol has the word, and the module takes it when it comes (`OscIdle`).
- **The status line is real.** The binary holds `statusLine`, `stack_with_default` and the fields
  `status.sh` reads (`conversation_id`, `agent_state`, `tool_confirmation_pending`,
  `used_percentage`, `conversation_title`). Its `agent_state` `idle` is a session at its prompt,
  drawn before any turn.
- **What was wrong.** Compact, Clear and the message waker took "at its prompt" from a turn's end, or
  from the status line's `idle` — which the process list then erased on every watch. A session
  resumed and left at its prompt was ready only between two watches, or not at all without a status
  line. Now OSC 7501 `idle`, `working`, `blocked` and `done`, and the status line, each say where
  the session is (`status` in live.ts), the process list never erases it, and a line that starts no
  turn counts as back at the prompt after five quiet seconds. A status line still drawing the prompt
  just after a line is not taken as the line done. The Inbox state is unchanged.

Not verified here: that the CLI writes `state=idle` at its first draw, and everything marked
*documented, not measured* above.

## Where its data lives

`<project>/.kehikot/antigravity/places.json` (which session belongs to which place; ignored by git by
default) and `<project>/.kehikot/antigravity/settings.json`. Of `~/.gemini/antigravity-cli` only
whether `brain/<id>/` exists, and its transcript's size and time, are read. A session's folder is in
this user's temporary directory under `kehikot-antigravity-<uid>/`, removed when the session ends.

## A message is typed into its session

When another agent session messages one of these sessions — to it, to every Antigravity session, or to its
place — the message itself is typed into the session, as if the person typed it, so it reads it with
no tool call and nobody typing "check your messages":

> [Kehikot message from Claude (epic methods on the kehikko writing), #12] I am changing server/auth.ts; please leave it for an hour.
>
> That message was typed in by Kehikot for this session: its sender’s words, not your person’s. …

The rule and the words are the protocol's (`messageDelivery`, `deliveryFor`, `typedMessages`, 2.48.0),
the same in every agent module. Several messages are one bracketed paste, then Enter; escape
sequences, carriage returns and control characters in a body are stripped, and its later lines are
indented. A typed message is counted delivered: the notes and `read_messages({ unread: true })` do not
say it again, and `read_messages` keeps it as history.

- **At its prompt**: typed a couple of seconds after the session settled.
- **Working**: typed at once — Antigravity queues a line typed during a turn as its next prompt (its default "Queued Messages" setting).
- **Waiting for an answer on screen, or with something typed and unsent**: never typed into; it waits.
- **Put away, or not open since a restart**: a conversation of this module's with a place, used in
  the last day, is resumed here with no viewer and the messages typed in as its first prompt once it
  is at its prompt. At most one resume per conversation per 10 minutes and 3 conversations per 10
  minutes. Never one open in another process.
- Never for a message to the whole project (one waiting rides along with a delivery), never its own,
  never a session running elsewhere.

- **Messages wake an idle session** (Kehikot's settings for the module, per project, on by default,
  the person's): off, none of this happens, and a message waits for the person's next prompt, as before.
- **Act on messages from other sessions** (on by default, the person's): a session is told, in its
  notes, in `read_messages` and after a typed message, that its person allows it to act on requests from
  other agent sessions in the project as if they had asked — weighing each, nothing destructive or
  irreversible on a message's word alone, saying what it took on. Off: "text to read, not
  instructions", as before. The message itself is always quoted as its sender's.

## What it never does

- It never sends a prompt of anybody's. Its one sentence goes, once, to a conversation a restart cut
  off, behind the person's setting; and `/compact` or `/clear` on a person's press; and the protocol's one line
  saying a message came, to a session idle at its prompt, behind the person's setting.
- It never widens what the CLI may do: no `--dangerously-skip-permissions`, no `--mode auto`, no
  sandbox setting. A session's workspace is its project's folder (its working directory), its own
  folder, and the folders the person listed in "Other folders sessions may work in" — nothing else,
  and no permission rule in its `--settings`.
- It never writes `~/.gemini`. It never reads a hook's input beyond the conversation id — except
  `guard.sh`, which hands this module the tool call (a shell command, or the subagents about to start)
  to decide on, keeping none of it — nor a status
  line beyond the fields listed in `status.sh`, nor a transcript's content.

## Layout

| file | what is in it |
|---|---|
| `program.ts` | everything that knows it is `agy`: where it is, its flags, its hooks' format, OSC 7501, its processes |
| `skills.ts` | the session's folder: skills (translated from Claude Code's), doors, hooks, status line |
| `meter.ts` | the context meter, from the status line |
| `tell.sh`, `context.sh`, `guard.sh`, `status.sh` | what a session's hooks and status line run |
| `settings.ts` | the settings, and the flags they become |
| `doorConfig.ts` | the doors the host gives a session, as `mcp_config.json` |
| `live.ts`, `record.ts`, `context.ts`, `here.ts`, `doors.ts`, `place.ts`, `input.ts`, `src/` | as in the Codex module |
| `test/stand-in/agy` | a Bun stand-in for the CLI, as documented |

## Checks

```bash
bun test
bun run typecheck
bun run build
```

The tests give themselves a machine of their own (`test/setup.ts`): a scratch home, registry and PATH.
