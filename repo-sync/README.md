# repo-sync

Keeps the git repos in `~/projects` up to date, safely, and tells you what changed.

## What it does

- Every 14 hours, it runs the `repo-sync` script and shows a toast with the result (for example
  which repos got new commits, and which it did not touch).
- It checks one time each hour if 14 hours have passed. Thus the 14 hours stay correct when you
  restart Claude Code.

The script, `bin/repo-sync`, looks at each repo at `~/projects/<owner>/<repo>`:

- It updates a repo only by fast-forward.
- It does not touch a repo that has uncommitted changes, unpushed commits, or a branch with no
  upstream. It reports that repo and its reason.
- It never deletes, resets, rebases or pushes.
- It skips `~/projects/_attic`.
- It writes a log to `~/.cache/repo-sync.log`.

Set `REPO_SYNC_ROOT` to use a different folder than `~/projects`.

## Install

1. Copy the script to your path:

   ```sh
   install -m 755 repo-sync/bin/repo-sync ~/.local/bin/repo-sync
   ```

2. Install the mod:

   ```
   /plugin install repo-sync --marketplace Mark-Hickey/claude-mods
   ```

You can also run `repo-sync` yourself in a terminal at any time.

## Develop

```sh
claude plugin validate repo-sync
claude plugin test repo-sync
```
