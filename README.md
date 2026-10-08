# claude-mods

My Claude Code mods. Each folder is one mod: a plugin of hooks that Claude Code loads.

| Mod | What it does |
|---|---|
| `linear-watch` | Checks the Linear tickets assigned to me every hour. Shows a ticket line above the prompt, a toast when a ticket is new or changes status, and a `/tickets` command and pane. |
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
