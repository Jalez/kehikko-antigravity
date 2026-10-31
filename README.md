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
| `.agents/hooks.json` | this module's hooks: `tell.sh` (state) and `context.sh` (the session notes) |
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
| New / resumed session | `agy` (CLI picks a UUID); `agy --conversation <id>`; `-i "<line>"` for the restart sentence | **done** |
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
| `events` research-complete, sound `answer` | `tell_finished` tag, carried at the turn's end (`Stop` or OSC `done`) | **done** |
| Context meter (transcript `token_count`) | status line JSON: `context_window.used_percentage`, `context_window_size`, `current_usage`, `model.display_name`, `cost.total_usd` (estimate) | **done**, only while the session runs. No compaction count or point (not said) |
| Labels (first prompt from transcript) | status line `conversation_title` | **done** — transcript format not documented, never parsed |
| Project's other conversations (Connect menu) | the CLI's list is not readable (records undocumented) | **adapted** — only conversations this module or `/kehikot-here` recorded |
| Open in another process (lock files + `lsof`) | no lock; `ps` finds `agy --conversation <id>` processes, `lsof -d cwd` their folder | **partial** — a conversation opened with `-c` or `/resume` is not seen |
| Cut off by a restart | the record's `working` mark | **done**; transcript not read (`midTurn` finds nothing) |
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
  first turn and that kehikko's own when it had none.
- **Disconnect and connect again** (View and Go menus), as in the Codex module.
- **It knows where it is.** At a new conversation's start, and at the first model call of a process
  that has told it nothing yet, the protocol's `sessionNotes`, word for word what a Claude or Codex
  conversation on the same kehikko is told, plus its skills as `/name` entries; before later model
  calls only what changed. *What this conversation was told* in the View menu shows it.
- **The kehikko's MCP doors** and **skills**, for that one process.
- **Working, needs you, finished** in the Inbox and the View menu, with a notice when nobody is looking.
- **The context meter** under the session, **Compact** and **Clear** on a press.
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

## Where its data lives

`<project>/.kehikot/antigravity/places.json` (which session belongs to which place; ignored by git by
default) and `<project>/.kehikot/antigravity/settings.json`. Of `~/.gemini/antigravity-cli` only
whether `brain/<id>/` exists, and its transcript's size and time, are read. A session's folder is in
this user's temporary directory under `kehikot-antigravity-<uid>/`, removed when the session ends.

## What it never does

- It never sends a prompt of anybody's. Its one sentence goes, once, to a conversation a restart cut
  off, behind the person's setting; and `/compact` or `/clear` on a person's press.
- It never widens what the CLI may do: no `--dangerously-skip-permissions`, no `--mode auto`, no
  sandbox setting. A session's workspace is its project's folder (its working directory), its own
  folder, and the folders the person listed in "Other folders sessions may work in" — nothing else,
  and no permission rule in its `--settings`.
- It never writes `~/.gemini`. It never reads a hook's input beyond the conversation id, nor a status
  line beyond the fields listed in `status.sh`, nor a transcript's content.

## Layout

| file | what is in it |
|---|---|
| `program.ts` | everything that knows it is `agy`: where it is, its flags, its hooks' format, OSC 7501, its processes |
| `skills.ts` | the session's folder: skills (translated from Claude Code's), doors, hooks, status line |
| `meter.ts` | the context meter, from the status line |
| `tell.sh`, `context.sh`, `status.sh` | what a session's hooks and status line run |
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
