# Antigravity — notes for agents

A Kehikot module: a terminal holding the Antigravity CLI (`agy`) session that belongs to a place
(project, epic, picked parts, kehikko). The sibling of the Codex and Claude modules: the same record,
page and doors, with `program.ts` answering for `agy`. README.md says what it does, what the CLI can
and cannot do, and what is documented but not measured.

## The rules

- **Nothing in `~/.gemini` is written.** Everything a session is given is in its own folder
  (`sessionKit` in skills.ts), passed as `--add-dir`, and its status line as `--settings <file>`:
  hooks, doors, skills, status line. Never `~/.gemini/config/*`, never
  `--dangerously-skip-permissions`, never `--mode auto`, never a sandbox flag.
- **A session's state is told, never read off the screen**: hooks (`tell.sh`), OSC 7501 reports on
  the pty (`oscEvents`), and the status line (`status.sh`). Each only says a state word and the
  conversation id; nothing a person wrote is read.
- **The transcript's format is not documented.** Never parse it; only its existence and time.
- **Project data** lives only in `<project>/.kehikot/antigravity/` (`record.ts`).
- **Tests never reach the real machine or the real CLI**: `test/setup.ts` points HOME, the registry
  and PATH at scratch; `test/stand-in/agy` imitates the CLI as documented.
- **Never a browser on this Mac**; DOM tests use happy-dom.

## Releasing

Kehikot installs and updates this module from its GitHub releases. Nobody tags by hand: merging the
version bump is the release.

1. Bump `version` in `package.json` (semver). It is the only place the version is written.
2. Write `notes/<version>.md`: what a person notices (see `notes/README.md`).
3. Open a PR with both; merge it.
4. On that push to `main`, `.github/workflows/release.yml` (the shared `module-release.yml` in
   Jalez/kehikko-desktop) tags `v<version>`, checks the notes, typechecks and tests, then publishes
   the release "Antigravity <version>".

## Ready-built

`run.sh` serves the built page (`serve.ts`) when `dist/.kehikot-built` names the commit checked out,
and Vite otherwise. `bun run build` makes it; a host runs that at install and update.
