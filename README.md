# claude-mods

My Claude Code mods. Each folder is one mod: a plugin of hooks that Claude Code loads.

| Mod | What it does |
|---|---|
| `linear-watch` | Checks the Linear tickets assigned to me every hour. Shows each ticket above the prompt with the state of its linked PRs and who has to act (for example `● site#152 ready · operator merges`), a toast when a ticket is new or changes status, and a `/tickets` command that opens the full pane. |
| `mesh-toast` | Every minute, peeks at my cortex mesh inbox and shows a toast for each new message. It uses `--peek`, so it never marks a message as read. |
| `mesh-toaster` | A toaster above the prompt: empty slots when there is no mesh mail, toast popping up with the sender and subject when mail arrives. **Got it** puts the toast down (only in the toaster; the message stays unread on the mesh). |
| `repo-sync` | Every 14 hours, runs `bin/repo-sync` and shows a toast with what it updated. |

`bin/repo-sync` updates every repo under `~/projects/<owner>/<repo>`. It only fast-forwards a repo
that has no uncommitted changes and no unpushed commits. Anything else is reported and left alone.
It never deletes, resets, rebases or pushes. Copy it to `~/.local/bin/` before you use `repo-sync`.

## Use a mod in a session

Copy the mod folder into the session's mod folder, then turn on hot reloading when Claude Code asks:

```sh
cp -r linear-watch ~/.claude/dev-mods/<session-id>/
```

Check a mod before you use it:

```sh
claude plugin validate linear-watch
claude plugin test linear-watch
```

`linear-watch` reads Linear through the Linear connector (`mcp__plugin_design_linear__list_issues`).
Without that connector, it shows "Linear: check failed".

`mesh-toast` and `mesh-toaster` read the inbox through the `cortex-join` plugin's `cortex-mesh.py`. Without that plugin,
they show nothing. `linear-watch` reads PR states with the `gh` CLI.
